import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  let userId: string
  try {
    userId = await getCurrentUserId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ messages: [] })
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
    const { data, error } = await supabase
      .from('chat_history')
      .select('id, session_id, role, content, sources, created_at')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[history] Supabase error:', error.message)
      return NextResponse.json({ messages: [] })
    }

    return NextResponse.json({ messages: data ?? [] })
  } catch (err: any) {
    console.error('[history] Error:', err?.message ?? err)
    return NextResponse.json({ messages: [] })
  }
}
