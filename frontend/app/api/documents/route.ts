// app/api/documents/route.ts
// Lists and deletes uploaded documents (grouped by filename) for the current
// user, scoped to a specific chat thread — mirrors the same user_id/thread_id
// isolation used by ingest/chat/history.

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
  if (!threadId) {
    return NextResponse.json(
      { error: 'threadId is required' },
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
    .select('metadata')
    .eq('user_id', userId)
    .eq('thread_id', threadId);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to list documents', details: error.message },
      { status: 500 },
    );
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const filename = (row.metadata as Record<string, unknown> | null)?.filename;
    if (typeof filename !== 'string') continue;
    counts.set(filename, (counts.get(filename) ?? 0) + 1);
  }

  const documents = Array.from(counts.entries()).map(
    ([filename, chunkCount]) => ({ filename, chunkCount }),
  );

  return NextResponse.json({ documents });
}

export async function DELETE(request: NextRequest) {
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let threadId: unknown;
  let filename: unknown;
  try {
    const body = await request.json();
    threadId = body.threadId;
    filename = body.filename;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof threadId !== 'string' || typeof filename !== 'string') {
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

  // Scoped by user_id + thread_id + filename together — never touches
  // another user's rows or another thread's rows, even if filenames collide.
  const { error, count } = await supabase
    .from('documents')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .eq('thread_id', threadId)
    .eq('metadata->>filename', filename);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to delete document', details: error.message },
      { status: 500 },
    );
  }

  if (!count) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, chunksDeleted: count });
}
