import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = createUntypedClient()
    const { searchParams } = new URL(request.url)
    const search   = searchParams.get('search')
    const store_id = searchParams.get('store_id')

    let query = supabase
      .from('client_summary')
      .select('*')
      .order('created_at', { ascending: false })

    if (store_id) query = query.eq('store_id', store_id)
    if (search)   query = query.or(
      `nom.ilike.%${search}%,telephone.ilike.%${search}%,telephone_2.ilike.%${search}%`
    )

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
      .select('display_name, store_id')
      .eq('id', user.id)
      .single() as { data: { display_name: string; store_id: string | null } | null }

    const body = await request.json()

    // Return existing client if phone already exists
    if (body.telephone) {
      const { data: existing } = await supabase
        .from('clients')
        .select('*')
        .eq('telephone', body.telephone)
        .single() as { data: Record<string, unknown> | null }

      if (existing) return NextResponse.json({ data: existing, existing: true })
    }

    const { data, error } = await supabase
      .from('clients')
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
      module:      'clients',
      record_id:   data.client_id as string,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name')
      .eq('id', user.id)
      .single() as { data: { display_name: string } | null }

    const body = await request.json()
    const { client_id, ...updates } = body
    if (!client_id) return NextResponse.json({ error: 'client_id requis' }, { status: 400 })

    const { data: before } = await supabase
      .from('clients')
      .select('*')
      .eq('client_id', client_id)
      .single() as { data: Record<string, unknown> | null }

    const { data, error } = await supabase
      .from('clients')
      .update({ ...updates, updated_by: user.id })
      .eq('client_id', client_id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      store_id:     data.store_id as string ?? null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'UPDATE',
      module:       'clients',
      record_id:    client_id,
      before_state: before ?? null,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}