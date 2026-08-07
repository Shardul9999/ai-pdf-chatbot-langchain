# AI PDF Chatbot — Project Context for Claude Code

## Project Status: ~65% Complete (Locally Working, Not Yet Deployed)

This is a full-stack AI PDF chatbot. A user uploads PDF files, the system chunks and stores them as vector embeddings in Supabase, and a chat interface lets the user ask questions about the uploaded PDFs using RAG (Retrieval-Augmented Generation).

---

## Tech Stack

### Monorepo
- **Package manager**: npm workspaces + Turborepo
- **Root**: `e:\ai-pdf-chatbot-langchain\`
- **Workspaces**: `frontend/`, `backend/`

### Frontend (`frontend/`)
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui components
- **State**: React `useState` / `useRef`
- **Chat persistence**: Supabase JS client (`@supabase/supabase-js`)
- **LangGraph communication**: `@langchain/langgraph-sdk` (SSE streaming)
- **PDF parsing**: `pdf-parse` (in Next.js API route)

### Backend (`backend/`)
- **Runtime**: Node.js (ESM, TypeScript compiled with `tsc`)
- **Framework**: LangGraph (`@langchain/langgraph`) dev server via `node run_backend.js`
- **LLM**: Groq (`groq/llama-3.1-8b-instant`) via `@langchain/groq`
- **Embeddings**: Google Gemini (`gemini-embedding-001`, 3072 dimensions) via `@langchain/google-genai`
- **Vector store**: Supabase pgvector via `@langchain/community/vectorstores/supabase`
- **Supabase client**: `@supabase/supabase-js` (service_role key — server-side only)

---

## How to Run Locally

```bash
# Terminal 1 — Backend LangGraph server (runs on port 2024)
npm run langgraph:dev --workspace=backend

# Terminal 2 — Frontend Next.js dev server (runs on port 3000)
npm run dev --workspace=frontend
```

Build backend after any TypeScript changes:
```bash
npm run build --workspace=backend
```

---

## Environment Variables

### `backend/.env`
```env
OPENAI_API_KEY=           # Not actively used — kept for legacy
GROQ_API_KEY=gsk_...      # LLM for chat (llama-3.1-8b-instant)
GOOGLE_API_KEY=AIzaSy...  # Embeddings (gemini-embedding-001) — must be from aistudio.google.com
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # service_role secret key (NOT anon key)
```

### `frontend/.env`
```env
NEXT_PUBLIC_LANGGRAPH_API_URL=http://127.0.0.1:2024
LANGCHAIN_API_KEY=local
LANGGRAPH_INGESTION_ASSISTANT_ID=ingestion_graph
LANGGRAPH_RETRIEVAL_ASSISTANT_ID=retrieval_graph
LANGCHAIN_TRACING_V2=false
LANGCHAIN_PROJECT="pdf-chatbot"
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...  # anon/public key (NOT service_role)
```

---

## Supabase Database Schema

### `documents` table — PDF vector chunks
```sql
create table documents (
  id uuid primary key default gen_random_uuid(),
  content text,
  metadata jsonb,
  embedding vector(3072)   -- 3072 dims for gemini-embedding-001
);

create function match_documents (
  query_embedding vector(3072),
  match_count int DEFAULT null,
  filter jsonb DEFAULT '{}'
) returns table (id uuid, content text, metadata jsonb, similarity float)
language plpgsql as $$
#variable_conflict use_column
begin
  return query
  select id, content, metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where metadata @> filter
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

### `chat_history` table — Persistent conversation storage
```sql
create table chat_history (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb,
  created_at timestamptz default now()
);

create index chat_history_session_id_idx on chat_history(session_id);
```

> ⚠️ **RLS is currently DISABLED** on both tables. This means all data is publicly accessible to anyone with the anon key. This is acceptable for local development but MUST be fixed before deployment.

---

## Architecture & Data Flow

### PDF Upload Flow
```
User selects PDF in browser
  → POST /api/ingest (Next.js API route, frontend/app/api/ingest/route.ts)
  → PDF parsed with pdf-parse → splits into Document chunks
  → POST to LangGraph backend (port 2024) → ingestion_graph
  → ingestDocs node in backend/src/ingestion_graph/graph.ts
  → makeRetriever() checks env vars: SUPABASE keys present → uses SupabaseVectorStore
  → GoogleGenerativeAIEmbeddings (gemini-embedding-001) creates 3072-dim vectors
  → Vectors inserted into Supabase `documents` table
```

### Chat Flow
```
User types message
  → page.tsx calls POST /api/chat (frontend/app/api/chat/route.ts)
  → API route streams from LangGraph backend (port 2024) → retrieval_graph
  → checkQueryType node: router decides 'retrieve' or 'direct' (almost always 'retrieve')
  → If 'retrieve': retrieveDocuments → similarity search in Supabase
  → generateResponse: Groq LLM answers using retrieved chunks as context
  → SSE stream back to frontend → messages updated in real-time
  → After complete: messages saved to Supabase `chat_history` table
```

### Session / Chat History Flow
```
Page loads
  → Check localStorage for 'chatSessionId' and 'chatThreadId'
  → If found: load messages from Supabase chat_history, restore thread
  → If not found: create new LangGraph thread, save IDs to localStorage
  
On page refresh: messages are restored from Supabase ✅
After backend restart: messages visible in UI but AI starts fresh (LangGraph thread in RAM is wiped) ⚠️
```

---

## Key Source Files

### Backend
| File | Purpose |
|------|---------|
| `backend/src/ingestion_graph/graph.ts` | LangGraph graph: PDF ingestion node. Has debug `console.log` statements (should be removed for production) |
| `backend/src/retrieval_graph/graph.ts` | LangGraph graph: Router → retrieval → LLM response |
| `backend/src/retrieval_graph/prompts.ts` | System prompts for router (biased toward 'retrieve') and response generation |
| `backend/src/shared/retrieval.ts` | `makeRetriever()` — switches between Supabase and in-memory based on env vars |
| `backend/src/shared/configuration.ts` | `ensureBaseConfiguration()` — auto-falls back to 'memory' if Supabase keys are missing |
| `backend/run_backend.js` | Loads `.env` manually, spawns LangGraph dev server |

### Frontend
| File | Purpose |
|------|---------|
| `frontend/app/page.tsx` | Main chat UI — all chat state, session management, Supabase persistence |
| `frontend/app/api/ingest/route.ts` | Next.js API route: receives PDF, parses it, sends to LangGraph ingestion_graph |
| `frontend/app/api/chat/route.ts` | Next.js API route: proxies SSE stream from LangGraph retrieval_graph |
| `frontend/lib/supabase.ts` | Supabase client + `loadChatHistory()` + `saveChatMessage()` helpers |
| `frontend/lib/langgraph-client.ts` | LangGraph SDK client pointing to localhost:2024 |
| `frontend/constants/graphConfigs.ts` | Chat config: model=`groq/llama-3.1-8b-instant`, retriever=`supabase`, k=5 |

---

## What's Fully Working ✅

1. **PDF Upload** — User can upload PDFs, they are parsed, chunked, embedded, and stored in Supabase `documents` table
2. **Vector Search** — Supabase pgvector similarity search using `gemini-embedding-001` (3072 dims) works correctly
3. **Chat / RAG** — AI answers questions about uploaded PDFs using Groq LLM + retrieved context
4. **Routing** — Router correctly sends PDF-related questions to retrieval and general questions directly to LLM
5. **Streaming** — Chat responses stream via SSE from LangGraph → Next.js → browser
6. **Chat History Persistence** — Messages saved to Supabase `chat_history`, loaded on page refresh via localStorage session ID
7. **New Chat** — Button to clear session and start a fresh conversation
8. **Error handling** — Upload/chat errors shown via toast notifications
9. **In-memory fallback** — If Supabase keys are missing, falls back to `SimpleMemoryRetriever` (keyword search, in-memory)

---

## What's NOT Done Yet ❌ (Remaining Work)

### 🔴 Critical for Deployment

1. **Backend deployment** — `npm run langgraph:dev` is DEV ONLY. For production, choose one of:
   - **Option A**: Deploy to LangGraph Cloud (paid, managed)
   - **Option B**: Refactor backend logic into Next.js API routes (removes separate backend entirely, deploy everything to Vercel)
   - **Option C**: Self-host on a VPS with Docker

2. **No user isolation in Supabase** — All users share one `documents` table. User A's PDF is accessible to User B. Fix: add `user_id` or `session_id` to document metadata on ingest, filter by it on retrieval.

3. **RLS (Row Level Security) disabled** — Supabase tables have no access control. Must enable RLS before deployment.

4. **Remove debug console.logs** — `backend/src/ingestion_graph/graph.ts` has debug logs added during development that should be cleaned up.

### 🟡 Important

5. **No authentication** — Anyone with the URL can use the chatbot and burn API quotas. Add Clerk or NextAuth.js.

6. **No rate limiting** — `/api/ingest` and `/api/chat` have no rate limiting. Add `@upstash/ratelimit`.

7. **AI memory across backend restarts** — LangGraph thread state is in-memory. After restart, chat history is visible in UI (from Supabase) but the AI doesn't know about prior messages. Fix: inject Supabase chat history into LangGraph thread on reconnect.

8. **Frontend env vars for production** — `NEXT_PUBLIC_LANGGRAPH_API_URL` hardcodes `localhost:2024`. Must point to deployed backend URL.

### 🟢 Nice to Have

9. **Multiple PDFs per user** — With user isolation implemented, a user could build a knowledge base from multiple PDFs
10. **Delete documents** — No UI or API to remove uploaded PDFs from Supabase
11. **Conversation-aware retrieval** — Retrieval only uses the current question, not conversation context. Multi-turn queries like "tell me more about that" don't work well.
12. **Test file cleanup** — `backend/test_embeddings.mjs` was created for debugging and should be deleted or gitignored

---

## Known Gotchas & Lessons Learned

### Google Embedding Models
- The model names changed: `text-embedding-004` and `embedding-001` no longer exist in the API
- **Current correct model**: `gemini-embedding-001` (3072 dimensions, NOT 768)
- API keys must come from **aistudio.google.com** (keys starting with `AIzaSy...`)
- Keys from Google Cloud Console with `AQ.` prefix do NOT work with this API

### Supabase Vector Dimensions
- Old schemas used `vector(768)` or `vector(1536)` — these are WRONG for `gemini-embedding-001`
- **Current schema must use `vector(3072)`** — changing dimensions requires dropping and recreating the table

### LangGraph Backend Config
- `retrieverProvider` defaults to `'supabase'` but auto-falls back to `'memory'` if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` env vars are empty
- The backend uses `service_role` key (full DB access), the frontend uses `anon` key (limited access)
- Backend must be built (`npm run build --workspace=backend`) after any TypeScript changes before running

### Chat Session Design
- `session_id` and `thread_id` are the same value (LangGraph's `thread.thread_id`)
- Both stored in `localStorage` under keys `'chatSessionId'` and `'chatThreadId'`
- `loadChatHistory()` queries Supabase by `session_id`
- `saveChatMessage()` is called AFTER the full SSE stream completes, not during streaming

---

## Security Issues to Fix Before Deployment
- `Supabase passoword.txt` file was added to `.gitignore` — verify it's not committed to git
- `backend/test_embeddings.mjs` contains API key loading logic — delete before deployment
- RLS disabled on all Supabase tables
- No auth, no rate limiting

---

## Running Commands Reference

```bash
# Build backend TypeScript
npm run build --workspace=backend

# Start backend dev server (port 2024)
npm run langgraph:dev --workspace=backend

# Start frontend (port 3000)
npm run dev --workspace=frontend

# Test Google embeddings (debug script, delete before production)
node backend/test_embeddings.mjs

# Install a package in a specific workspace
npm install <package> --workspace=frontend
npm install <package> --workspace=backend
```
