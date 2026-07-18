import { NextRequest, NextResponse } from 'next/server'
import { createUntypedClient, createClient } from '@/lib/supabase/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

type UserProfile = { display_name: string } | null

async function getProfile(supabase: Awaited<ReturnType<typeof createUntypedClient>>, userId: string): Promise<UserProfile> {
  const { data } = await supabase
    .from('user_profiles')
    .select('display_name')
    .eq('user_id', userId)
    .maybeSingle()
  return data as UserProfile
}

export async function GET(request: NextRequest) {
  const supabase      = await createUntypedClient()
  const typedSupabase = await createClient()
  const { data: { user } } = await typedSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const store_id    = searchParams.get('store_id')
  const statut      = searchParams.get('statut')
  const source      = searchParams.get('source')
  const demand_type = searchParams.get('demand_type')
  const search      = searchParams.get('search')
  const open        = searchParams.get('open')

  let query = supabase
    .from('prospects')
    .select('*')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  if (store_id)     query = query.eq('store_id', store_id)
  if (open === '1') query = query.in('statut', ['Nouveau', 'Contacté'])
  else if (statut)  query = query.eq('statut', statut)
  if (source)       query = query.eq('source', source)
  if (demand_type)  query = query.eq('demand_type', demand_type)
  if (search)       query = query.or(
    `nom.ilike.%${search}%,telephone.ilike.%${search}%,model.ilike.%${search}%,marque.ilike.%${search}%`
  )

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase      = await createUntypedClient()
  const typedSupabase = await createClient()
  const { data: { user } } = await typedSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body    = await request.json()
  const profile = await getProfile(supabase, user.id)
  const byName  = profile?.display_name ?? user.id

  const { data, error } = await supabase
    .from('prospects')
    .insert({ ...body, created_by: byName, updated_by: byName })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logActivity({
    store_id:    data.store_id,
    user_id:     user.id,
    user_name:   byName,
    action_type: 'INSERT',
    module:      'prospects',
    record_id:   data.prospect_id,
    after_state: data,
    ip_address:  getIpFromRequest(request),
  })

  return NextResponse.json({ data }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const supabase      = await createUntypedClient()
  const typedSupabase = await createClient()
  const { data: { user } } = await typedSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { prospect_id, ...updates } = await request.json()
  if (!prospect_id) return NextResponse.json({ error: 'prospect_id requis' }, { status: 400 })

  const profile = await getProfile(supabase, user.id)
  const byName  = profile?.display_name ?? user.id

  const { data: before } = await supabase
    .from('prospects')
    .select('*')
    .eq('prospect_id', prospect_id)
    .single()

  const { data, error } = await supabase
    .from('prospects')
    .update({ ...updates, updated_by: byName, updated_at: new Date().toISOString() })
    .eq('prospect_id', prospect_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logActivity({
    store_id:     data.store_id,
    user_id:      user.id,
    user_name:    byName,
    action_type:  'UPDATE',
    module:       'prospects',
    record_id:    data.prospect_id,
    before_state: before,
    after_state:  data,
    ip_address:   getIpFromRequest(request),
  })

  return NextResponse.json({ data })
}

export async function DELETE(request: NextRequest) {
  const supabase      = await createUntypedClient()
  const typedSupabase = await createClient()
  const { data: { user } } = await typedSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const prospect_id = searchParams.get('prospect_id')
  if (!prospect_id) return NextResponse.json({ error: 'prospect_id requis' }, { status: 400 })

  const profile = await getProfile(supabase, user.id)
  const byName  = profile?.display_name ?? user.id

  const { data, error } = await supabase
    .from('prospects')
    .update({ is_deleted: true, updated_by: byName })
    .eq('prospect_id', prospect_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logActivity({
    store_id:     data.store_id,
    user_id:      user.id,
    user_name:    byName,
    action_type:  'DELETE',
    module:       'prospects',
    record_id:    data.prospect_id,
    before_state: data,
    ip_address:   getIpFromRequest(request),
  })

  return NextResponse.json({ data })
}