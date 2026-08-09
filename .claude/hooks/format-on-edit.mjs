#!/usr/bin/env node
// PostToolUse hook: auto-format edited files with Prettier.
// Reads the tool-call JSON from stdin (Claude Code's hook input format).

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

let raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0);
}

const filePath = data?.tool_input?.file_path;
if (!filePath) process.exit(0);
if (!/\.(ts|tsx|js|jsx|json|css|md)$/.test(filePath)) process.exit(0);
if (filePath.includes('node_modules') || filePath.includes('extrathings')) {
  process.exit(0);
}

try {
  execSync(`npx prettier --write "${filePath}"`, {
    cwd: 'e:/ai-pdf-chatbot-langchain',
    stdio: 'ignore',
  });
} catch {
  // Non-fatal: don't block the edit if formatting fails (e.g. syntax error mid-edit).
}

process.exit(0);
