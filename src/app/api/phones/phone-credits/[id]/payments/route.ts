import { NextRequest, NextResponse } from 'next/server'
import { createUntypedClient, createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/utils/logger'

// ─────────────────────────────────────────────
// POST /api/phone-credits/[id]/payments
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

    const profile = profileRaw as Record<string, unknown> | null

    const creditId = params.id
    const body     = await req.json() as Record<string, unknown>
    const montant          = Number(body.montant)
    const payment_method   = body.payment_method as string
    const date_paiement    = body.date_paiement  as string | undefined
    const notes            = body.notes          as string | undefined

    const storeId = (profile?.store_id as string | null) ?? (body.store_id as string) ?? 'EZ-001'

    // ── Validation ──
    if (!montant || montant <= 0) {
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })
    }
    if (!payment_method || !['نقد', 'تحويل'].includes(payment_method)) {
      return NextResponse.json({ error: 'Mode de paiement invalide (نقد ou تحويل)' }, { status: 400 })
    }

    // ── Récupérer le crédit ──
    const { data: creditRaw, error: creditErr } = await (supabase as any)
      .from('phone_credit_sales')
      .select('*')
      .eq('credit_id', creditId)
      .eq('is_deleted', false)
      .single()

    if (creditErr || !creditRaw) {
      return NextResponse.json({ error: 'Crédit introuvable' }, { status: 404 })
    }

    const credit = creditRaw as Record<string, unknown>

    if (credit.statut !== 'en_cours') {
      return NextResponse.json(
        { error: `Ce crédit est déjà « ${credit.statut as string} »` },
        { status: 400 }
      )
    }

    const montantRestant = Number(credit.montant_total) - Number(credit.montant_paye)
    if (montant > montantRestant + 0.01) {
      return NextResponse.json(
        { error: `Versement trop élevé — reste dû : ${montantRestant.toFixed(2)} DH` },
        { status: 400 }
      )
    }

    // ── Insérer le paiement ──
    const { data: paymentRaw, error: payErr } = await (supabase as any)
      .from('phone_credit_payments')
      .insert({
        credit_id:      creditId,
        montant,
        payment_method,
        date_paiement:  date_paiement ?? new Date().toISOString().split('T')[0],
        notes:          notes ?? null,
        store_id:       storeId,
        created_by:     user.id,
      })
      .select()
      .single()

    if (payErr) throw payErr
    const payment = paymentRaw as Record<string, unknown>

    // ── Mettre à jour montant_paye ──
    const newMontantPaye = Number(credit.montant_paye) + montant
    const isFullyPaid    = newMontantPaye >= Number(credit.montant_total) - 0.01

    const { error: updateErr } = await (supabase as any)
      .from('phone_credit_sales')
      .update({
        montant_paye: newMontantPaye,
        ...(isFullyPaid ? { statut: 'solde' } : {}),
      })
      .eq('credit_id', creditId)

    if (updateErr) throw updateErr

    await logActivity({
      user_id:    user.id,
      store_id:   storeId,
      user_name:  (profile?.display_name as string) ?? 'Inconnu',
      module:     'phones' as any,
      action_type: 'UPDATE',
      after_state: {
        credit_id:        creditId,
        payment_id:       payment.payment_id,
        montant,
        payment_method,
        new_montant_paye: newMontantPaye,
        is_fully_paid:    isFullyPaid,
      },
    })

    return NextResponse.json(
      {
        data: {
          payment,
          credit_updated: {
            montant_paye:  newMontantPaye,
            statut:        isFullyPaid ? 'solde' : 'en_cours',
            is_fully_paid: isFullyPaid,
          },
        },
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue'
    console.error('[POST /api/phone-credits/[id]/payments]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}