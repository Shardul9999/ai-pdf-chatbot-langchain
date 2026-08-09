---
name: env-secrets-check
description: Verify frontend/.env is properly gitignored, .env.example has no real values, and no API key patterns have leaked into any tracked or staged file. Run before committing or pushing.
---

Run this check before any commit/push that might touch env-related files, or when explicitly asked to check for secret leakage.

Steps:

1. Confirm `.env` is gitignored, not tracked:
   ```bash
   git check-ignore -v frontend/.env frontend/.env.local
   git ls-files frontend/.env frontend/.env.local  # should print nothing
   ```

2. Confirm `frontend/.env.example` has no real secret values — every line should be `KEY=` (empty) or an obviously fake/placeholder value, never a real key, URL with a real project ref, or token.

3. Grep the whole tree (excluding node_modules, extrathings/, .git) for common API key shapes that shouldn't be in tracked files:
   ```bash
   grep -rEn "AIzaSy[A-Za-z0-9_-]{10,}|gsk_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{10,}|eyJhbGciOi[A-Za-z0-9._-]{15,}" \
     --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=extrathings .
   ```
   Any match outside `.env`/`.env.local` is a real problem — report it and do not proceed with the commit until resolved.

4. If a commit is about to happen, run `git status` after staging and re-check the file list for anything unexpected (stray `.env` copies, credential dumps, `Supabase passwords.txt`, etc.) before confirming.

Report a clear pass/fail with specifics — don't just say "looks fine."
