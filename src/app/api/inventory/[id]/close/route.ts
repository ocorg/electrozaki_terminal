import { NextRequest, NextResponse }         from 'next/server'
import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { logActivity }                       from '@/lib/utils/logger'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
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

  const { data: session } = await supabase
    .from('inventory_sessions')
    .select('*')
    .eq('session_id', params.id)
    .eq('store_id', profile.store_id)
    .maybeSingle()

  if (!session)                       return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
  if (session.statut !== 'en_cours')  return NextResponse.json({ error: 'Session déjà terminée' }, { status: 409 })

  // Marquer tous les en_attente → manquant
  await supabase
    .from('inventory_session_items')
    .update({ resultat: 'manquant' })
    .eq('session_id', params.id)
    .eq('resultat', 'en_attente')

  // Clôturer la session
  const { data: closedSession, error: closeError } = await supabase
    .from('inventory_sessions')
    .update({ statut: 'terminée', completed_at: new Date().toISOString() })
    .eq('session_id', params.id)
    .select()
    .single()

  if (closeError) return NextResponse.json({ error: closeError.message }, { status: 500 })

  // Récupérer les compteurs finaux
  const { data: allItems } = await supabase
    .from('inventory_session_items')
    .select('resultat')
    .eq('session_id', params.id)

  const counts = (allItems ?? []).reduce((acc: Record<string, number>, i: any) => {
    acc[i.resultat] = (acc[i.resultat] ?? 0) + 1
    return acc
  }, {})

  await logActivity({
    user_id:     user.id,
    store_id:    profile.store_id,
    user_name:   profile.display_name,
    module:      'inventaire' as any,
    action_type: 'UPDATE',
    after_state: { session_id: params.id, counts },
  })

  return NextResponse.json({ session: closedSession, counts })
}