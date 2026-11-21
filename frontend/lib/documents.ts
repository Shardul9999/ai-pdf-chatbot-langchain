import { getDatabase } from '@/lib/server-db';

/** Fetch pages explicitly: Supabase otherwise silently caps exports at 1,000 rows. */
export async function documentRows(
  userId: string,
  threadId: string,
  filename?: string,
) {
  const db = getDatabase();
  const rows: Array<{
    content?: string;
    metadata: Record<string, unknown> | null;
  }> = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    let query = db
      .from('documents')
      .select('content, metadata')
      .eq('user_id', userId)
      .eq('thread_id', threadId)
      .order('id')
      .range(offset, offset + 499);
    if (filename) query = query.eq('metadata->>filename', filename);
    const { data, error } = await query;
    if (error) throw new Error('Document read failed');
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 500) return rows;
  }
  // Existing databases may exceed the new quota; never silently truncate an export.
  throw new Error('Document read limit exceeded');
}
