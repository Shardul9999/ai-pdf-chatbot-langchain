import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Document } from '@langchain/core/documents';
import { ApiError } from '@/lib/api';
import { MAX_PAGES, MAX_TEXT_CHARS } from '@/lib/upload-limits';

/** Parse untrusted PDFs in a disposable worker with a time and heap budget. */
export async function processPDF(
  file: File,
  signal?: AbortSignal,
): Promise<Document[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new ApiError(422, 'File is not a valid PDF');
  const pages = await new Promise<Array<{ num: number; text: string }>>(
    (resolve, reject) => {
      const worker = new Worker(
        `
      const { parentPort, workerData } = require('node:worker_threads');
      const { PDFParse } = require(workerData.parserPath);
      (async () => {
        const parser = new PDFParse({ data: workerData.bytes, isEvalSupported: false });
        try {
          const info = await parser.getInfo();
          if (info.total > workerData.maxPages) throw new Error('Page limit exceeded');
          const result = await parser.getText();
          if (result.text.length > workerData.maxChars) throw new Error('Text limit exceeded');
          parentPort.postMessage({ pages: result.pages });
        } finally { await parser.destroy(); }
      })().catch(() => parentPort.postMessage({ error: true }));
    `,
        {
          eval: true,
          resourceLimits: { maxOldGenerationSizeMb: 256 },
          workerData: {
            parserPath: createRequire(
              path.join(process.cwd(), 'package.json'),
            ).resolve('pdf-parse'),
            bytes,
            maxPages: MAX_PAGES,
            maxChars: MAX_TEXT_CHARS,
          },
        },
      );
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        void worker.terminate();
      };
      const fail = () => {
        cleanup();
        reject(
          new ApiError(
            422,
            'PDF could not be read. Use a text PDF of at most 100 pages.',
          ),
        );
      };
      const abort = () => {
        cleanup();
        reject(new ApiError(408, 'Upload cancelled'));
      };
      const timer = setTimeout(fail, 30000);
      worker.once('message', (result) => {
        if (result.error) fail();
        else {
          cleanup();
          resolve(result.pages);
        }
      });
      worker.once('error', fail);
      worker.once('exit', (code) => {
        if (code !== 0) fail();
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    },
  );
  return pages
    .filter((page) => page.text.trim())
    .map(
      (page) =>
        new Document({
          pageContent: page.text,
          metadata: {
            filename: file.name,
            source: file.name,
            loc: { pageNumber: page.num },
          },
        }),
    );
}
