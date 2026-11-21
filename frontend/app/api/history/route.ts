import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, ApiError, authorize, sessionSchema } from '@/lib/api';
import { getDatabase } from '@/lib/server-db';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const userId = await authorize(req, 'read');
    const params = new URL(req.url).searchParams;
    const sessionId = sessionSchema.parse(params.get('sessionId'));
    const before = params.get('before');
    let query = getDatabase()
      .from('chat_history')
      .select('id, session_id, role, content, sources, created_at')
      .eq('user_id', userId)
      .eq('session_id', sessionId);
    if (before) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(before);
      } catch {
        throw new ApiError(400, 'Invalid history cursor');
      }
      const cursor = z
        .object({
          time: z.string().datetime({ offset: true }),
          id: z.string().uuid(),
        })
        .parse(decoded);
      query = query.or(
        `created_at.lt.${cursor.time},and(created_at.eq.${cursor.time},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(101);
    if (error) throw new Error('History load failed');
    const page = (data ?? []).slice(0, 100);
    const last = page.at(-1);
    const nextCursor =
      data && data.length > 100 && last
        ? JSON.stringify({ time: last.created_at, id: last.id })
        : null;
    return NextResponse.json({ messages: page.reverse(), nextCursor });
  } catch (error) {
    return apiError(error);
  }
}
