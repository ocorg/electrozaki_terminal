import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { searchParams } = new URL(request.url)
    const supplier_id = searchParams.get('supplier_id')
    const store_id    = searchParams.get('store_id')
    const mode        = searchParams.get('mode')

    // Mode : téléphones vendus non réglés pour le flow Fournisseur A
    if (mode === 'unsettled_phones' && supplier_id) {
      const { data, error } = await supabase
        .from('phones_unsettled_a')
        .select('phone_id, fournisseur_id, marque, model, imei, couleur, stockage, prix_achat, cash_recu, fac_ref, sold_at')
        .eq('fournisseur_id', supplier_id)
        .order('sold_at', { ascending: false })
      if (error) throw error
      return NextResponse.json({ data })
    }

    // Mode par défaut : historique des paiements
    let query = supabase
      .from('supplier_payments')
      .select('*')
      .eq('is_deleted', false)
      .order('date_paiement', { ascending: false })

    if (supplier_id) query = query.eq('supplier_id', supplier_id)
    if (store_id)    query = query.eq('store_id', store_id)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase      = await createUntypedClient()
    const typedSupabase = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, store_id, role')
      .eq('id', user.id)
      .single() as { data: { display_name: string; store_id: string | null; role: string } | null }

    if (!['manager', 'owner'].includes(profile?.role ?? '')) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await request.json()
    const resolvedStoreId = body.store_id ?? profile?.store_id ?? null
    const today = new Date().toISOString().split('T')[0]

    if (!body.supplier_id)
      return NextResponse.json({ error: 'supplier_id requis' }, { status: 400 })
    if (!body.montant || Number(body.montant) <= 0)
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })
    if (!['REGLEMENT_A', 'AVANCE_A', 'PAIEMENT_B'].includes(body.payment_type))
      return NextResponse.json({ error: 'payment_type invalide' }, { status: 400 })

    // Insertion du paiement
    const { data, error } = await supabase
      .from('supplier_payments')
      .insert({
        supplier_id:   body.supplier_id,
        payment_type:  body.payment_type,
        montant:       Number(body.montant),
        phone_ids:     body.phone_ids ?? [],
        date_paiement: body.date_paiement ?? today,
        notes:         body.notes ?? null,
        store_id:      resolvedStoreId,
        created_by:    user.id,
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    // REGLEMENT_A : marquer les téléphones comme réglés
    if (
      body.payment_type === 'REGLEMENT_A' &&
      Array.isArray(body.phone_ids) &&
      body.phone_ids.length > 0
    ) {
      const { error: updateError } = await supabase
        .from('phones')
        .update({
          settled_at: new Date().toISOString(),
          settled_by: user.id,
        })
        .in('phone_id', body.phone_ids)

      if (updateError) {
        // Paiement enregistré — erreur non bloquante, loggée
        console.error('[REGLEMENT_A] settled_at update failed:', updateError)
      }
    }

    await logActivity({
      store_id:    resolvedStoreId,
      user_id:     user.id,
      user_name:   profile?.display_name ?? '—',
      action_type: 'INSERT',
      module:      'suppliers' as any,
      record_id:   data.payment_id as string,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}