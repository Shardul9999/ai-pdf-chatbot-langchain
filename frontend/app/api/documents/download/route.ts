import { NextResponse } from 'next/server';
import {
  apiError,
  ApiError,
  authorize,
  filenameSchema,
  sessionSchema,
} from '@/lib/api';
import { documentRows } from '@/lib/documents';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const userId = await authorize(request, 'read');
    const params = new URL(request.url).searchParams;
    const threadId = sessionSchema.parse(params.get('threadId'));
    const filename = filenameSchema.parse(params.get('filename'));
    const rows = await documentRows(userId, threadId, filename);
    if (!rows.length) throw new ApiError(404, 'Document not found');
    rows.sort(
      (a, b) =>
        Number(a.metadata?.chunk_index ?? 0) -
        Number(b.metadata?.chunk_index ?? 0),
    );
    const name = `${filename.replace(/\.pdf$/i, '')}.txt`;
    const encoded = encodeURIComponent(name).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new NextResponse(rows.map((row) => row.content).join('\n\n'), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="document.txt"; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
