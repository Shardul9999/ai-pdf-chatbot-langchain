import { Document } from '@langchain/core/documents';
import { getDatabase, requireEnv } from '@/lib/server-db';

export const EMBEDDING_DIMENSIONS = 3072;
// Use the embedding REST endpoint so cancellation also stops the upstream request.
export function createEmbeddings(signal?: AbortSignal) {
  const apiKey = requireEnv('GOOGLE_API_KEY');
  const embedDocuments = async (texts: string[]): Promise<number[][]> => {
    const timeout = AbortSignal.timeout(30000);
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: 'models/gemini-embedding-001',
            content: { parts: [{ text }] },
          })),
        }),
      },
    );
    if (!response.ok) throw new Error('Embedding service unavailable');
    const result = (await response.json()) as {
      embeddings?: Array<{ values?: number[] }>;
    };
    const vectors = result.embeddings?.map((item) => item.values);
    if (
      !vectors ||
      vectors.length !== texts.length ||
      vectors.some(
        (v) =>
          !v ||
          v.length !== EMBEDDING_DIMENSIONS ||
          v.some((n) => !Number.isFinite(n)),
      )
    )
      throw new Error('Invalid embedding response');
    return vectors as number[][];
  };
  return {
    embedDocuments,
    embedQuery: async (text: string) => (await embedDocuments([text]))[0],
  };
}

export async function retrieveDocuments(
  userId: string,
  threadId: string,
  query: string,
  signal: AbortSignal,
): Promise<Document[]> {
  const queryEmbedding = await createEmbeddings(signal).embedQuery(query);
  signal.throwIfAborted();
  const { data, error } = await getDatabase()
    .rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_count: 5,
      filter: {},
      p_user_id: userId,
      p_thread_id: threadId,
    })
    .abortSignal(signal);
  if (error) throw new Error('Document retrieval failed');
  return (data ?? []).map(
    (row: {
      content: string;
      metadata: Record<string, unknown>;
      id: string;
      similarity: number;
    }) =>
      new Document({
        pageContent: row.content,
        metadata: { ...row.metadata, id: row.id, similarity: row.similarity },
      }),
  );
}
