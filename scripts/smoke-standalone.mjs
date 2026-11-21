// Verify the built artifact without resolving dependencies from the source tree.
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';

const directory = await mkdtemp(path.join(tmpdir(), 'readr-smoke-'));
let server;
try {
  await cp('frontend/.next/standalone', directory, { recursive: true });
  await cp(
    'frontend/.next/static',
    path.join(directory, 'frontend/.next/static'),
    { recursive: true },
  );
  await cp('frontend/public', path.join(directory, 'frontend/public'), {
    recursive: true,
  });
  const appDir = path.join(directory, 'frontend');
  const parserPath = createRequire(path.join(appDir, 'package.json')).resolve(
    'pdf-parse',
  );
  assert.ok(
    parserPath.startsWith(directory),
    'Parser must resolve inside the artifact',
  );
  const pdf = new PDFDocument();
  const buffers = [];
  pdf.on('data', (b) => buffers.push(b));
  const pdfDone = once(pdf, 'end');
  pdf.text('Standalone PDF works');
  pdf.end();
  await pdfDone;
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    const { PDFParse } = require(workerData.parserPath);
    (async () => {
      const parser = new PDFParse({ data: new Uint8Array(workerData.bytes) });
      try { parentPort.postMessage((await parser.getText()).text); }
      finally { await parser.destroy(); }
    })().catch(error => { throw error; });
  `,
    { eval: true, workerData: { parserPath, bytes: Buffer.concat(buffers) } },
  );
  const timeout = setTimeout(() => void worker.terminate(), 30000);
  try {
    const [text] = await Promise.race([
      once(worker, 'message'),
      once(worker, 'exit').then(() => {
        throw new Error('PDF worker exited before responding');
      }),
    ]);
    assert.match(text, /Standalone PDF works/);
  } finally {
    clearTimeout(timeout);
    await worker.terminate();
  }
  server = spawn(process.execPath, ['frontend/server.js'], {
    cwd: directory,
    env: {
      ...process.env,
      PORT: '3187',
      HOSTNAME: '127.0.0.1',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_bG9jYWwudGVzdCQ=',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (data) => {
    output += data;
  });
  server.stderr.on('data', (data) => {
    output += data;
  });
  let response;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      response = await fetch('http://127.0.0.1:3187/api/health');
      if (response.ok) break;
    } catch {
      /* Starting. */
    }
    if (server.exitCode !== null) throw new Error(`Server exited: ${output}`);
    await delay(200);
  }
  assert.ok(response?.ok, `Health check failed: ${output}`);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('cache-control'), /no-store/);
  console.log(
    'Standalone package: PDF worker, server startup, health response, and security headers passed.',
  );
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
  await rm(directory, { recursive: true, force: true });
}
