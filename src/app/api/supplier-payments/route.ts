import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = createUntypedClient()
    const { searchParams } = new URL(request.url)
    const supplier_id = searchParams.get('supplier_id')
    const store_id    = searchParams.get('store_id')

    let query = supabase
      .from('supplier_payments')
      .select('*')
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
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()
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

    const { data, error } = await supabase
      .from('supplier_payments')
      .insert({
        supplier_id:    body.supplier_id,
        store_id:       body.store_id ?? profile?.store_id ?? null,
        montant:        body.montant,
        payment_method: body.payment_method ?? 'نقد',
        payment_ref:    body.payment_ref    ?? null,
        facture_ref:    body.facture_ref    ?? null,
        date_paiement:  body.date_paiement  ?? new Date().toISOString().split('T')[0],
        notes:          body.notes          ?? null,
        created_by:     user.id,
        updated_by:     user.id,
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
      module:      'supplier_payments',
      record_id:   data.payment_id as string,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `${body.montant} MAD → ${body.supplier_id}`,
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}