import { NextResponse } from 'next/server'
import { createClient, createUntypedClient } from '@/lib/supabase/server'

// ── POST /api/warranty/events ─────────────────────────────────────────────────
// Enregistre un événement SAV_OPEN ou SAV_CLOSE sur une vente.
// SAV_OPEN  → phones.status = إصلاح  (téléphone en atelier sous garantie)
// SAV_CLOSE → phones.status = مباع   (téléphone restitué au client)

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profileRaw } = await supabase
      .from('user_profiles')
      .select('store_id')
      .eq('id', user.id)
      .single()

    const profile = profileRaw as { store_id: string | null } | null
    const store_id = profile?.store_id ?? 'EZ-001'
    const db = await createUntypedClient()

    const body = await request.json()
    const { txn_id, facture_ref, event_type, sav_doc_id, sav_ref, notes } = body

    if (!txn_id || !facture_ref || !event_type) {
      return NextResponse.json(
        { error: 'txn_id, facture_ref et event_type sont obligatoires' },
        { status: 400 }
      )
    }

    if (!['SAV_OPEN', 'SAV_CLOSE'].includes(event_type)) {
      return NextResponse.json(
        { error: 'event_type doit être SAV_OPEN ou SAV_CLOSE' },
        { status: 400 }
      )
    }

    // ── Validation SAV_CLOSE : vérifier qu'il y a bien un SAV ouvert ─────────
    if (event_type === 'SAV_CLOSE') {
      const { data: existingRaw } = await db
        .from('warranty_events')
        .select('event_type')
        .eq('txn_id', txn_id)

      const existing = (existingRaw ?? []) as Array<{ event_type: string }>
      const openCount = existing.reduce(
        (acc, ev) => acc + (ev.event_type === 'SAV_OPEN' ? 1 : -1), 0
      )

      if (openCount <= 0) {
        return NextResponse.json(
          { error: 'Aucun SAV ouvert à clôturer pour cette transaction' },
          { status: 400 }
        )
      }
    }

    // ── Mise à jour du statut du téléphone ────────────────────────────────────
    const { data: txnRaw } = await supabase
      .from('transactions')
      .select('device_id')
      .eq('txn_id', txn_id)
      .maybeSingle()

    const txn = txnRaw as { device_id: string } | null
    if (txn?.device_id) {
      const newStatus = event_type === 'SAV_OPEN' ? 'إصلاح' : 'مباع'
      await db
        .from('phones')
        .update({
          status:     newStatus,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('phone_id', txn.device_id)
    }

    // ── Insertion de l'événement ──────────────────────────────────────────────
    const { data, error } = await db
      .from('warranty_events')
      .insert({
        store_id,
        txn_id,
        facture_ref,
        event_type,
        event_date: new Date().toISOString().split('T')[0],
        sav_doc_id: sav_doc_id || null,
        sav_ref:    sav_ref    || null,
        notes:      notes      || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ status: 'success', data })
  } catch (err) {
    console.error('[POST /api/warranty/events]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}