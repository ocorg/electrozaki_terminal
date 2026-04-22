import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = createUntypedClient()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const date     = searchParams.get('date') || new Date().toISOString().split('T')[0]
    const all      = searchParams.get('all') // for BZG view

    let query = supabase
      .from('staff_attendance')
      .select('*')
      .eq('date', date)
      .order('punched_at', { ascending: false })

    if (store_id && !all) query = query.eq('store_id', store_id)

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
    const store_id   = body.store_id ?? profile?.store_id
    const punch_type = body.punch_type as 'in' | 'out'
    const today      = new Date().toISOString().split('T')[0]

    if (!store_id) {
      return NextResponse.json({ error: 'store_id manquant' }, { status: 400 })
    }
    if (!['in', 'out'].includes(punch_type)) {
      return NextResponse.json({ error: 'punch_type invalide' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('staff_attendance')
      .insert({
        store_id,
        user_id:    user.id,
        user_name:  profile?.display_name ?? '—',
        punch_type,
        punched_at: new Date().toISOString(),
        date:       today,
        notes:      body.notes || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      store_id,
      user_id:     user.id,
      user_name:   profile?.display_name ?? '—',
      action_type: punch_type === 'in' ? 'PUNCH_IN' : 'PUNCH_OUT',
      module:      'attendance',
      record_id:   data.attendance_id as string,
      ip_address:  getIpFromRequest(request),
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}