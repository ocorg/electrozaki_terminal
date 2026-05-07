import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

// ── GET — list all stores ─────────────────────────────────────
export async function GET() {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()

    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single() as { data: { role: string } | null }

    if (!['manager', 'owner'].includes(profile?.role ?? '')) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('stores')
      .select('store_id, name, theme_color, address, phone, is_active, created_at')
      .order('created_at')

    if (error) throw error

    return NextResponse.json({ data: data || [] })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

// ── PATCH — toggle is_active ──────────────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()

    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, role')
      .eq('id', user.id)
      .single() as { data: { display_name: string; role: string } | null }

    if (profile?.role !== 'owner') {
      return NextResponse.json(
        { error: 'Seul le propriétaire peut modifier le statut des boutiques' },
        { status: 403 }
      )
    }

    const { store_id, is_active } = await request.json()

    if (!store_id || is_active === undefined) {
      return NextResponse.json(
        { error: 'store_id et is_active requis' },
        { status: 400 }
      )
    }

    // Fetch before state for activity log
    const { data: before } = await supabase
      .from('stores')
      .select('*')
      .eq('store_id', store_id)
      .single() as { data: Record<string, unknown> | null }

    const { data, error } = await supabase
      .from('stores')
      .update({ is_active, updated_at: new Date().toISOString() })
      .eq('store_id', store_id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error

    await logActivity({
      store_id,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'UPDATE',
      module:       'settings',
      record_id:    store_id,
      before_state: before ?? null,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
      notes:        `Store ${store_id} is_active → ${is_active}`,
    })

    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}