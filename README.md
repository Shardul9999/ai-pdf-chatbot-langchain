# Readr — AI PDF chatbot

Readr is a Next.js application for asking questions about uploaded PDFs. Clerk authenticates users; Supabase stores document chunks and chat history; Google Gemini creates embeddings; Groq streams answers. There is no separate backend server.

## Quick start

Use Node.js 24 LTS and npm. From the repository root:

```sh
npm ci
cp frontend/.env.example frontend/.env.local
```

Fill in the service credentials in `frontend/.env.local`, then apply the database migrations described below. Never put service keys in variables starting with `NEXT_PUBLIC_`.

```sh
npm run dev
```

Open `http://localhost:3000`. Create an account, upload a PDF, and ask a question. The account menu supports sign-out. Each account has its own locally remembered conversation; starting a new chat creates a new document scope.

## Database setup and upgrades

Back up an existing database before applying schema changes. Apply SQL files in `supabase/migrations` in numerical order using the Supabase SQL editor or your migration system:

1. `001_add_user_id_and_rls.sql` creates missing tables without deleting existing rows.
2. `002_add_thread_id.sql` adds thread scoping.
3. `003_production_hardening.sql` removes legacy RPC overloads, requires owner/thread filters, restricts table and RPC privileges, and adds atomic document replacement.

For databases that already applied 001 and 002, apply only **003** before deploying this version. Do not rerun an older checkout's destructive version of 001. The current 001 preserves rows; it cannot restore data deleted by past migrations.

The `vector` extension and a **3072-dimensional** `documents.embedding` column are required. Existing schemas using other dimensions need an explicit data migration and re-embedding; these scripts deliberately do not drop or guess how to convert that data. Legacy rows without `user_id` or `thread_id` are retained but inaccessible through the application. Assign ownership only from verified records, or remove them under your retention policy.

Clerk IDs are text. The browser has no Supabase access: authenticated Next.js handlers use a server-only service role key and scope every operation. `anon` and `authenticated` database roles cannot access these tables or RPCs. Service-role credentials bypass RLS and must remain private.

## Configuration

| Variable                            | Purpose                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk public key, required at **build time and runtime** |
| `CLERK_SECRET_KEY`                  | Clerk server secret                                      |
| `SUPABASE_URL`                      | Supabase HTTPS project URL                               |
| `SUPABASE_SERVICE_ROLE_KEY`         | Supabase server credential                               |
| `GOOGLE_API_KEY`                    | Gemini embedding API credential                          |
| `GROQ_API_KEY`                      | Groq chat API credential                                 |
| `GROQ_MODEL`                        | Optional chat model; defaults to `llama-3.1-8b-instant`  |
| `UPSTASH_REDIS_REST_URL`            | Upstash HTTPS endpoint                                   |
| `UPSTASH_REDIS_REST_TOKEN`          | Upstash token; rate limiting is required                 |

The example environment also specifies Clerk sign-in, sign-up, and fallback redirect paths. Use production Clerk keys and configure your deployed domain in Clerk for a public release. Restart or redeploy after changing secrets; rebuild after changing public settings.

## Verification

```sh
npm run format:check
npm run check
npm audit
npm run build
npm start
```

`check` runs linting, TypeScript, API and stream regression tests, real PDF parsing, and isolated PostgreSQL/pgvector tests. Tests use mock AI/auth/storage services and an ephemeral database, never your live database. The build enforces TypeScript validation; CI also checks formatting, lint, tests, audit, and build. `npm start` validates required configuration before launching.

For CI only, a syntactically valid placeholder Clerk publishable key allows build verification without real credentials. It does **not** verify sign-in or provider connectivity.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for container and managed-host instructions, rollout checks, and operational requirements.

## Limits and behavior

- At most 5 PDFs per request, 3 MB per file, and 4 MB total HTTP body (including multipart overhead).
- At most 100 pages per file, 250,000 extracted characters per request, and 400 chunks per request. Image-only PDFs need OCR before upload.
- PDF parsing runs in a disposable worker with a 30-second deadline and a 256 MB JavaScript heap budget. Configure container memory limits as well; native allocations are outside that heap budget.
- Each user can store up to 4,000 chunks. Uploading the same filename in the same chat replaces it atomically. A parsing, embedding, or database failure preserves the previous upload.
- Per-user rate limits: 10 chat requests, 3 uploads, 60 reads, and 20 deletes per minute. Missing or unavailable Redis returns an error instead of allowing unlimited usage.
- Chat input is limited to 8,000 characters; answers to 2,048 model tokens. Retrieval uses 5 chunks and the newest 20 messages, with additional prompt-size bounds.
- History loads in pages of 100 messages. Use **Load earlier messages** for older turns. Failed history reads are displayed as errors.
- Downloads export extracted text, **not the original PDF**, and may include overlapping text from retrieval chunks. Original PDF bytes are not retained.
- Deleting a document removes its retrieval chunks. Existing chat messages and their quoted sources remain until separately removed under the application's retention policy.
- Chat replies are marked complete only after both messages have been saved. Interrupted replies display an error. A network failure after a committed write can still require refreshing to see the saved response; retries are not idempotent.

## Data handling and operations

PDF text is sent to Google for embeddings. Relevant excerpts, the question, and recent conversation history are sent to Groq for answers. Document text, embeddings, chat messages, and source excerpts are stored in Supabase. Explain this processing in your product's privacy notice before collecting user documents.

The application logs generic failure categories, not document content or provider error payloads. `/api/health` is a public **liveness** endpoint; it does not prove external services are ready. Set provider budget alerts and database backups, monitor HTTP errors and latency, and define retention/account-deletion procedures before launch. Account deletion in Clerk does not automatically delete Supabase data.

The repository has no production credentials or deployment target configured. Local checks do not replace a live two-account acceptance test and a capacity test for your expected traffic.

## Architecture

```text
Browser → Clerk-authenticated Next.js handlers
  Upload → bounded PDF worker → text chunks → Gemini embeddings
         → atomic Supabase replacement scoped to user + thread
  Chat   → scoped vector search + recent history → Groq stream
         → atomic history insert → completion event
  Manage → scoped document listing / text export / deletion
```

Fonts are bundled locally, so builds do not depend on Google Fonts access. See [LICENSE](LICENSE) for licensing.
