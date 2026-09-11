import { createUntypedClient, createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

// PATCH /api/bzg/caisse/eod
// Body: { caisse_id: string, action: 'approve' | 'reject', rejection_note?: string }
export async function PATCH(request: NextRequest) {
  try {
    const supabase      = await createUntypedClient()
    const typedSupabase = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, display_name, store_id')
      .eq('id', user.id)
      .single() as { data: { role: string; display_name: string; store_id: string | null } | null }

    if (!['manager', 'owner'].includes(profile?.role ?? '')) {
      return NextResponse.json({ error: 'Accès refusé — rôle manager ou owner requis' }, { status: 403 })
    }

    const body = await request.json() as Record<string, unknown>
    const caisse_id      = body.caisse_id      as string | undefined
    const action         = body.action         as string | undefined
    const rejection_note = body.rejection_note as string | undefined

    if (!caisse_id) return NextResponse.json({ error: 'caisse_id requis' }, { status: 400 })
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'action doit être "approve" ou "reject"' }, { status: 400 })
    }
    if (action === 'reject' && (!rejection_note || rejection_note.trim().length < 3)) {
      return NextResponse.json({ error: 'Motif de rejet requis (3 caractères minimum)' }, { status: 400 })
    }

    // Fetch current caisse record
    const { data: before } = await supabase
      .from('caisse')
      .select('*')
      .eq('caisse_id', caisse_id)
      .single() as { data: Record<string, unknown> | null }

    if (!before) return NextResponse.json({ error: 'Caisse introuvable' }, { status: 404 })
    if (before.status !== 'pending_eod') {
      return NextResponse.json(
        { error: `Cette caisse est en statut "${before.status}" — approbation impossible` },
        { status: 400 }
      )
    }

    const updatePayload = action === 'approve'
      ? {
          status:      'closed',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        }
      : {
          status:          'open',
          rejection_note:  rejection_note!.trim(),
        }

    const { error: updateErr } = await supabase
      .from('caisse')
      .update(updatePayload)
      .eq('caisse_id', caisse_id)

    if (updateErr) throw updateErr

    await logActivity({
      user_id:     user.id,
      store_id:    before.store_id as string,
      user_name:   profile?.display_name ?? '—',
      module:      'caisse',
      action_type: action === 'approve' ? 'EOD_APPROVE' : 'EOD_REJECT',
      after_state: {
        caisse_id,
        action,
        date:             before.date,
        solde_reel:       before.solde_reel,
        solde_theorique:  before.solde_theorique,
        ecart:            before.ecart,
        ...(rejection_note ? { rejection_note: rejection_note.trim() } : {}),
      },
    })

    return NextResponse.json({ status: 'success' })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}