#!/usr/bin/env node
// PERF - remove before production
// Usage: node analyze_metrics.js
// Reads performance_metrics.json from the same directory and prints averages
// plus pre-filled resume bullet sentences using your actual numbers.

const fs = require('fs');
const path = require('path');

const METRICS_FILE = path.join(__dirname, 'performance_metrics.json');

// ── Stat helpers ──────────────────────────────────────────────────────────────

function nums(arr, key) {
  return arr.map((e) => e[key]).filter((v) => v != null && !isNaN(v));
}

function avg(values) {
  if (!values.length) return null;
  return (
    Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
  );
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0
    ? Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10
    : s[m];
}

function p95(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)];
}

function fmt(v, unit = 'ms') {
  return v == null ? 'n/a' : `${v}${unit}`;
}

// ── Load data ─────────────────────────────────────────────────────────────────

let all;
try {
  all = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log('No performance_metrics.json found yet.');
    console.log('Run the app, upload a PDF, and send a chat message first.');
  } else {
    console.error('Error reading metrics file:', err.message);
  }
  process.exit(1);
}

if (!all.length) {
  console.log(
    'Metrics file is empty. Upload a PDF and send a chat message to populate it.',
  );
  process.exit(0);
}

const ingest = all.filter((e) => e.type === 'ingest');
const chat = all.filter((e) => e.type === 'chat');
const ret = all.filter((e) => e.type === 'retrieval');

console.log('\n════════════════════════════════════════════════════════');
console.log('  PERFORMANCE METRICS ANALYSIS');
console.log('════════════════════════════════════════════════════════');
console.log(
  `  Total entries : ${all.length}  (${ingest.length} ingest · ${chat.length} chat · ${ret.length} retrieval)`,
);
console.log(
  `  Date range    : ${all[0]?.ts?.slice(0, 10)} → ${all.at(-1)?.ts?.slice(0, 10)}\n`,
);

// ── Ingest waterfall ──────────────────────────────────────────────────────────

if (ingest.length) {
  const parseMs = nums(ingest, 'pdf_parse_ms');
  const chunkMs = nums(ingest, 'chunk_ms');
  const embedMs = nums(ingest, 'embed_ms');
  const insertMs = nums(ingest, 'supabase_insert_ms');
  const cps = nums(ingest, 'chunks_per_second');
  const counts = nums(ingest, 'chunk_count');

  console.log(
    '── INGEST WATERFALL (' +
      ingest.length +
      ' runs) ──────────────────────────',
  );
  console.log(
    `  A. PDF parse        avg ${fmt(avg(parseMs))}   median ${fmt(median(parseMs))}`,
  );
  console.log(
    `  B. Text chunking    avg ${fmt(avg(chunkMs))}   median ${fmt(median(chunkMs))}`,
  );
  console.log(
    `  C. Embedding gen    avg ${fmt(avg(embedMs))}   median ${fmt(median(embedMs))}`,
  );
  console.log(
    `  D. Supabase insert  avg ${fmt(avg(insertMs))}   median ${fmt(median(insertMs))}`,
  );
  console.log(
    `  Chunks per second   avg ${fmt(avg(cps), '')}   peak ${fmt(cps.length ? Math.max(...cps) : null, '')}`,
  );
  console.log(
    `  Chunk count         avg ${fmt(avg(counts), '')} chunks per upload\n`,
  );
}

// ── Vector search ─────────────────────────────────────────────────────────────

if (ret.length) {
  const searchMs = nums(ret, 'vector_search_ms');
  const sims = nums(ret, 'top_similarity');
  const docs = nums(ret, 'docs_returned');

  console.log(
    '── VECTOR SEARCH (' +
      ret.length +
      ' queries) ──────────────────────────────',
  );
  console.log(
    `  Latency        avg ${fmt(avg(searchMs))}   median ${fmt(median(searchMs))}   p95 ${fmt(p95(searchMs))}`,
  );
  console.log(
    `  Top similarity avg ${avg(sims)?.toFixed(3) ?? 'n/a'}   min ${sims.length ? Math.min(...sims).toFixed(3) : 'n/a'}   max ${sims.length ? Math.max(...sims).toFixed(3) : 'n/a'}`,
  );
  console.log(`  Docs returned  avg ${fmt(avg(docs), '')}\n`);
}

// ── Chat / LLM ────────────────────────────────────────────────────────────────

if (chat.length) {
  const ttft = nums(chat, 'ttft_ms');
  const streamMs = nums(chat, 'llm_stream_ms');
  const chars = nums(chat, 'output_chars');

  console.log(
    '── CHAT / LLM (' +
      chat.length +
      ' requests) ──────────────────────────────',
  );
  console.log(
    `  TTFT           avg ${fmt(avg(ttft))}   median ${fmt(median(ttft))}   p95 ${fmt(p95(ttft))}`,
  );
  console.log(
    `  Stream total   avg ${fmt(avg(streamMs))}   median ${fmt(median(streamMs))}`,
  );
  console.log(
    `  Output length  avg ${fmt(avg(chars), ' chars')}  (~${Math.round((avg(chars) ?? 0) / 4)} tokens)\n`,
  );
}

// ── Resume bullets ────────────────────────────────────────────────────────────

console.log('════════════════════════════════════════════════════════');
console.log('  RESUME BULLETS  (copy-paste ready, filled with your numbers)');
console.log('════════════════════════════════════════════════════════\n');

if (ingest.length) {
  const cps = nums(ingest, 'chunks_per_second');
  const embedMs = nums(ingest, 'embed_ms');
  const parseMs = nums(ingest, 'pdf_parse_ms');
  const chunkMs = nums(ingest, 'chunk_ms');
  const insertMs = nums(ingest, 'supabase_insert_ms');
  const counts = nums(ingest, 'chunk_count');

  console.log(
    '•  Engineered a full-stack RAG ingestion pipeline (PDF → chunk →',
  );
  console.log(
    `   embed → pgvector) achieving ${avg(cps) ?? '?'} chunks/sec average throughput`,
  );
  console.log(`   with Google gemini-embedding-001 (3 072-dim vectors)\n`);

  console.log(
    '•  Profiled ingest waterfall across ' + ingest.length + ' runs: PDF parse',
  );
  console.log(
    `   ${fmt(avg(parseMs))} · chunking ${fmt(avg(chunkMs))} · embedding ${fmt(avg(embedMs))} ·`,
  );
  console.log(
    `   Supabase insert ${fmt(avg(insertMs))} per ~${Math.round(avg(counts) ?? 0)}-chunk document\n`,
  );
}

if (ret.length) {
  const searchMs = nums(ret, 'vector_search_ms');
  const sims = nums(ret, 'top_similarity');

  console.log('•  Implemented semantic vector search over Supabase pgvector');
  console.log(
    `   (cosine similarity) with ${fmt(median(searchMs))} median latency and`,
  );
  console.log(
    `   ${avg(sims)?.toFixed(3) ?? '?'} average top-document similarity score across ${ret.length} queries\n`,
  );
}

if (chat.length) {
  const ttft = nums(chat, 'ttft_ms');
  const streamMs = nums(chat, 'llm_stream_ms');

  console.log(
    '•  Delivered end-to-end RAG chat with ' +
      fmt(median(ttft)) +
      ' median time-to-first-',
  );
  console.log(
    `   token (TTFT) and ${fmt(median(streamMs))} median stream duration using`,
  );
  console.log(
    `   Groq llama-3.1-8b-instant over SSE, across ${chat.length} measured requests\n`,
  );
}

console.log('════════════════════════════════════════════════════════\n');
