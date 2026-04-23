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
    const status   = searchParams.get('status')
    const search   = searchParams.get('search')
    const location = searchParams.get('location')
    const store_id = searchParams.get('store_id')

    let query = supabase
      .from('laptops')
      .select('*')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })

    if (store_id) query = query.eq('store_id', store_id)
    if (status)   query = query.eq('status', status)
    if (location) query = query.eq('location', location)
    if (search)   query = query.or(
      `serial.ilike.%${search}%,model.ilike.%${search}%,marque.ilike.%${search}%`
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

    const { data, error } = await supabase
      .from('laptops')
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
      module:      'laptops',
      record_id:   data.laptop_id as string,
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
    const { laptop_id, ...updates } = body
    if (!laptop_id) return NextResponse.json({ error: 'laptop_id requis' }, { status: 400 })

    const { data: before } = await supabase
      .from('laptops')
      .select('*')
      .eq('laptop_id', laptop_id)
      .single() as { data: Record<string, unknown> | null }

    const { data, error } = await supabase
      .from('laptops')
      .update({ ...updates, updated_by: user.id })
      .eq('laptop_id', laptop_id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      store_id:     data.store_id as string ?? null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'UPDATE',
      module:       'laptops',
      record_id:    laptop_id,
      before_state: before ?? null,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return NextResponse.json({ data })
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

    const { searchParams } = new URL(request.url)
    const laptop_id = searchParams.get('laptop_id')
    if (!laptop_id) return NextResponse.json({ error: 'laptop_id requis' }, { status: 400 })

    const { data: before } = await supabase
      .from('laptops')
      .select('*')
      .eq('laptop_id', laptop_id)
      .single() as { data: Record<string, unknown> | null }

    if (!before) return NextResponse.json({ error: 'Laptop introuvable' }, { status: 404 })

    const { error } = await supabase
      .from('laptops')
      .update({ is_deleted: true, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq('laptop_id', laptop_id)

    if (error) throw error

    await logActivity({
      store_id:     before.store_id as string ?? null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'DELETE',
      module:       'laptops',
      record_id:    laptop_id,
      before_state: before,
      after_state:  null,
      ip_address:   getIpFromRequest(request),
    })

    return NextResponse.json({ status: 'success' })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}