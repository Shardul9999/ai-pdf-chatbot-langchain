#!/usr/bin/env node
// PreToolUse hook: block direct Edit/Write to the real .env file (holds live
// secrets). Allows .env.example and .env.local. Exit code 2 blocks the tool call.

import { readFileSync } from 'fs';
import { basename } from 'path';

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

const filePath = data?.tool_input?.file_path ?? '';
const base = basename(filePath);

if (base === '.env') {
  console.error(
    'BLOCKED: direct edits to .env are disabled by a project hook (holds live Supabase/Clerk/Groq/Google/Upstash secrets). Edit it manually outside Claude Code if this is intentional.',
  );
  process.exit(2);
}

process.exit(0);
