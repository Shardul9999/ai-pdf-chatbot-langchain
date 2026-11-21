# Deployment runbook

## Release prerequisites

Use Node.js 24 LTS. Provision Clerk, Supabase with pgvector, Upstash Redis, Google Gemini API access, and Groq. Configure production credentials from `frontend/.env.example`. Public Clerk settings must be present during the build; other secrets are runtime-only.

Apply migration **003** to an existing database that already has migrations 001–002. For a fresh database, apply all three in order. Back up first and verify `documents.embedding` is `vector(3072)`. Stop old application instances while rolling out the RPC change: old code may not be compatible with the tightened function signatures.

## Container deployment

From the repository root:

```sh
docker build --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" -t readr:release .
docker run --rm --name readr -p 3000:3000 --memory=1g --cpus=2 --env-file /secure/path/readr.env readr:release
```

Use your hosting platform's secret manager or a protected environment file outside the repository. The image excludes environment files and runs as a non-root user. Its health check calls `/api/health`.

Terminate HTTPS at the ingress. Preserve the original host/protocol so same-origin checks resolve correctly. Limit request bodies to 4 MB, set an upstream timeout of at least 120 seconds, and disable response buffering on `/api/chat` so SSE streams promptly. Verify worker threads and the packaged PDF parser operate on the target architecture.

## Managed Next.js hosting

Use the repository root for installation (`npm ci`) and `npm run build` for the build. The application is in `frontend`; configure the host's monorepo/Next.js application directory accordingly. All processing routes require the **Node.js runtime**, worker-thread support, and up to 120 seconds of execution time. Confirm your plan supports those limits. A host with shorter execution or request limits requires lower application limits or an asynchronous upload pipeline.

Use `npm start` for a conventional Node server. The build also produces `frontend/.next/standalone`; the Dockerfile shows how to package its static files and public assets. Do not expose `next dev` publicly.

## Acceptance checks with real services

1. Sign in and out using production Clerk configuration. Verify data APIs return JSON 401 for signed-out requests.
2. Upload a small text PDF, ask a question with a verifiable answer, refresh, and confirm messages and sources persist.
3. Upload the same filename again and verify it replaces the old contents. Submit malformed and oversized PDFs and verify clear errors without partial documents.
4. Use a second account and another chat. Confirm neither can retrieve, list, export, or delete the first account's documents.
5. Export a Unicode filename, delete a document, and confirm it disappears from retrieval. Existing historical quotes remain by design.
6. Interrupt a streamed answer and verify the app recovers. Temporarily disable Redis in staging and confirm expensive requests fail closed. Restore Redis afterward.
7. Verify TLS, SSE delivery, ingress size/time limits, error monitoring, backup recovery, and provider spend alerts. Run a capacity test using expected document sizes and concurrent users before opening access broadly.

## Operational ownership

- Watch 401/429/5xx rates, provider latency, upload failures, database growth, and monthly AI spend. The liveness endpoint intentionally omits secrets and does not query providers.
- Configure Supabase backups and test a restore. Treat documents, embeddings, and chat-source snapshots as private data.
- Establish a retention policy and an operator procedure to delete a verified user's `documents` and `chat_history` rows when required. Clerk account deletion alone does not remove them.
- Automatic dependency update PRs and CI are configured. Keep runtime images and service credentials current.
- Default 3,072-dimensional embeddings use exact vector search within the owner/thread filter. Do not add a conventional pgvector `vector` HNSW index at this dimension without checking its limits. Review query plans and retrieval latency as usage grows.

## Rollback

Keep the previous application artifact and a database backup. Migration 003 is additive for stored data but changes privileges/RPC contracts. Roll back application and schema together using a reviewed migration or backup; do not restore permissive RPCs or public table grants just to make old code run. New uploads rely on `replace_documents`.
