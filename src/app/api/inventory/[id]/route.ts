import { NextRequest, NextResponse }         from 'next/server'
import { createClient, createUntypedClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase      = await createUntypedClient()
  const typedSupabase = await createClient()
  const { data: { user } } = await typedSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .maybeSingle()
  const profile = profileRaw as { role: string; store_id: string } | null

  if (profile?.role !== 'manager' && profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  let sessionQuery = supabase
    .from('inventory_sessions')
    .select('*')
    .eq('session_id', params.id)
  if (profile.store_id) sessionQuery = sessionQuery.eq('store_id', profile.store_id)
  const { data: session, error: sessionError } = await sessionQuery.maybeSingle()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
  }

  const { data: items, error: itemsError } = await supabase
    .from('inventory_session_items')
    .select('*')
    .eq('session_id', params.id)
    .order('scanned_at', { ascending: false, nullsFirst: false })

  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

  return NextResponse.json({ session, items: items ?? [] })
}