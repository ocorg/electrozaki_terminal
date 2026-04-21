import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = createUntypedClient()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const statut   = searchParams.get('statut')
    const search   = searchParams.get('search')

    if (!store_id) return NextResponse.json({ error: 'store_id requis' }, { status: 400 })

    let query = supabase
      .from('reparations')
      .select('*, clients(nom, telephone), reparations_parts(*)')
      .eq('store_id', store_id)
      .order('created_at', { ascending: false })

    if (statut) query = query.eq('statut', statut)
    if (search) query = query.or(
      `model.ilike.%${search}%,marque.ilike.%${search}%,device_serial.ilike.%${search}%`
    )

    const { data, error } = await query
    if (error) throw error

    // Compute fariq_rep
    const enriched = (data || []).map((r: Record<string, unknown>) => {
      const parts = (r.reparations_parts as Record<string, unknown>[] || [])
      const parts_cost = parts.reduce((s, p) => s + ((p.cout as number) || 0), 0)
      const fariq_rep  = ((r.cout_reparation as number) || 0) - ((r.avance_rep as number) || 0)
      return { ...r, fariq_rep, parts_cost }
    })

    return NextResponse.json({ data: enriched })
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
      .from('reparations')
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
      module:      'reparations',
      record_id:   data.rep_id as string,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `${body.marque ?? ''} ${body.model} — ${body.probleme}`,
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
    const { rep_id, ...updates } = body
    if (!rep_id) return NextResponse.json({ error: 'rep_id requis' }, { status: 400 })

    const { data: before } = await supabase
      .from('reparations')
      .select('*')
      .eq('rep_id', rep_id)
      .single() as { data: Record<string, unknown> | null }

    const { data, error } = await supabase
      .from('reparations')
      .update({ ...updates, updated_by: user.id })
      .eq('rep_id', rep_id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      store_id:     data.store_id as string ?? null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'UPDATE',
      module:       'reparations',
      record_id:    rep_id,
      before_state: before ?? null,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
      notes:        updates.statut ? `Statut → ${updates.statut}` : undefined,
    })

    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}