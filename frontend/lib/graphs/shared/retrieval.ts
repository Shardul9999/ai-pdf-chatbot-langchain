import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { createClient } from '@supabase/supabase-js';
import { Document } from '@langchain/core/documents';
import { BaseRetriever } from '@langchain/core/retrievers';
import { appendMetric } from '@/lib/perf'; // PERF - remove before production

// ---------------------------------------------------------------------------
// SimpleMemoryRetriever — keyword-based in-memory fallback (no external deps)
// ---------------------------------------------------------------------------
export class SimpleMemoryRetriever extends BaseRetriever {
  lc_namespace = ['langchain', 'retrievers'];
  private static docs: Document[] = [];

  constructor(fields?: any) {
    super(fields);
  }

  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    if (queryWords.length === 0) {
      return SimpleMemoryRetriever.docs.slice(0, 5);
    }

    const scoredDocs = SimpleMemoryRetriever.docs.map((doc) => {
      const content = doc.pageContent.toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        if (content.includes(word)) score += 1;
      }
      return { doc, score };
    });

    const filtered = scoredDocs.filter((item) => item.score > 0);
    if (filtered.length > 0) {
      return filtered
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((item) => item.doc);
    }

    return SimpleMemoryRetriever.docs.slice(0, 5);
  }

  async addDocuments(documents: Document[]): Promise<void> {
    SimpleMemoryRetriever.docs.push(...documents);
  }
}

// ---------------------------------------------------------------------------
// SupabaseUserRetriever — calls match_documents with p_user_id for isolation
// ---------------------------------------------------------------------------
export class SupabaseUserRetriever extends BaseRetriever {
  lc_namespace = ['langchain', 'retrievers'];

  private supabaseUrl: string;
  private serviceRoleKey: string;
  private userId: string;
  private threadId: string | null;
  private k: number;

  constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    userId: string,
    threadId: string | null = null,
    k = 5,
  ) {
    super();
    this.supabaseUrl = supabaseUrl;
    this.serviceRoleKey = serviceRoleKey;
    this.userId = userId;
    this.threadId = threadId;
    this.k = k;
  }

  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const embeddings = new GoogleGenerativeAIEmbeddings({
      model: 'gemini-embedding-001',
      apiKey: process.env.GOOGLE_API_KEY,
    });

    const queryEmbedding = await embeddings.embedQuery(query);

    const supabaseClient = createClient(this.supabaseUrl, this.serviceRoleKey);

    // PERF - remove before production
    const t0search = Date.now();
    const { data, error } = await supabaseClient.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_count: this.k,
      filter: {},
      p_user_id: this.userId,
      p_thread_id: this.threadId,
    });
    const vectorSearchMs = Date.now() - t0search; // PERF - remove before production

    if (error) {
      throw new Error(`match_documents RPC failed: ${error.message}`);
    }

    // PERF - remove before production
    await appendMetric({
      type: 'retrieval',
      vector_search_ms: vectorSearchMs,
      docs_returned: (data ?? []).length,
      top_similarity: (data ?? [])[0]?.similarity ?? null,
    });

    return (data ?? []).map(
      (row: {
        content: string;
        metadata: Record<string, any>;
        id: string;
        similarity: number;
      }) =>
        new Document({
          pageContent: row.content,
          metadata: { ...row.metadata, id: row.id, similarity: row.similarity },
        }),
    );
  }
}

// ---------------------------------------------------------------------------
// makeRetriever — public factory used by API routes
// ---------------------------------------------------------------------------
export async function makeRetriever(
  userId: string,
  threadId: string | null = null,
): Promise<BaseRetriever> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      '[makeRetriever] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — falling back to in-memory retriever',
    );
    return new SimpleMemoryRetriever();
  }

  return new SupabaseUserRetriever(
    supabaseUrl,
    serviceRoleKey,
    userId,
    threadId,
  );
}
