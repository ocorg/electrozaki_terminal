import { NextResponse }              from 'next/server'
import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { logActivity }               from '@/lib/utils/logger'

// ── GET /api/inventory — liste des sessions avec compteurs ──
export async function GET() {
  const supabase      = await createUntypedClient()
  const typedSupabase = await createClient()
  const { data: { user } } = await typedSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, store_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const profile = profileRaw as { role: string; store_id: string } | null

  if (profile?.role !== 'manager' && profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const { data: sessions, error } = await supabase
    .from('inventory_sessions')
    .select('*, inventory_session_items(resultat)')
    .eq('store_id', profile.store_id)
    .order('started_at', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const enriched = (sessions ?? []).map((s: any) => {
    const nestedItems = s.inventory_session_items as { resultat: string }[]
    const counts = nestedItems.reduce((acc: Record<string, number>, i) => {
      acc[i.resultat] = (acc[i.resultat] ?? 0) + 1
      return acc
    }, {})
    const { inventory_session_items: _, ...session } = s
    return { ...session, counts }
  })

  return NextResponse.json({ sessions: enriched })
}

// ── POST /api/inventory — démarrer une nouvelle session ──
export async function POST() {
  const supabase      = await createUntypedClient()
  const typedSupabase = await createClient()
  const { data: { user } } = await typedSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, store_id, display_name')
    .eq('user_id', user.id)
    .maybeSingle()
  const profile = profileRaw as { role: string; store_id: string; display_name: string } | null

  if (profile?.role !== 'manager' && profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // Bloquer si une session est déjà en cours
  const { data: existing } = await supabase
    .from('inventory_sessions')
    .select('session_id')
    .eq('store_id', profile.store_id)
    .eq('statut', 'en_cours')
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'Une vérification est déjà en cours', session_id: existing.session_id },
      { status: 409 }
    )
  }

  // Snapshot des téléphones en périmètre
  const { data: phones, error: phonesError } = await supabase
    .from('phones')
    .select('phone_id, imei, marque, model, status')
    .eq('store_id', profile.store_id)
    .eq('is_deleted', false)
    .in('status', ['disponible', 'réservé', 'en réparation'])

  if (phonesError) return NextResponse.json({ error: phonesError.message }, { status: 500 })

  const phoneList = (phones ?? []) as any[]

  // Créer la session
  const { data: session, error: sessionError } = await supabase
    .from('inventory_sessions')
    .insert({
      store_id:       profile.store_id,
      created_by:     user.id,
      snapshot_count: phoneList.length,
      statut:         'en_cours',
    })
    .select()
    .single()

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })

  // Insérer les articles de session
  if (phoneList.length > 0) {
    const items = phoneList.map((p) => {
      const marque      = (p.marque ?? '').trim()
      const model       = (p.model  ?? '').trim()
      const cleanModel  = model.replace(/\s*\d+(GB|TB)\s*$/i, '').trim()
      const phone_label = cleanModel.toLowerCase().startsWith(marque.toLowerCase())
        ? cleanModel
        : `${marque} ${cleanModel}`.trim()

      return {
        session_id:   session.session_id,
        phone_id:     p.phone_id,
        imei:         p.imei,
        phone_label,
        phone_status: p.status,
        resultat:     'en_attente',
      }
    })

    const { error: itemsError } = await supabase
      .from('inventory_session_items')
      .insert(items)

    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })
  }

  await logActivity({
    user_id:     user.id,
    store_id:    profile.store_id,
    user_name:   profile.display_name,
    module:      'inventaire' as any,
    action_type: 'INSERT',
    after_state: { session_id: session.session_id, snapshot_count: phoneList.length },
  })

  return NextResponse.json({ session })
}