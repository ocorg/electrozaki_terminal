import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { searchParams } = new URL(request.url)
    const store_id   = searchParams.get('store_id')
    const date_from  = searchParams.get('date_from')
    const date_to    = searchParams.get('date_to')
    const categorie  = searchParams.get('categorie')

    if (!store_id) return NextResponse.json({ error: 'store_id requis' }, { status: 400 })

    let query = supabase
      .from('expenses')
      .select('*')
      .eq('store_id', store_id)
      .eq('is_deleted', false)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })

    if (date_from) query = query.gte('date', date_from)
    if (date_to)   query = query.lte('date', date_to)
    if (categorie) query = query.eq('categorie', categorie)

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
    if (!body.montant || !body.categorie) {
      return NextResponse.json({ error: 'montant et categorie requis' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('expenses')
      .insert({
        ...body,
        store_id:   body.store_id ?? profile?.store_id ?? null,
        created_by: user.id,
        updated_by: user.id,
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
      module:      'expenses',
      record_id:   data.exp_id as string,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `${body.categorie} — ${body.montant} MAD`,
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
    const exp_id = searchParams.get('exp_id')
    if (!exp_id) return NextResponse.json({ error: 'exp_id requis' }, { status: 400 })

    const { data: before } = await supabase
      .from('expenses')
      .select('*')
      .eq('exp_id', exp_id)
      .single() as { data: Record<string, unknown> | null }

    const { error } = await supabase
      .from('expenses')
      .update({ is_deleted: true, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq('exp_id', exp_id)

    if (error) throw error

    await logActivity({
      store_id:     before?.store_id as string ?? null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'DELETE',
      module:       'expenses',
      record_id:    exp_id,
      before_state: before ?? null,
      ip_address:   getIpFromRequest(request),
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}