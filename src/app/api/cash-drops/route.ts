import { NextRequest, NextResponse } from 'next/server'
import { createUntypedClient } from '@/lib/supabase/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const body = await request.json() as { amount: number; reason: string; store_id: string }
    if (!body.amount || body.amount <= 0) return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })
    if (!body.reason?.trim()) return NextResponse.json({ error: 'Motif requis' }, { status: 400 })

    const { data, error } = await supabase
      .from('cash_drops')
      .insert({
        store_id:   body.store_id,
        amount:     body.amount,
        reason:     body.reason.trim(),
        date:       new Date().toISOString().split('T')[0],
        created_by: user.id,
      })
      .select()
      .single()

    if (error) throw error

    await logActivity({
      user_id:     user.id,
      user_name:   user.email ?? '',
      action_type: 'INSERT',
      module:      'cash_drops',
      record_id:   data.drop_id,
      store_id:    body.store_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const store_id = new URL(request.url).searchParams.get('store_id')
    const date     = new URL(request.url).searchParams.get('date')

    let query = supabase.from('cash_drops').select('*').order('created_at', { ascending: false })
    if (store_id) query = query.eq('store_id', store_id)
    if (date)     query = query.eq('date', date)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ data: data || [] })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}