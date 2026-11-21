# Project context

Read [README.md](README.md) for the current architecture and [DEPLOYMENT.md](DEPLOYMENT.md) before deployment work.

This is a single Next.js application under `frontend/`, managed by npm workspaces. There is no separate backend or LangGraph server. Use Node.js 24 LTS.

- Run `npm run check`, `npm run format:check`, `npm audit`, and `npm run build` before release.
- Authenticate every data handler with the shared API guard. Scope every database operation by the authenticated Clerk user and session/thread.
- Keep service credentials server-only; never commit environment files.
- Keep migrations non-destructive. Existing data needs verified ownership, never a guessed owner.
- Expensive requests must fail closed if rate limiting or required services are unavailable.
- Preserve bounded uploads, isolated PDF parsing, transactional replacements, and the SSE completion-after-save contract.
- Regression tests live in `frontend/tests`; database tests use isolated PostgreSQL/pgvector and must never target live services.

## Skill Activation

At the start of any task-oriented session — any interaction where you will
use tools and produce deliverables — invoke the task-observer skill before
beginning work. This ensures skill improvement opportunities are captured
throughout the session.

When loading any skill, check the observation log for OPEN observations
tagged to that skill. Apply their insights to the current work, even if
the skill file hasn't been updated yet. This enables immediate application
of observations before they're permanently integrated during the weekly
review.
