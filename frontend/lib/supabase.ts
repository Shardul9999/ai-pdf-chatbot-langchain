import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type ChatHistoryRow = {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: any[] | null;
  created_at: string;
};

/**
 * Load all messages for a given session from Supabase, oldest first.
 */
export async function loadChatHistory(sessionId: string): Promise<ChatHistoryRow[]> {
  const { data, error } = await supabase
    .from('chat_history')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error loading chat history:', error.message);
    return [];
  }
  return data ?? [];
}

/**
 * Save a single message to Supabase.
 */
export async function saveChatMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  sources?: any[],
): Promise<void> {
  const { error } = await supabase.from('chat_history').insert({
    session_id: sessionId,
    role,
    content,
    sources: sources ?? null,
  });

  if (error) {
    console.error('Error saving chat message:', error.message);
  }
}
