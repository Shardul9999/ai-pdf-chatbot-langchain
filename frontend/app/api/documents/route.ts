import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  apiError,
  ApiError,
  authorize,
  filenameSchema,
  readJson,
  sessionSchema,
} from '@/lib/api';
import { getDatabase } from '@/lib/server-db';
import { documentRows } from '@/lib/documents';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const userId = await authorize(request, 'read');
    const threadId = sessionSchema.parse(
      new URL(request.url).searchParams.get('threadId'),
    );
    const rows = await documentRows(userId, threadId);
    const counts = new Map<string, number>();
    for (const row of rows) {
      const filename = row.metadata?.filename;
      if (typeof filename === 'string')
        counts.set(filename, (counts.get(filename) ?? 0) + 1);
    }
    return NextResponse.json({
      documents: Array.from(counts, ([filename, chunkCount]) => ({
        filename,
        chunkCount,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await authorize(request, 'delete');
    const { threadId, filename } = z
      .object({ threadId: sessionSchema, filename: filenameSchema })
      .parse(await readJson(request));
    const { error, count } = await getDatabase()
      .from('documents')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .eq('thread_id', threadId)
      .eq('metadata->>filename', filename);
    if (error) throw new Error('Document deletion failed');
    if (!count) throw new ApiError(404, 'Document not found');
    return NextResponse.json({ success: true, chunksDeleted: count });
  } catch (error) {
    return apiError(error);
  }
}
