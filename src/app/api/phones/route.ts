import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = createUntypedClient()
    const { searchParams } = new URL(request.url)
    const status   = searchParams.get('status')
    const marque   = searchParams.get('marque')
    const location = searchParams.get('location')
    const search   = searchParams.get('search')
    const store_id = searchParams.get('store_id')

    let query = supabase
      .from('phones')
      .select('*')
      .order('created_at', { ascending: false })

    if (store_id) query = query.eq('store_id', store_id)
    if (status)   query = query.eq('status', status)
    if (marque)   query = query.ilike('marque', `%${marque}%`)
    if (location) query = query.eq('location', location)
    if (search)   query = query.or(
      `imei.ilike.%${search}%,model.ilike.%${search}%,marque.ilike.%${search}%`
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

    const { data, error } = await supabase
      .from('phones')
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
      user_name:   profile?.display_name ?? user.email ?? '—',
      action_type: 'INSERT',
      module:      'phones',
      record_id:   data.phone_id as string ?? null,
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
    const { phone_id, ...updates } = body
    if (!phone_id) return NextResponse.json({ error: 'phone_id requis' }, { status: 400 })

    const { data: before } = await supabase
      .from('phones')
      .select('*')
      .eq('phone_id', phone_id)
      .single() as { data: Record<string, unknown> | null }

    const { data, error } = await supabase
      .from('phones')
      .update({ ...updates, updated_by: user.id })
      .eq('phone_id', phone_id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      store_id:     data.store_id as string ?? null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? user.email ?? '—',
      action_type:  'UPDATE',
      module:       'phones',
      record_id:    phone_id,
      before_state: before ?? null,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}