<!-- # AI PDF Chatbot

A full-stack RAG (Retrieval-Augmented Generation) chatbot. Upload PDFs, they get
chunked and embedded into a vector store, and a chat interface answers questions
about them — scoped per signed-in user and per chat thread.

Originally forked from the [Learning LangChain (O'Reilly)](https://www.oreilly.com/library/view/learning-langchain/9781098167271)
template, which paired a Next.js frontend with a standalone LangGraph backend
server. That backend has since been retired — see [Architecture](#architecture)
below for what replaced it.

## Features

- **PDF ingestion** — upload a PDF, it's parsed, split into chunks, embedded, and stored in Supabase (pgvector)
- **RAG chat** — ask questions about your uploaded PDFs; answers are grounded in retrieved chunks, streamed token-by-token
- **Auth** — Clerk-backed sign-in/sign-up; every route that touches data requires a signed-in user
- **Per-user, per-thread isolation** — each user only ever retrieves their own documents, scoped further to the chat thread they were uploaded in
- **Chat history persistence** — conversations reload from Supabase on page refresh
- **Rate limiting** — ingest and chat endpoints are rate-limited per user via Upstash Redis

## Architecture

There is no separate backend process. What used to be a standalone LangGraph
dev server (`backend/`, port 2024) has been folded directly into Next.js API
routes — everything runs in one deployable app.

```
Browser (app/page.tsx)
  │
  ├─ POST /api/ingest   → parse PDF → chunk → embed (Gemini) → insert into Supabase `documents`
  ├─ POST /api/chat     → embed query → match_documents RPC (Supabase pgvector)
  │                        → build context → stream answer from Groq → persist to `chat_history`
  └─ GET  /api/history  → reload prior messages for the current thread on page load
```

All three API routes are gated by Clerk middleware and require a resolved
`userId` before touching the database. Document retrieval and chat history are
filtered by both `user_id` (Clerk) and `thread_id`/`session_id`, so users never
see each other's documents, and starting a new chat gives a clean document
context instead of pulling in every PDF a user has ever uploaded.

## Tech Stack

| Layer            | Technology                                                                          |
| ---------------- | ----------------------------------------------------------------------------------- |
| Framework        | Next.js 14 (App Router), TypeScript                                                 |
| Styling          | Tailwind CSS + shadcn/ui (Radix primitives)                                         |
| Auth             | Clerk (`@clerk/nextjs`)                                                             |
| LLM              | Groq — `llama-3.1-8b-instant` (`@langchain/groq`)                                   |
| Embeddings       | Google Gemini — `gemini-embedding-001`, 3072 dimensions (`@langchain/google-genai`) |
| Vector store     | Supabase Postgres + `pgvector`, accessed via `@supabase/supabase-js`                |
| Rate limiting    | Upstash Redis + `@upstash/ratelimit`                                                |
| PDF parsing      | `pdf-parse`                                                                         |
| Monorepo tooling | npm workspaces + Turborepo                                                          |

## Project Structure

```
frontend/
  app/
    page.tsx                 # chat UI — state, streaming, uploads
    api/
      ingest/route.ts        # PDF upload → chunk → embed → store
      chat/route.ts          # retrieval + Groq streaming + history persistence
      history/route.ts       # reload chat history for a thread (service-role, RLS-safe)
    (auth)/sign-in, sign-up/  # Clerk prebuilt auth pages
  lib/
    auth.ts                  # getCurrentUserId() — Clerk helper used by every API route
    ratelimit.ts             # Upstash sliding-window rate limiter
    supabase.ts               # browser-side Supabase client (anon key)
    pdf.ts                    # PDF parsing helper
    graphs/shared/
      retrieval.ts            # SupabaseUserRetriever — user/thread-scoped vector search
      configuration.ts        # env-aware retriever configuration
  middleware.ts               # Clerk route protection
supabase/
  migrations/
    001_add_user_id_and_rls.sql   # user_id columns + RLS on documents/chat_history
    002_add_thread_id.sql         # thread_id column + updated match_documents RPC
```

## Prerequisites

You'll need accounts/keys for:

- A [Supabase](https://supabase.com) project with the `pgvector` extension enabled
- A [Clerk](https://dashboard.clerk.com) application
- A [Groq](https://console.groq.com) API key
- A [Google AI Studio](https://aistudio.google.com) API key (**not** a Google Cloud Console key — see [Gotchas](#gotchas))
- An [Upstash](https://upstash.com) Redis database (for rate limiting)

## Setup

```bash
git clone <this-repo-url>
cd ai-pdf-chatbot-langchain
npm install
```

Apply the database schema — run the SQL files in `supabase/migrations/` against
your Supabase project, in order, via the Supabase SQL editor or CLI:

```
supabase/migrations/001_add_user_id_and_rls.sql
supabase/migrations/002_add_thread_id.sql
```

Copy `frontend/.env.example` to `frontend/.env` and fill in real values (see
[Environment Variables](#environment-variables) below).

Run it:

```bash
npm run dev --workspace=frontend
```

The app is served at `http://localhost:3000`.

## Environment Variables

All variables live in `frontend/.env`. See `frontend/.env.example` for the
authoritative list of names.

| Variable                                                     | Where it's used                                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                   | Browser-side Supabase client                                                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                              | Browser-side Supabase client (anon/public key)                                |
| `SUPABASE_URL`                                               | Server-side (API routes)                                                      |
| `SUPABASE_SERVICE_ROLE_KEY`                                  | Server-side only — full DB access, bypasses RLS. Never expose to the browser. |
| `GROQ_API_KEY`                                               | Chat completion (`llama-3.1-8b-instant`)                                      |
| `GOOGLE_API_KEY`                                             | Embeddings (`gemini-embedding-001`) — must come from aistudio.google.com      |
| `UPSTASH_REDIS_REST_URL`                                     | Rate limiting                                                                 |
| `UPSTASH_REDIS_REST_TOKEN`                                   | Rate limiting                                                                 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                          | Clerk client SDK                                                              |
| `CLERK_SECRET_KEY`                                           | Clerk server SDK — server-side only                                           |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `_SIGN_UP_URL`             | Clerk route config (`/sign-in`, `/sign-up`)                                   |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` / `_AFTER_SIGN_UP_URL` | Clerk redirect targets (`/`)                                                  |

## Database Schema

`documents` — PDF chunks with embeddings, scoped by user and thread:

```sql
create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  thread_id text,
  content text,
  metadata jsonb,
  embedding vector(3072)
);
```

`chat_history` — persisted conversation turns, scoped by user and session:

```sql
create table chat_history (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  session_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb,
  created_at timestamptz default now()
);
```

Retrieval goes through a `match_documents` RPC that accepts `p_user_id` and
`p_thread_id` filters (see `supabase/migrations/002_add_thread_id.sql` for the
exact signature). Row Level Security is enabled on both tables; since every
write happens server-side through Next.js API routes using the service-role
key (already gated by Clerk before any DB call), the RLS policies are a
defense-in-depth backstop rather than the primary access control.

## Gotchas

- **Google embedding model**: the correct model is `gemini-embedding-001`
  (3072 dimensions). Keys must come from aistudio.google.com — keys from
  Google Cloud Console (`AQ.` prefix) do not work with this API.
- **Vector dimensions**: the schema uses `vector(3072)`. Changing embedding
  models with a different dimension count requires dropping and recreating
  the `documents` table.
- **Session/thread IDs**: the frontend uses a single UUID as both `sessionId`
  and `threadId` (see `createNewSession()` in `app/page.tsx`) — they are the
  same value, not two independent identifiers.

## Known Limitations

- Not yet deployed — the app runs locally only; a Vercel deploy has not been done
- `frontend/lib/langgraph-client.ts` and `langgraph-server.ts` are dead code
  left over from the pre-migration architecture and are not imported anywhere
- No UI to delete previously uploaded documents
- Retrieval only considers the current question, not prior conversation turns

## License

MIT — see [LICENSE](LICENSE). -->

# AI PDF Chatbot

![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat&logo=typescript)
![Supabase](https://img.shields.io/badge/Supabase-pgvector-emerald?style=flat&logo=supabase)
![Groq](https://img.shields.io/badge/LLM-Groq%20Llama%203.1-orange?style=flat)
![Clerk](https://img.shields.io/badge/Auth-Clerk-6C47FF?style=flat&logo=clerk)
![License](https://img.shields.io/badge/License-MIT-green?style=flat)

A full-stack Retrieval-Augmented Generation (RAG) chatbot application. Upload PDFs, auto-generate vector embeddings stored in Supabase (`pgvector`), and ask questions in a real-time streamed chat interface—fully isolated per user and chat thread.

Originally derived from the [Learning LangChain (O'Reilly)](https://www.oreilly.com/library/view/learning-langchain/9781098167271) template, this project folds the backend RAG pipeline directly into Next.js API routes for a streamlined, serverless-ready architecture.

---

## Key Features

- **PDF Ingestion & Chunking**: Parses PDFs on the fly (`pdf-parse`), chunks text, and generates 3072-dimensional vector embeddings using Google Gemini.
- **Context-Aware RAG Chat**: Answers questions strictly using retrieved document context with token-by-token streaming via Groq (`llama-3.1-8b-instant`).
- **User & Thread Isolation**: Strict multi-tenant isolation via Clerk authentication and database Row-Level Security (RLS). Embeddings and chats are filtered by both `user_id` and `thread_id`.
- **Chat History Persistence**: Reloads conversation history per session directly from Supabase.
- **Rate Limiting**: Sliding-window rate limiting on ingestion and chat endpoints powered by Upstash Redis.

---

## Architecture

The standalone LangGraph server (`backend/`, port 2024) has been retired and consolidated directly into Next.js API Routes (`frontend/app/api/*`).

```
                              ┌──────────────────────────┐
                              │  Browser (app/page.tsx)  │
                              └────────────┬─────────────┘
                                           │
           ┌───────────────────────────────┼───────────────────────────────┐
           │                               │                               │
           ▼                               ▼                               ▼
POST /api/ingest               POST /api/chat                  GET /api/history
 ├─ Parse PDF (`pdf-parse`)     ├─ Embed Query (Gemini)         └─ Fetch prior messages
 ├─ Chunk & Embed (Gemini)      ├─ Similarity Match (pgvector)     filtered by `user_id`
 └─ Store in Supabase           ├─ Stream Answer (Groq)            and `session_id`
    `documents` table           └─ Persist to `chat_history`
```

### API Reference

| Endpoint | Method | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `/api/ingest` | `POST` | Accepts multipart PDF data, chunks, embeds, and stores vectors. | Yes |
| `/api/chat` | `POST` | Accepts user prompt, performs vector similarity search, streams LLM output. | Yes |
| `/api/history` | `GET` | Fetches historical messages for a given `sessionId` / `threadId`. | Yes |

---

## Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Framework** | Next.js 14 (App Router) | Full-stack serverless framework |
| **Language** | TypeScript | Type safety across API & UI |
| **Styling** | Tailwind CSS + shadcn/ui | UI components and styling |
| **Auth** | Clerk (`@clerk/nextjs`) | Authentication & User Management |
| **LLM Inference** | Groq (`llama-3.1-8b-instant`) | Fast token streaming response |
| **Embeddings** | Google Gemini (`gemini-embedding-001`) | 3072-dimensional vector generation |
| **Vector Database**| Supabase Postgres (`pgvector`) | Storage & Similarity Search (RPC) |
| **Rate Limiting** | Upstash Redis | Sliding window endpoint protection |
| **Monorepo** | Turborepo + npm workspaces | Monorepo structure management |

---

## Project Structure

```
ai-pdf-chatbot-langchain/
├── frontend/
│   ├── app/
│   │   ├── (auth)/                 # Clerk authentication pages
│   │   ├── api/
│   │   │   ├── chat/route.ts       # RAG logic + streaming completion
│   │   │   ├── history/route.ts    # Thread history fetcher
│   │   │   └── ingest/route.ts     # Document parsing & vector storage
│   │   └── page.tsx                # Main Chat & PDF Upload UI
│   ├── lib/
│   │   ├── auth.ts                 # Clerk server helpers
│   │   ├── pdf.ts                  # PDF parsing wrapper
│   │   ├── ratelimit.ts            # Upstash sliding-window config
│   │   └── supabase.ts             # Supabase browser client
│   └── middleware.ts               # Route protection & auth gating
└── supabase/
    └── migrations/                 # PostgreSQL & pgvector schema migrations
```

---

## Getting Started

### 1. Prerequisites

Obtain API keys from the following services before getting started:
- [Supabase](https://supabase.com) (Postgres Database with `pgvector` enabled)
- [Clerk Application](https://dashboard.clerk.com)
- [Groq Console API Key](https://console.groq.com)
- [Google AI Studio API Key](https://aistudio.google.com) (*Note: Google Cloud Console keys are not supported*)
- [Upstash Redis Database](https://upstash.com)

### 2. Installation

Clone the repository and install dependencies:

```bash
git clone <your-repo-url>
cd ai-pdf-chatbot-langchain
npm install
```

### 3. Database Migration

Run the migration scripts in order within your Supabase SQL Editor:

1. `supabase/migrations/001_add_user_id_and_rls.sql`
2. `supabase/migrations/002_add_thread_id.sql`

### 4. Environment Variables

Create a `.env` file inside the `frontend/` directory:

```bash
cp frontend/.env.example frontend/.env
```

Populate `frontend/.env` with your service credentials:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# AI Providers
GROQ_API_KEY=gsk_...
GOOGLE_API_KEY=AIzaSy...

# Rate Limiting (Upstash)
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=...

# Auth (Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

### 5. Run the Application

Start the development server:

```bash
npm run dev --workspace=frontend
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Database Schema

### `documents`
Stores parsed PDF chunks and vector embeddings scoped by user and thread.

```sql
create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  thread_id text,
  content text,
  metadata jsonb,
  embedding vector(3072)
);
```

### `chat_history`
Stores persistent chat messages for session recovery.

```sql
create table chat_history (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  session_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb,
  created_at timestamptz default now()
);
```

---

## Critical Gotchas & Notes

> **Google API Key Source**: Embeddings require model `gemini-embedding-001` (3072 dimensions). Your key **must** come from [Google AI Studio](https://aistudio.google.com). Keys generated via Google Cloud Console (starting with `AQ.`) will fail.

> **Vector Dimensions**: The database schema explicitly targets `vector(3072)`. Switching to a different embedding provider or model requires updating the column definition and re-indexing existing documents.

> **Thread & Session Mapping**: In the UI (`app/page.tsx`), `sessionId` and `threadId` utilize the same generated UUID to isolate document context and chat history simultaneously.

---

## Roadmap & Future Enhancements

- [ ] **Deployment**: Add Vercel deployment configuration and build scripts.
- [ ] **Document Management**: Build UI for viewing, downloading, and deleting uploaded documents.
- [ ] **Multi-Turn Contextual Retrieval**: Rephrase questions based on chat history before querying the vector database.
- [ ] **Dead Code Cleanup**: Remove legacy unused LangGraph client utilities (`frontend/lib/langgraph-*`).

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.