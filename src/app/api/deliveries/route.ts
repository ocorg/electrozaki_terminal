import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

// ── Helpers ───────────────────────────────────────────────────
type UClient = ReturnType<typeof createUntypedClient>

async function setDeviceStatus(
  sb:         UClient,
  deviceType: string,
  deviceId:   string,
  status:     string,
  userId:     string,
) {
  const table = deviceType === 'هاتف' ? 'phones'    : 'laptops'
  const idCol = deviceType === 'هاتف' ? 'phone_id'  : 'laptop_id'
  await sb
    .from(table)
    .update({
      status,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq(idCol, deviceId)
}

// ── GET — list deliveries ─────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()

    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const statut   = searchParams.get('statut')

    let query = supabase
      .from('deliveries')
      .select('*, delivery_items(*)')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })

    if (store_id) query = query.eq('store_id', store_id)
    if (statut)   query = query.eq('statut', statut)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ data: data || [] })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

// ── POST — create delivery ────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()

    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, store_id, role')
      .eq('id', user.id)
      .single() as {
        data: { display_name: string; store_id: string | null; role: string } | null
      }

    if (!['manager', 'owner'].includes(profile?.role ?? '')) {
      return NextResponse.json(
        { error: 'Manager ou propriétaire requis' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { items, ...deliveryData } = body
    const store_id = deliveryData.store_id ?? profile?.store_id

    if (
      !deliveryData.client_name  ||
      !deliveryData.client_phone ||
      !deliveryData.client_address
    ) {
      return NextResponse.json(
        { error: 'Informations client incomplètes' },
        { status: 400 }
      )
    }

    // Insert delivery
    const { data: delivery, error: delErr } = await supabase
      .from('deliveries')
      .insert({
        ...deliveryData,
        store_id,
        is_deleted: false,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (delErr) throw delErr
    if (!delivery) throw new Error('Aucune donnée retournée')

    const deliveryId = delivery.delivery_id as string

    // Insert delivery items
    if (Array.isArray(items) && items.length > 0) {
      const { error: itemErr } = await supabase
        .from('delivery_items')
        .insert(
          items.map((i: { device_type: string; device_id: string; txn_id?: string }) => ({
            delivery_id: deliveryId,
            device_type: i.device_type,
            device_id:   i.device_id,
            txn_id:      i.txn_id ?? null,
          }))
        )
      if (itemErr) throw itemErr

      // Set device status to en_livraison if moving past confirmation
      if (
        deliveryData.statut &&
        deliveryData.statut !== 'confirmation_encours'
      ) {
        for (const i of items) {
          await setDeviceStatus(
            supabase, i.device_type, i.device_id, 'en_livraison', user.id
          )
        }
      }
    }

    // Mark caisse_entry_created for advance scenarios
    if (['full_advance', 'partial_advance'].includes(deliveryData.payment_scenario)) {
      await supabase
        .from('deliveries')
        .update({ caisse_entry_created: true })
        .eq('delivery_id', deliveryId)
    }

    await logActivity({
      store_id,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'INSERT',
      module:       'transactions',
      record_id:    deliveryId,
      before_state: null,
      after_state:  delivery,
      ip_address:   getIpFromRequest(request),
      notes:        `Livraison créée — scénario: ${deliveryData.payment_scenario}`,
    })

    return NextResponse.json({ data: delivery }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

// ── PATCH — update delivery status ───────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()

    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, role')
      .eq('id', user.id)
      .single() as { data: { display_name: string; role: string } | null }

    const body = await request.json()
    const { delivery_id, statut, notes } = body

    if (!delivery_id || !statut) {
      return NextResponse.json(
        { error: 'delivery_id et statut requis' },
        { status: 400 }
      )
    }

    // Fetch current delivery with items
    const { data: before } = await supabase
      .from('deliveries')
      .select('*, delivery_items(*)')
      .eq('delivery_id', delivery_id)
      .single() as {
        data: (Record<string, unknown> & {
          delivery_items: { device_type: string; device_id: string; txn_id?: string }[]
        }) | null
      }

    if (!before) {
      return NextResponse.json({ error: 'Livraison introuvable' }, { status: 404 })
    }

    // Block mutations on terminal statuses
    const TERMINAL = ['livre', 'annule', 'retour']
    if (TERMINAL.includes(before.statut as string)) {
      return NextResponse.json(
        { error: 'Statut terminal — impossible de modifier' },
        { status: 400 }
      )
    }

    const items = before.delivery_items

    // Moving out of confirmation_encours → set devices to en_livraison
    if (
      statut !== 'confirmation_encours' &&
      before.statut === 'confirmation_encours'
    ) {
      for (const i of items) {
        await setDeviceStatus(supabase, i.device_type, i.device_id, 'en_livraison', user.id)
      }
    }

    // Delivered → devices become مباع
    if (statut === 'livre') {
      for (const i of items) {
        await setDeviceStatus(supabase, i.device_type, i.device_id, 'مباع', user.id)
      }
      await supabase
        .from('deliveries')
        .update({ caisse_entry_created: true })
        .eq('delivery_id', delivery_id)
    }

    // Annulé or Retour → revert devices to متوفر + void linked transactions
    if (['annule', 'retour'].includes(statut)) {
      for (const i of items) {
        await setDeviceStatus(supabase, i.device_type, i.device_id, 'متوفر', user.id)
        if (i.txn_id) {
          await supabase
            .from('transactions')
            .update({
              voided:        true,
              voided_by:     user.id,
              voided_at:     new Date().toISOString(),
              voided_reason: `Livraison ${statut} — ${delivery_id}`,
            })
            .eq('txn_id', i.txn_id)
        }
      }
    }

    // Update delivery status
    const { data: updated, error } = await supabase
      .from('deliveries')
      .update({
        statut,
        notes:      notes ?? before.notes,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq('delivery_id', delivery_id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error

    await logActivity({
      store_id:     before.store_id as string,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'UPDATE',
      module:       'transactions',
      record_id:    delivery_id,
      before_state: before,
      after_state:  updated,
      ip_address:   getIpFromRequest(request),
      notes:        `Statut livraison: ${before.statut as string} → ${statut}`,
    })

    return NextResponse.json({ data: updated })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}