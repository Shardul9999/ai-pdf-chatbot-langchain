import { NextResponse } from 'next/server';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import {
  apiError,
  ApiError,
  authorize,
  filenameSchema,
  readBody,
  sessionSchema,
} from '@/lib/api';
import { getDatabase } from '@/lib/server-db';
import { processPDF } from '@/lib/pdf';
import {
  createEmbeddings,
  EMBEDDING_DIMENSIONS,
} from '@/lib/graphs/shared/retrieval';
import {
  MAX_UPLOAD_BYTES,
  MAX_CHUNKS,
  MAX_TEXT_CHARS,
  uploadError,
} from '@/lib/upload-limits';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const userId = await authorize(request, 'ingest');
    const db = getDatabase();
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(110000),
    ]);
    const embeddings = createEmbeddings(signal);
    const contentType = request.headers.get('content-type');
    if (!contentType?.startsWith('multipart/form-data;'))
      throw new ApiError(415, 'Expected a PDF upload');
    const bytes = await readBody(request, MAX_UPLOAD_BYTES);
    let form: FormData;
    try {
      form = await new Response(bytes as BodyInit, {
        headers: { 'Content-Type': contentType },
      }).formData();
    } catch {
      throw new ApiError(400, 'Invalid upload');
    }
    const threadId = sessionSchema.parse(form.get('threadId'));
    const entries = form.getAll('files');
    if (entries.some((entry) => typeof entry === 'string'))
      throw new ApiError(400, 'Invalid files');
    const files = entries as File[];
    const validation = uploadError(files);
    if (validation) throw new ApiError(400, validation);
    files.forEach((file) => filenameSchema.parse(file.name));
    const rawDocs: Document[] = [];
    let textLength = 0;
    for (const file of files) {
      const docs = await processPDF(file, signal);
      if (!docs.length)
        throw new ApiError(
          422,
          'A PDF contains no extractable text. Scanned PDFs need OCR first.',
        );
      textLength += docs.reduce((n, doc) => n + doc.pageContent.length, 0);
      if (textLength > MAX_TEXT_CHARS)
        throw new ApiError(413, 'Too much text. Upload a smaller document.');
      rawDocs.push(...docs);
    }
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const chunks = (await splitter.splitDocuments(rawDocs)).filter((chunk) =>
      chunk.pageContent.trim(),
    );
    if (!chunks.length || chunks.length > MAX_CHUNKS)
      throw new ApiError(413, 'Document exceeds the processing limit');
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += 32) {
      signal.throwIfAborted();
      vectors.push(
        ...(await embeddings.embedDocuments(
          chunks.slice(i, i + 32).map((chunk) => chunk.pageContent),
        )),
      );
    }
    signal.throwIfAborted();
    if (
      vectors.length !== chunks.length ||
      vectors.some(
        (v) =>
          v.length !== EMBEDDING_DIMENSIONS ||
          v.some((n) => !Number.isFinite(n)),
      )
    ) {
      throw new Error('Invalid embedding response');
    }
    const indexes = new Map<string, number>();
    const rows = chunks.map((chunk, i) => {
      const filename = String(chunk.metadata.filename);
      const index = indexes.get(filename) ?? 0;
      indexes.set(filename, index + 1);
      return {
        content: chunk.pageContent,
        metadata: { ...chunk.metadata, chunk_index: index },
        embedding: vectors[i],
      };
    });
    // One database transaction replaces only these filenames, preserving earlier uploads on failure.
    const { error } = await db
      .rpc('replace_documents', {
        p_user_id: userId,
        p_thread_id: threadId,
        p_rows: rows,
      })
      .abortSignal(signal);
    if (error?.message === 'Document quota exceeded')
      throw new ApiError(
        413,
        'Document storage limit reached. Delete older documents before uploading.',
      );
    if (error) throw new Error('Document storage failed');
    return NextResponse.json({
      success: true,
      chunksIngested: rows.length,
      filesIngested: files.length,
    });
  } catch (error) {
    return apiError(error);
  }
}
