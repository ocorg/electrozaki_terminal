import { NextRequest, NextResponse }         from 'next/server'
import { createClient, createUntypedClient } from '@/lib/supabase/server'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json()
  const rawImei: string = (body.imei ?? '').trim()
  if (!rawImei) return NextResponse.json({ error: 'IMEI requis' }, { status: 400 })

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

  // Valider la session
  const { data: session } = await supabase
    .from('inventory_sessions')
    .select('session_id, statut')
    .eq('session_id', params.id)
    .eq('store_id', profile.store_id)
    .maybeSingle()

  if (!session)             return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
  if (session.statut !== 'en_cours') return NextResponse.json({ error: 'Session déjà terminée' }, { status: 409 })

  const now = new Date().toISOString()

  // Chercher l'IMEI dans les articles de session
  const { data: existingItem } = await supabase
    .from('inventory_session_items')
    .select('*')
    .eq('session_id', params.id)
    .eq('imei', rawImei)
    .maybeSingle()

  if (existingItem) {
    // Déjà traité (trouvé, hors_périmètre, non_enregistré…)
    if (existingItem.resultat !== 'en_attente') {
      return NextResponse.json({ type: 'déjà_scanné', item: existingItem })
    }

    // CAS A — en périmètre, marquer trouvé
    const { data: updated, error } = await supabase
      .from('inventory_session_items')
      .update({ resultat: 'trouvé', scanned_at: now })
      .eq('item_id', existingItem.item_id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ type: 'trouvé', item: updated })
  }

  // IMEI absent de la session — chercher dans la table phones
  const { data: phone } = await supabase
    .from('phones')
    .select('phone_id, marque, model, status')
    .eq('imei', rawImei)
    .eq('is_deleted', false)
    .maybeSingle()

  if (phone) {
    // CAS B — téléphone en DB mais hors périmètre (ex: vendu)
    const marque      = ((phone as any).marque ?? '').trim()
    const model       = ((phone as any).model  ?? '').trim()
    const cleanModel  = model.replace(/\s*\d+(GB|TB)\s*$/i, '').trim()
    const phone_label = cleanModel.toLowerCase().startsWith(marque.toLowerCase())
      ? cleanModel
      : `${marque} ${cleanModel}`.trim()

    const { data: hpItem, error: hpError } = await supabase
      .from('inventory_session_items')
      .insert({
        session_id:   params.id,
        phone_id:     (phone as any).phone_id,
        imei:         rawImei,
        phone_label,
        phone_status: (phone as any).status,
        resultat:     'hors_périmètre',
        scanned_at:   now,
      })
      .select()
      .single()

    if (hpError) return NextResponse.json({ error: hpError.message }, { status: 500 })
    return NextResponse.json({ type: 'hors_périmètre', item: hpItem })
  }

  // CAS C — IMEI inconnu, jamais enregistré
  const { data: unknownItem, error: unknownError } = await supabase
    .from('inventory_session_items')
    .insert({
      session_id:   params.id,
      phone_id:     null,
      imei:         rawImei,
      phone_label:  null,
      phone_status: null,
      resultat:     'non_enregistré',
      scanned_at:   now,
    })
    .select()
    .single()

  if (unknownError) return NextResponse.json({ error: unknownError.message }, { status: 500 })
  return NextResponse.json({ type: 'non_enregistré', item: unknownItem })
}