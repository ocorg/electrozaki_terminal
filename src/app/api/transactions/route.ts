import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const client_id = searchParams.get('client_id')
    const store_id  = searchParams.get('store_id')
    const limit     = searchParams.get('limit') || '50'

    let query = supabase
      .from('transactions')
      .select('*, clients(nom, telephone)')
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (client_id) query = query.eq('client_id', client_id)
    if (store_id)  query = query.eq('store_id', store_id)

    const { data, error } = await query
    if (error) throw error

    const enriched = (data || []).map((t: Record<string, unknown>) => {
      const fariq = (t.prix_vente as number)
        - ((t.avance as number) || 0)
        - ((t.valeur_echange as number) || 0)
      return {
        ...t,
        fariq,
        statut_paiement:
          fariq === 0 ? '✅ مسدد' :
          fariq > 0   ? '🔵 متبقي' :
                        '⚠️ زيادة دفع',
      }
    })

    return NextResponse.json({ data: enriched })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase        = createUntypedClient()
    const typedSupabase   = createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, store_id')
      .eq('id', user.id)
      .single() as { data: { display_name: string; store_id: string | null } | null }

    const body = await request.json()

    // Fetch device's actual warranty_months
    const deviceTable = body.device_type === 'هاتف' ? 'phones'
                      : body.device_type === 'لابتوب' ? 'laptops'
                      : null
    const deviceIdCol = body.device_type === 'هاتف' ? 'phone_id' : 'laptop_id'
    let warrantyMonths = 6

    if (deviceTable) {
      const { data: device } = await supabase
        .from(deviceTable)
        .select('warranty_months')
        .eq(deviceIdCol, body.device_id)
        .single() as { data: { warranty_months: number } | null }
      if (device?.warranty_months) warrantyMonths = device.warranty_months
    }

    const warrantyStart  = body.warranty_start || new Date().toISOString().split('T')[0]
    const warrantyExpiry = new Date(warrantyStart)
    warrantyExpiry.setDate(warrantyExpiry.getDate() + warrantyMonths * 30)

    const { data, error } = await supabase
      .from('transactions')
      .insert({
        ...body,
        store_id:        body.store_id ?? profile?.store_id ?? null,
        warranty_start:  warrantyStart,
        warranty_expiry: warrantyExpiry.toISOString().split('T')[0],
        created_by:      user.id,
        updated_by:      user.id,
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    // Flip device status to مباع
    if (deviceTable) {
      await supabase
        .from(deviceTable)
        .update({ status: 'مباع', updated_by: user.id })
        .eq(deviceIdCol, body.device_id)
    }

    await logActivity({
      store_id:    data.store_id as string ?? null,
      user_id:     user.id,
      user_name:   profile?.display_name ?? user.email ?? '—',
      action_type: 'INSERT',
      module:      'transactions',
      record_id:   data.txn_id as string ?? null,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `${body.type_operation} — ${body.device_type} ${body.device_id}`,
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, role')
      .eq('id', user.id)
      .single() as { data: { display_name: string; role: string } | null }

    if (!['manager', 'owner'].includes(profile?.role ?? '')) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await request.json()
    const { txn_id, voided_reason } = body as { txn_id: string; voided_reason: string }
    if (!txn_id) return NextResponse.json({ error: 'txn_id requis' }, { status: 400 })
    if (!voided_reason || voided_reason.trim().length < 10) {
      return NextResponse.json({ error: 'Motif d\'annulation requis (10 caractères minimum)' }, { status: 400 })
    }

    const { data: before } = await supabase
      .from('transactions')
      .select('*')
      .eq('txn_id', txn_id)
      .single() as { data: Record<string, unknown> | null }

    if (!before) return NextResponse.json({ error: 'Transaction introuvable' }, { status: 404 })
    if (before.voided) return NextResponse.json({ error: 'Transaction déjà annulée' }, { status: 400 })

    const { data: voided, error } = await supabase
      .from('transactions')
      .update({
        voided:        true,
        voided_by:     user.id,
        voided_at:     new Date().toISOString(),
        voided_reason: voided_reason.trim(),
        updated_by:    user.id,
      })
      .eq('txn_id', txn_id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error

    await logActivity({
      store_id:     before.store_id as string ?? null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'VOID',
      module:       'transactions',
      record_id:    txn_id,
      before_state: before,
      after_state:  voided ?? null,
      ip_address:   getIpFromRequest(request),
      notes:        voided_reason.trim(),
    })

    return NextResponse.json({ status: 'success' })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}