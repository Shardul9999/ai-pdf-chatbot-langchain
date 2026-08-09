---
name: clean-install-verify
description: Clone this repo fresh into a scratch directory, run npm ci, and verify format:check, lint, and tsc all pass in a genuinely clean environment — catches issues masked by a stale local node_modules. Use before pushing CI-related fixes.
disable-model-invocation: true
---

This project has been bitten twice by "works locally, fails in CI" bugs caused by a stale local `node_modules` (an old Prettier binary, undeclared `eslint` dependencies) that a normal local run doesn't catch because the missing/wrong packages were already present from earlier installs.

Steps:

1. Pick a scratch directory (use the session's scratchpad if available, otherwise a temp dir) and clone fresh from the local repo:
   ```bash
   rm -rf <scratch>/ci-repro
   git clone e:/ai-pdf-chatbot-langchain <scratch>/ci-repro
   cd <scratch>/ci-repro
   ```

2. Run a genuinely clean install (not `--package-lock-only`, not reusing any existing `node_modules`):
   ```bash
   npm ci
   ```

3. Run the exact checks CI runs:
   ```bash
   npm run format:check
   npm run lint
   npx tsc --noEmit -p frontend/tsconfig.json
   ```

4. If anything fails here but passed in the main working directory, the root cause is almost always: a dependency declared nowhere but present locally via hoisting/leftover installs, or a tool version drift between the main working directory's `node_modules` and what the lockfile actually resolves. Fix by declaring the missing dependency explicitly and/or running a full `npm install` (not `--package-lock-only`) in the main working directory to resync it, then re-verify with a fresh clone again.

5. Clean up the scratch clone when done.

Report exactly which check(s) failed and why, not just pass/fail.
