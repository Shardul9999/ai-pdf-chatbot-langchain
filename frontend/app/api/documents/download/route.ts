// app/api/documents/download/route.ts
// Streams back the extracted/chunked text of a previously uploaded PDF, in
// original reading order. This is NOT the original PDF — the app never
// persists the original file bytes, only the parsed text chunks used for
// retrieval (see frontend/lib/pdf.ts, which deletes the temp file right
// after parsing).

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const threadId = request.nextUrl.searchParams.get('threadId');
  const filename = request.nextUrl.searchParams.get('filename');
  if (!threadId || !filename) {
    return NextResponse.json(
      { error: 'threadId and filename are required' },
      { status: 400 },
    );
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: 'Server misconfiguration: Supabase env vars missing' },
      { status: 500 },
    );
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data, error } = await supabase
    .from('documents')
    .select('content, metadata')
    .eq('user_id', userId)
    .eq('thread_id', threadId)
    .eq('metadata->>filename', filename);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load document', details: error.message },
      { status: 500 },
    );
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  // Ordered by chunk_index (stamped at ingest time) to reconstruct original
  // reading order. Known limitation: if the same filename was uploaded more
  // than once to this thread, indices from separate uploads can collide —
  // an accepted gap for this best-effort export, not a correctness bug in
  // the primary (single-upload-per-file) case.
  const sorted = [...data].sort((a, b) => {
    const ai = Number(
      (a.metadata as Record<string, unknown> | null)?.chunk_index ?? 0,
    );
    const bi = Number(
      (b.metadata as Record<string, unknown> | null)?.chunk_index ?? 0,
    );
    return ai - bi;
  });

  const text = sorted.map((row) => row.content).join('\n\n');
  const safeName = `${filename.replace(/\.pdf$/i, '').replace(/["\r\n]/g, '')}.txt`;

  return new NextResponse(text, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}"`,
    },
  });
}
