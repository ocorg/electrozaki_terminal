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
    const status   = searchParams.get('status')
    const marque   = searchParams.get('marque')
    const location = searchParams.get('location')
    const stockage = searchParams.get('stockage')
    const promo    = searchParams.get('promo')
    const search   = searchParams.get('search')
    const store_id = searchParams.get('store_id')

    const { data: callerProfile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single() as { data: { role: string } | null }

    const isPrivileged = ['manager', 'owner'].includes(callerProfile?.role ?? '')
    const columns = isPrivileged
      ? '*'
      : 'phone_id,imei,source,fournisseur_id,txn_ref_id,condition,marque,serie,type,couleur,model,stockage,battery_level,ram,description,icloud_compte,prix_vente_recommande,prix_vente_minimum,warranty_months,status,location,date_entree,image_url,created_at,updated_at,store_id,replaced_components,is_damaged,damage_notes,promo_type,promo_montant'

    let query = supabase
      .from('phones')
      .select(columns)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })

    if (store_id) query = query.eq('store_id', store_id)
    if (status)   query = query.eq('status', status)
    if (marque)   query = query.ilike('marque', `%${marque}%`)
    if (location) query = query.eq('location', location)
    if (stockage)     query = query.eq('stockage', stockage)
    if (promo === '1') query = query.not('promo_type', 'is', null)
    if (search) {
      const looksLikeImei = /^\d{6,}$/.test(search)
      if (looksLikeImei) {
        query = query.ilike('imei', `%${search}%`)
      } else {
        query = query.or(`model.ilike.%${search},marque.ilike.%${search}%`)
      }
    }

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase        = await createUntypedClient()
    const typedSupabase   = await createClient()
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
    const supabase        = await createUntypedClient()
    const typedSupabase   = await createClient()
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

export async function DELETE(request: NextRequest) {
  try {
    const supabase      = await createUntypedClient()
    const typedSupabase = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, role, store_id')
      .eq('id', user.id)
      .single() as { data: { display_name: string; role: string; store_id: string | null } | null }

    if (!['manager', 'owner'].includes(profile?.role ?? '')) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const phone_id = searchParams.get('phone_id')
    if (!phone_id) return NextResponse.json({ error: 'phone_id requis' }, { status: 400 })

    const { data: before } = await supabase
      .from('phones')
      .select('*')
      .eq('phone_id', phone_id)
      .single() as { data: Record<string, unknown> | null }

    if (!before) return NextResponse.json({ error: 'Téléphone introuvable' }, { status: 404 })

    const { error } = await supabase
      .from('phones')
      .update({ is_deleted: true, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq('phone_id', phone_id)

    if (error) throw error

    await logActivity({
      store_id:     before.store_id as string ?? null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'DELETE',
      module:       'phones',
      record_id:    phone_id,
      before_state: before,
      after_state:  null,
      ip_address:   getIpFromRequest(request),
    })

    return NextResponse.json({ status: 'success' })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}