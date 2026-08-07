// app/api/ingest/route.ts
// In-process PDF ingestion — no longer proxies to a separate LangGraph server.
// Embeddings are generated here and inserted directly into Supabase so that the
// top-level `user_id` column (not just jsonb metadata) is populated, which is
// required by the match_documents RPC filter.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { processPDF } from '@/lib/pdf';
import { checkRateLimit } from '@/lib/ratelimit';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { createClient } from '@supabase/supabase-js';
import { Document } from '@langchain/core/documents';
import { appendMetric } from '@/lib/perf'; // PERF - remove before production

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_FILE_TYPES = ['application/pdf'];

export async function POST(request: NextRequest) {
  // --- Auth ---
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // --- Rate limiting — keyed by authenticated userId ---
  const { success } = await checkRateLimit(userId);
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  // --- Env check ---
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: 'Server misconfiguration: Supabase env vars missing' },
      { status: 500 },
    );
  }
  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: 'Server misconfiguration: GOOGLE_API_KEY missing' },
      { status: 500 },
    );
  }

  try {
    // --- Parse form data ---
    const formData = await request.formData();
    const files: File[] = [];
    const threadId = formData.get('threadId');

    for (const [key, value] of formData.entries()) {
      if (
        key === 'files' &&
        value &&
        typeof value === 'object' &&
        'arrayBuffer' in value &&
        typeof (value as any).arrayBuffer === 'function'
      ) {
        files.push(value as File);
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    if (typeof threadId !== 'string' || !threadId) {
      return NextResponse.json({ error: 'Missing threadId' }, { status: 400 });
    }

    if (files.length > 5) {
      return NextResponse.json(
        { error: 'Too many files. Maximum 5 files allowed.' },
        { status: 400 },
      );
    }

    const invalidFiles = files.filter(
      (f) => !ALLOWED_FILE_TYPES.includes(f.type) || f.size > MAX_FILE_SIZE,
    );
    if (invalidFiles.length > 0) {
      return NextResponse.json(
        { error: 'Only PDF files are allowed and file size must be less than 10 MB' },
        { status: 400 },
      );
    }

    // --- Parse PDFs → raw Document chunks ---
    const rawDocs: Document[] = [];
    let pdfParseMs = 0; // PERF - remove before production
    for (const file of files) {
      try {
        const t0pdf = Date.now(); // PERF - remove before production
        const docs = await processPDF(file);
        pdfParseMs += Date.now() - t0pdf; // PERF - remove before production
        rawDocs.push(...docs);
      } catch (err: any) {
        console.error(`[ingest] Error parsing ${file.name}:`, err?.message ?? err);
        // Skip bad files; continue with the rest
      }
    }

    if (rawDocs.length === 0) {
      return NextResponse.json(
        { error: 'No valid content could be extracted from the uploaded files' },
        { status: 422 },
      );
    }

    // --- Split into smaller chunks ---
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const t0split = Date.now(); // PERF - remove before production
    const chunks = await splitter.splitDocuments(rawDocs);
    const splitMs = Date.now() - t0split; // PERF - remove before production

    // --- Generate embeddings ---
    const embeddings = new GoogleGenerativeAIEmbeddings({
      model: 'gemini-embedding-001',
      apiKey: process.env.GOOGLE_API_KEY,
    });

    // Filter out empty/whitespace-only chunks — embedding API returns [] for these,
    // causing "vector must have at least 1 dimension" on Supabase insert.
    const validChunks = chunks.filter((c) => c.pageContent.trim().length > 0);

    const texts = validChunks.map((c) => c.pageContent);
    // PERF - remove before production
    const t0embed = Date.now();
    const vectors = await embeddings.embedDocuments(texts);
    const embedMs = Date.now() - t0embed; // PERF - remove before production
    const chunksPerSec = embedMs > 0 ? Math.round((validChunks.length / (embedMs / 1000)) * 10) / 10 : 0; // PERF - remove before production

    // Also guard against API returning empty vectors for any chunk
    const safeChunks = validChunks.filter((_, i) => vectors[i]?.length > 0);

    // --- Insert directly into Supabase (Option B — top-level user_id column) ---
    // The match_documents RPC filters by documents.user_id (a top-level column, NOT
    // a jsonb key), so we must insert into that column directly rather than relying
    // on SupabaseVectorStore's metadata jsonb field.
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const rows = safeChunks.map((chunk, i) => ({
      user_id: userId,
      thread_id: threadId,
      content: chunk.pageContent,
      metadata: chunk.metadata,
      embedding: vectors[i],
    }));

    // PERF - remove before production
    const t0insert = Date.now();
    const BATCH_SIZE = 50;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase.from('documents').insert(batch);
      if (insertError) {
        console.error('[ingest] Supabase insert error:', insertError.message);
        return NextResponse.json(
          { error: 'Failed to store document embeddings', details: insertError.message },
          { status: 500 },
        );
      }
    }
    const insertMs = Date.now() - t0insert; // PERF - remove before production

    // PERF - remove before production
    await appendMetric({
      type: 'ingest',
      pdf_parse_ms: pdfParseMs,
      chunk_ms: splitMs,
      embed_ms: embedMs,
      supabase_insert_ms: insertMs,
      chunk_count: safeChunks.length,
      chunks_per_second: chunksPerSec,
      file_count: files.length,
    });

    return NextResponse.json({ success: true, chunksIngested: rows.length });
  } catch (err: any) {
    console.error('[ingest] Unexpected error:', err?.message ?? err);
    return NextResponse.json(
      { error: 'Failed to process files', details: err?.message },
      { status: 500 },
    );
  }
}
