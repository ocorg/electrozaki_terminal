import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET() {
  try {
    const supabase      = createUntypedClient()
    const typedSupabase = createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: self } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single() as { data: { role: string } | null }

    if (!['manager', 'owner'].includes(self?.role ?? '')) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ data })
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

    const { data: self } = await supabase
      .from('user_profiles')
      .select('role, display_name')
      .eq('id', user.id)
      .single() as { data: { role: string; display_name: string } | null }

    if (!['manager', 'owner'].includes(self?.role ?? '')) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await request.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

    // Prevent non-owner from editing owner accounts
    if (self?.role === 'manager') {
      const { data: target } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', id)
        .single() as { data: { role: string } | null }
      if (target?.role === 'owner') {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
      }
    }

    const { data: before } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', id)
      .single() as { data: Record<string, unknown> | null }

    const { data, error } = await supabase
      .from('user_profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      user_id:      user.id,
      user_name:    self?.display_name ?? '—',
      action_type:  'UPDATE',
      module:       'users',
      record_id:    id,
      before_state: before ?? null,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}