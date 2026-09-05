import { NextRequest, NextResponse } from 'next/server'
import { createUntypedClient, createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/utils/logger'

// ─────────────────────────────────────────────
// POST /api/phone-credits/[id]/receive-reprise
// Marque le téléphone de reprise comme reçu physiquement.
// Ne crée PAS de stock entry — seulement à la décharge.
// ─────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase   = await createUntypedClient()
    const authClient = await createClient()

    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profileRaw } = await (supabase as any)
      .from('user_profiles')
      .select('store_id, display_name')
      .eq('id', user.id)
      .single()

    const profile  = profileRaw as Record<string, unknown> | null
    const body     = await req.json() as Record<string, unknown>
    const creditId = params.id
    const storeId  = (profile?.store_id as string | null) ?? (body.store_id as string) ?? 'EZ-001'

    // ── Charger le crédit ──
    const { data: creditRaw, error: creditErr } = await (supabase as any)
      .from('phone_credit_sales')
      .select('credit_id, has_reprise, reprise_remise, reprise_model, statut')
      .eq('credit_id', creditId)
      .eq('is_deleted', false)
      .single()

    if (creditErr || !creditRaw) {
      return NextResponse.json({ error: 'Crédit introuvable' }, { status: 404 })
    }

    const credit = creditRaw as Record<string, unknown>

    // ── Validations ──
    if (!credit.has_reprise) {
      return NextResponse.json(
        { error: 'Ce crédit ne contient pas de reprise' },
        { status: 400 }
      )
    }
    if (credit.reprise_remise) {
      return NextResponse.json(
        { error: 'La reprise a déjà été marquée comme reçue' },
        { status: 400 }
      )
    }
    if (credit.statut !== 'en_cours') {
      return NextResponse.json(
        { error: 'Le crédit n\'est plus en cours' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    // ── Marquer reçu (pas de stock entry — reporté à la décharge) ──
    const { error: updateErr } = await (supabase as any)
      .from('phone_credit_sales')
      .update({ reprise_remise: true, reprise_remise_at: now })
      .eq('credit_id', creditId)

    if (updateErr) throw updateErr

    await logActivity({
      user_id:     user.id,
      store_id:    storeId,
      user_name:   (profile?.display_name as string) ?? 'Inconnu',
      module:      'phones' as any,
      action_type: 'UPDATE',
      after_state: {
        credit_id:         creditId,
        reprise_remise:    true,
        reprise_remise_at: now,
        reprise_model:     credit.reprise_model,
      },
    })

    return NextResponse.json({
      data: { credit_id: creditId, reprise_remise: true, reprise_remise_at: now },
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue'
    console.error('[POST /api/phone-credits/[id]/receive-reprise]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}