import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')

    let query = supabase
      .from('credit_imports')
      .select('*, clients(nom, telephone)')
      .order('date_origine', { ascending: false })

    if (store_id) query = query.eq('store_id', store_id)

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
    const { client_id, client_name_free, client_phone_free,
            store_id, montant_du, description, date_origine, notes } = body

    if (!montant_du || montant_du <= 0) return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })
    if (!date_origine) return NextResponse.json({ error: 'Date requise' }, { status: 400 })
    if (!client_id && !client_name_free) {
      return NextResponse.json({ error: 'Client requis' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('credit_imports')
      .insert({
        client_id:         client_id ?? null,
        client_name_free:  client_name_free ?? null,
        client_phone_free: client_phone_free ?? null,
        store_id:          store_id ?? profile?.store_id ?? null,
        montant_du,
        description:       description ?? null,
        date_origine,
        notes:             notes ?? null,
        created_by:        user.id,
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
      module:      'credit_imports',
      record_id:   data.import_id as string,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

// PATCH: retroactively link a free-text import to a real client
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

    const { import_id, client_id } = await request.json()
    if (!import_id || !client_id) {
      return NextResponse.json({ error: 'import_id et client_id requis' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('credit_imports')
      .update({ client_id })
      .eq('import_id', import_id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error

    await logActivity({
      store_id:    data?.store_id as string ?? null,
      user_id:     user.id,
      user_name:   profile?.display_name ?? '—',
      action_type: 'UPDATE',
      module:      'credit_imports',
      record_id:   import_id,
      after_state: data ?? undefined,
      ip_address:  getIpFromRequest(request),
      notes:       `Lié au client ${client_id}`,
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

    if (profile?.role !== 'owner') {
      return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const import_id = searchParams.get('import_id')
    if (!import_id) return NextResponse.json({ error: 'import_id requis' }, { status: 400 })

    const { error } = await supabase
      .from('credit_imports')
      .delete()
      .eq('import_id', import_id)

    if (error) throw error
    return NextResponse.json({ status: 'success' })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}