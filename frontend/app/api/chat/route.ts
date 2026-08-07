// app/api/chat/route.ts
// In-process RAG pipeline — no longer proxies to a separate LangGraph server.
// Retrieves documents from Supabase, calls Groq LLM, streams SSE back to the client.
// SSE event format matches what page.tsx expects (messages/partial, updates, messages).

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { checkRateLimit } from '@/lib/ratelimit';
import { makeRetriever } from '@/lib/graphs/shared/retrieval';
import { ChatGroq } from '@langchain/groq';
import { createClient } from '@supabase/supabase-js';
import { Document } from '@langchain/core/documents';
import { appendMetric } from '@/lib/perf'; // PERF - remove before production

// Node.js runtime required — uses Supabase client and LangChain packages that
// are not compatible with the Vercel edge runtime.
export const runtime = 'nodejs';

const SYSTEM_PROMPT =
  'You are a helpful assistant. Answer questions based on the provided document context. ' +
  'If the context does not contain relevant information, say so clearly but still try to be helpful.';

export async function POST(req: Request) {
  const requestArrival = Date.now(); // PERF - remove before production
  // --- Auth ---
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Rate limiting — keyed by authenticated userId ---
  const { success } = await checkRateLimit(userId);
  if (!success) {
    return new NextResponse(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Parse request body ---
  let message: string;
  let sessionId: string | undefined;
  let threadId: string | undefined;
  try {
    const body = await req.json();
    message = body.message;
    sessionId = body.sessionId;
    threadId = body.threadId;
  } catch {
    return new NextResponse(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!message) {
    return new NextResponse(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // sessionId is used for chat history; threadId is accepted for compatibility
  // but session state no longer lives in LangGraph RAM — everything is in Supabase.
  const activeSessionId = sessionId ?? threadId;

  if (!activeSessionId) {
    return new NextResponse(JSON.stringify({ error: 'sessionId or threadId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Env check ---
  if (!process.env.GROQ_API_KEY) {
    return new NextResponse(JSON.stringify({ error: 'Server misconfiguration: GROQ_API_KEY missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ event, data })}\n\n`),
        );
      };

      try {
        // --- 1. Retrieve relevant documents ---
        const retriever = await makeRetriever(userId, activeSessionId);
        let retrievedDocs: Document[] = [];
        try {
          retrievedDocs = await retriever._getRelevantDocuments(message);
        } catch (err: any) {
          console.error('[chat] Retrieval error:', err?.message ?? err);
          // Non-fatal: continue with empty context
        }

        // Emit retrieved documents in the format page.tsx expects
        enqueue('updates', {
          retrieveDocuments: {
            documents: retrievedDocs.map((d) => ({
              pageContent: d.pageContent,
              metadata: d.metadata,
            })),
          },
        });

        // --- 2. Load chat history from Supabase ---
        let historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
          try {
            const supabase = createClient(
              process.env.SUPABASE_URL,
              process.env.SUPABASE_SERVICE_ROLE_KEY,
            );
            const { data } = await supabase
              .from('chat_history')
              .select('role, content')
              .eq('session_id', activeSessionId)
              .eq('user_id', userId)
              .order('created_at', { ascending: true })
              .limit(20);
            if (data) {
              historyMessages = data as Array<{ role: 'user' | 'assistant'; content: string }>;
            }
          } catch (err: any) {
            console.error('[chat] Chat history load error:', err?.message ?? err);
          }
        }

        // --- 3. Build context string from retrieved docs ---
        const context = retrievedDocs.length > 0
          ? retrievedDocs.map((d, i) => `[Document ${i + 1}]\n${d.pageContent}`).join('\n\n---\n\n')
          : 'No relevant documents found.';

        // --- 4. Build messages for Groq ---
        const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          {
            role: 'system',
            content: `${SYSTEM_PROMPT}\n\nRelevant context from uploaded documents:\n\n${context}`,
          },
          ...historyMessages,
          { role: 'user', content: message },
        ];

        // --- 5. Stream Groq response ---
        const groq = new ChatGroq({
          model: 'llama-3.1-8b-instant',
          apiKey: process.env.GROQ_API_KEY,
          streaming: true,
        });

        let fullContent = '';
        // PERF - remove before production
        let ttftMs: number | null = null;
        let firstTokenSeen = false;
        const t0stream = Date.now();

        const groqStream = await groq.stream(
          chatMessages.map((m) => ({ role: m.role, content: m.content })) as any,
        );

        for await (const chunk of groqStream) {
          const delta = chunk.content;
          if (typeof delta === 'string' && delta) {
            // PERF - remove before production
            if (!firstTokenSeen) {
              ttftMs = Date.now() - requestArrival;
              firstTokenSeen = true;
            }
            fullContent += delta;
            // Emit streaming partial event in the format page.tsx expects
            enqueue('messages/partial', [
              { type: 'ai', content: fullContent },
            ]);
          }
        }

        // Emit final complete message
        enqueue('messages', [{ type: 'ai', content: fullContent }]);

        // PERF - remove before production
        await appendMetric({
          type: 'chat',
          ttft_ms: ttftMs,
          llm_stream_ms: Date.now() - t0stream,
          output_chars: fullContent.length,
          output_tokens_approx: Math.round(fullContent.length / 4),
        });

        // --- 6. Persist messages to Supabase after stream completes ---
        if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && fullContent) {
          try {
            const supabase = createClient(
              process.env.SUPABASE_URL,
              process.env.SUPABASE_SERVICE_ROLE_KEY,
            );
            await supabase.from('chat_history').insert([
              {
                user_id: userId,
                session_id: activeSessionId,
                role: 'user',
                content: message,
                sources: null,
              },
              {
                user_id: userId,
                session_id: activeSessionId,
                role: 'assistant',
                content: fullContent,
                sources: retrievedDocs.length > 0
                  ? retrievedDocs.map((d) => ({ pageContent: d.pageContent, metadata: d.metadata }))
                  : null,
              },
            ]);
          } catch (err: any) {
            // Non-fatal: UI already shows the response; just log the failure
            console.error('[chat] Failed to persist chat history:', err?.message ?? err);
          }
        }
      } catch (err: any) {
        console.error('[chat] Pipeline error:', err?.message ?? err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: 'Streaming error occurred' })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
