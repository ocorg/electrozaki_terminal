import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    // Only manager and owner can read logs
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single<{ role: string }>()

    if (!profile || !['manager', 'owner'].includes(profile.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const store_id    = searchParams.get('store_id')
    const user_id     = searchParams.get('user_id')
    const module      = searchParams.get('module')
    const action_type = searchParams.get('action_type')
    const date_from   = searchParams.get('date_from')
    const date_to     = searchParams.get('date_to')
    const limit       = searchParams.get('limit') || '100'

    let query = supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (store_id)    query = query.eq('store_id', store_id)
    if (user_id)     query = query.eq('user_id', user_id)
    if (module)      query = query.eq('module', module)
    if (action_type) query = query.eq('action_type', action_type)
    if (date_from)   query = query.gte('created_at', date_from)
    if (date_to)     query = query.lte('created_at', date_to + 'T23:59:59Z')

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}