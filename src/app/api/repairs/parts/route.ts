import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

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
    const { rep_id, nom_piece, fournisseur, cout } = body as {
      rep_id: string; nom_piece: string; fournisseur?: string; cout: number
    }

    if (!rep_id || !nom_piece || cout == null) {
      return NextResponse.json({ error: 'rep_id, nom_piece et cout sont requis' }, { status: 400 })
    }

    if (nom_piece.length > 200) return NextResponse.json({ error: 'nom_piece trop long' }, { status: 400 })
    const coutNum = Number(cout)
    if (isNaN(coutNum) || coutNum < 0) {
      return NextResponse.json({ error: 'cout doit être un nombre positif' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('reparations_parts')
      .insert({
        rep_id,
        nom_piece: nom_piece.trim(),
        fournisseur: fournisseur?.trim() ?? null,
        cout: coutNum,
        created_by: user.id,
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      store_id:    profile?.store_id ?? null,
      user_id:     user.id,
      user_name:   profile?.display_name ?? '—',
      action_type: 'INSERT',
      module:      'repairs/parts',
      record_id:   data.part_id as string,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `Pièce ajoutée: ${nom_piece} — ${coutNum} MAD`,
    })

    return NextResponse.json({ status: 'success', data }, { status: 201 })
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
    const part_id = searchParams.get('part_id')
    if (!part_id) return NextResponse.json({ error: 'part_id requis' }, { status: 400 })

    const { data: before } = await supabase
      .from('reparations_parts')
      .select('*')
      .eq('part_id', part_id)
      .single() as { data: Record<string, unknown> | null }

    if (!before) return NextResponse.json({ error: 'Pièce introuvable' }, { status: 404 })

    const { error } = await supabase
      .from('reparations_parts')
      .delete()
      .eq('part_id', part_id)

    if (error) throw error

    await logActivity({
      store_id:     null,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'DELETE',
      module:       'repairs/parts',
      record_id:    part_id,
      before_state: before,
      after_state:  null,
      ip_address:   getIpFromRequest(request),
    })

    return NextResponse.json({ status: 'success' })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}