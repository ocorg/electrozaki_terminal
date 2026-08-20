import { NextResponse } from 'next/server'
import { createClient, createUntypedClient } from '@/lib/supabase/server'

// ── GET /api/warranty ─────────────────────────────────────────────────────────
// Retourne le statut de garantie complet pour une vente.
// Params (au moins un requis) : ?txn_id= | ?facture_ref= | ?imei=

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await createUntypedClient()
    const { searchParams } = new URL(request.url)
    const txn_id      = searchParams.get('txn_id')
    const facture_ref = searchParams.get('facture_ref')
    const imei        = searchParams.get('imei')

    if (!txn_id && !facture_ref && !imei) {
      return NextResponse.json(
        { error: 'txn_id, facture_ref ou imei requis' },
        { status: 400 }
      )
    }

    let resolvedTxnId: string | null = txn_id

    // ── Résolution IMEI → txn_id ─────────────────────────────────────────────
    if (imei && !resolvedTxnId) {
      const { data: phoneRaw } = await supabase
        .from('phones')
        .select('phone_id')
        .eq('imei', imei.trim())
        .eq('store_id', 'EZ-001')
        .maybeSingle()

      const phone = phoneRaw as { phone_id: string } | null
      if (!phone?.phone_id) {
        return NextResponse.json({ error: 'Aucun téléphone trouvé pour cet IMEI' }, { status: 404 })
      }

      const { data: txnByPhoneRaw } = await supabase
        .from('transactions')
        .select('txn_id')
        .eq('device_id', phone.phone_id)
        .eq('voided', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      resolvedTxnId = (txnByPhoneRaw as any)?.txn_id ?? null
      if (!resolvedTxnId) {
        return NextResponse.json({ error: 'Aucune vente trouvée pour cet IMEI' }, { status: 404 })
      }
    }

    // ── Fetch transaction ─────────────────────────────────────────────────────
    let txnQuery = supabase
      .from('transactions')
      .select(
        'txn_id, warranty_start, warranty_expiry, facture_ref, ' +
        'device_id, prix_vente, date_vente, payment_method, voided'
      )
      .eq('voided', false)

    if (resolvedTxnId)  txnQuery = txnQuery.eq('txn_id', resolvedTxnId)
    else if (facture_ref) txnQuery = txnQuery.eq('facture_ref', facture_ref)

    const { data: txnRaw, error: txnError } = await txnQuery.maybeSingle()
    if (txnError) throw txnError

    const txn = txnRaw as any
    if (!txn) {
      return NextResponse.json({ error: 'Transaction introuvable' }, { status: 404 })
    }

    // ── Garantie effective via fonction SQL ───────────────────────────────────
    const { data: effectiveExpiry, error: expError } = await db
      .rpc('get_effective_warranty_expiry', { p_txn_id: txn.txn_id })
    if (expError) throw expError

    // ── Historique des événements SAV ─────────────────────────────────────────
    const { data: eventsRaw } = await db
      .from('warranty_events')
      .select('event_id, event_type, event_date, sav_ref, notes, created_at')
      .eq('txn_id', txn.txn_id)
      .order('event_date', { ascending: true })

    const events = (eventsRaw ?? []) as Array<{
      event_id: string
      event_type: string
      event_date: string
      sav_ref: string | null
      notes: string | null
      created_at: string
    }>

    // ── Calcul du statut ──────────────────────────────────────────────────────
    const today      = new Date()
    today.setHours(0, 0, 0, 0)
    const expiryDate = effectiveExpiry ? new Date(effectiveExpiry as string) : null
    const daysRemaining = expiryDate
      ? Math.ceil((expiryDate.getTime() - today.getTime()) / 86_400_000)
      : null

    const warranty_status: 'active' | 'expired' | 'no_warranty' =
      !expiryDate           ? 'no_warranty'
      : daysRemaining! > 0  ? 'active'
      :                       'expired'

    const openSav = events.reduce((acc, ev) =>
      acc + (ev.event_type === 'SAV_OPEN' ? 1 : ev.event_type === 'SAV_CLOSE' ? -1 : 0), 0
    ) > 0

    return NextResponse.json({
      status: 'success',
      data: {
        txn_id:                    txn.txn_id,
        facture_ref:               txn.facture_ref,
        device_id:                 txn.device_id,
        prix_vente:                txn.prix_vente,
        date_vente:                txn.date_vente,
        warranty_start:            txn.warranty_start,
        warranty_expiry_base:      txn.warranty_expiry,
        warranty_expiry_effective: effectiveExpiry,
        days_remaining:            daysRemaining,
        warranty_status,
        sav_currently_open:        openSav,
        sav_events:                events,
      },
    })
  } catch (err) {
    console.error('[GET /api/warranty]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}