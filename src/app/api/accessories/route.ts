import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase      = await createUntypedClient()
    const typedSupabase = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const store_id  = searchParams.get('store_id')
    const search    = searchParams.get('search')
    const categorie = searchParams.get('categorie')
    const low_stock = searchParams.get('low_stock')

    if (!store_id) return NextResponse.json({ error: 'store_id requis' }, { status: 400 })

    let query = supabase
      .from('accessories_with_status')
      .select('*')
      .eq('store_id', store_id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })

    if (categorie)  query = query.eq('categorie', categorie)
    if (low_stock === 'true') query = query.eq('is_low_stock', true)
    if (search)     query = query.or(
      `nom.ilike.%${search}%,marque.ilike.%${search}%,barcode.ilike.%${search}%`
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
    if (!body.nom || !body.categorie) {
      return NextResponse.json({ error: 'nom et categorie requis' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('accessories')
      .insert({
        ...body,
        store_id:   body.store_id ?? profile?.store_id ?? null,
        is_deleted: false,
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
      module:      'accessories',
      record_id:   data.acc_id as string,
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
    const supabase      = await createUntypedClient()
    const typedSupabase = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name')
      .eq('id', user.id)
      .single() as { data: { display_name: string } | null }

    const body = await request.json()
    const { acc_id, ...updates } = body
    if (!acc_id) return NextResponse.json({ error: 'acc_id requis' }, { status: 400 })

    const { data: before } = await supabase
      .from('accessories')
      .select('*')
      .eq('acc_id', acc_id)
      .single() as { data: Record<string, unknown> | null }

    const { data, error } = await supabase
      .from('accessories')
      .update({ ...updates, updated_by: user.id })
      .eq('acc_id', acc_id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      store_id:     data.store_id as string ?? null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'UPDATE',
      module:       'accessories',
      record_id:    acc_id,
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
    const acc_id = searchParams.get('acc_id')
    if (!acc_id) return NextResponse.json({ error: 'acc_id requis' }, { status: 400 })

    const { data: before } = await supabase
      .from('accessories')
      .select('*')
      .eq('acc_id', acc_id)
      .single() as { data: Record<string, unknown> | null }

    if (!before) return NextResponse.json({ error: 'Accessoire introuvable' }, { status: 404 })

    const { error } = await supabase
      .from('accessories')
      .update({ is_deleted: true, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq('acc_id', acc_id)

    if (error) throw error

    await logActivity({
      store_id:     before.store_id as string ?? null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'DELETE',
      module:       'accessories',
      record_id:    acc_id,
      before_state: before,
      after_state:  null,
      ip_address:   getIpFromRequest(request),
    })

    return NextResponse.json({ status: 'success' })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}