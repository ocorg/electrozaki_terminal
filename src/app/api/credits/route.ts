import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase   = await createUntypedClient()
    const { searchParams } = new URL(request.url)
    const store_id   = searchParams.get('store_id')
    const client_id  = searchParams.get('client_id')

    let query = supabase
      .from('credit_payments')
      .select('*, clients(nom, telephone)')
      .order('created_at', { ascending: false })
      .limit(200)

    if (store_id)  query = query.eq('store_id', store_id)
    if (client_id) query = query.eq('client_id', client_id)

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
      .select('display_name, store_id')
      .eq('id', user.id)
      .single() as { data: { display_name: string; store_id: string | null } | null }

    const body = await request.json()
    const { client_id, montant, payment_method, store_id, txn_id, payment_ref, notes } = body

    if (!client_id) return NextResponse.json({ error: 'client_id requis' }, { status: 400 })
    if (!montant || montant <= 0) return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })
    if (!payment_method) return NextResponse.json({ error: 'Méthode de paiement requise' }, { status: 400 })

    const { data, error } = await supabase
      .from('credit_payments')
      .insert({
        client_id,
        store_id:       store_id ?? profile?.store_id ?? null,
        txn_id:         txn_id ?? null,
        montant,
        payment_method,
        payment_ref:    payment_ref ?? null,
        notes:          notes ?? null,
        collected_by:   user.id,
        created_by:     user.id,
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      store_id:    data.store_id as string ?? null,
      user_id:     user.id,
      user_name:   profile?.display_name ?? '—',
      action_type: 'INSERT',
      module:      'credits',
      record_id:   data.payment_id as string,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `Paiement crédit ${montant} MAD — client ${client_id}`,
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase      = await createUntypedClient()
    const typedSupabase = await createClient()
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

    const { searchParams } = new URL(request.url)
    const payment_id = searchParams.get('payment_id')
    if (!payment_id) return NextResponse.json({ error: 'payment_id requis' }, { status: 400 })

    const { data: before } = await supabase
      .from('credit_payments')
      .select('*')
      .eq('payment_id', payment_id)
      .single() as { data: Record<string, unknown> | null }

    if (!before) return NextResponse.json({ error: 'Paiement introuvable' }, { status: 404 })

    const { error } = await supabase
      .from('credit_payments')
      .delete()
      .eq('payment_id', payment_id)

    if (error) throw error

    await logActivity({
      store_id:     before.store_id as string ?? null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'DELETE',
      module:       'credits',
      record_id:    payment_id,
      before_state: before,
      after_state:  null,
      ip_address:   getIpFromRequest(request),
    })

    return NextResponse.json({ status: 'success' })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}