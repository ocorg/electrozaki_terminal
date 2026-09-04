import { NextRequest, NextResponse } from 'next/server'
import { createUntypedClient, createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/utils/logger'

// ─────────────────────────────────────────────
// GET /api/phone-credits
// ?phone_id=PHO-XXXX  → crédit actif + historique paiements
// ?store_id=EZ-001    → tous les crédits du magasin
// ?statut=en_cours    → filtre optionnel
// ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { searchParams } = new URL(req.url)
    const phoneId = searchParams.get('phone_id')
    const storeId = searchParams.get('store_id')
    const statut  = searchParams.get('statut')

    if (!phoneId && !storeId) {
      return NextResponse.json({ error: 'phone_id ou store_id requis' }, { status: 400 })
    }

    let query = (supabase as any).from('phone_credits_summary').select('*')
    if (phoneId) query = query.eq('phone_id', phoneId)
    if (storeId) query = query.eq('store_id', storeId)
    if (statut)  query = query.eq('statut', statut)
    query = query.order('created_at', { ascending: false })

    const { data: credits, error } = await query
    if (error) throw error

    if (phoneId && Array.isArray(credits) && credits.length > 0) {
      const creditId = (credits[0] as Record<string, unknown>).credit_id as string

      const { data: payments, error: pErr } = await (supabase as any)
        .from('phone_credit_payments')
        .select('*')
        .eq('credit_id', creditId)
        .order('created_at', { ascending: true })

      if (pErr) throw pErr

      return NextResponse.json({
        data: { credit: credits[0] ?? null, payments: payments ?? [] },
      })
    }

    return NextResponse.json({ data: credits ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue'
    console.error('[GET /api/phone-credits]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─────────────────────────────────────────────
// POST /api/phone-credits — créer une vente à crédit
// ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
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

    const body = await req.json() as Record<string, unknown>
    const phone_id         = body.phone_id         as string
    const client_name      = body.client_name      as string
    const client_tel       = body.client_tel       as string | undefined
    const client_cin       = body.client_cin       as string | undefined
    const montant_total    = Number(body.montant_total)
    const avance_initiale  = body.avance_initiale ? Number(body.avance_initiale) : 0
    const payment_method   = (body.payment_method  as string | undefined) ?? 'نقد'
    const phone_remis      = Boolean(body.phone_remis)
    const notes            = body.notes            as string | undefined

    const storeId = (profile?.store_id as string | null) ?? (body.store_id as string) ?? 'EZ-001'

    // ── Validation ──
    if (!phone_id || !client_name || !montant_total) {
      return NextResponse.json(
        { error: 'phone_id, client_name et montant_total sont obligatoires' },
        { status: 400 }
      )
    }
    if (montant_total <= 0) {
      return NextResponse.json({ error: 'Montant total invalide' }, { status: 400 })
    }
    if (avance_initiale > montant_total) {
      return NextResponse.json(
        { error: "L'avance ne peut pas dépasser le montant total" },
        { status: 400 }
      )
    }

    // ── Vérifier statut du téléphone ──
    const { data: phoneRaw, error: phoneErr } = await (supabase as any)
      .from('phones')
      .select('phone_id, status, model, marque')
      .eq('phone_id', phone_id)
      .eq('is_deleted', false)
      .single()

    if (phoneErr || !phoneRaw) {
      return NextResponse.json({ error: 'Téléphone introuvable' }, { status: 404 })
    }

    const phone = phoneRaw as Record<string, unknown>

    if ((phone.status as string) !== 'متوفر') {
      return NextResponse.json(
        { error: `Ce téléphone n'est pas disponible (statut : ${phone.status as string})` },
        { status: 400 }
      )
    }

    // ── Vérifier pas de crédit actif existant ──
    const { data: existing } = await (supabase as any)
      .from('phone_credit_sales')
      .select('credit_id')
      .eq('phone_id', phone_id)
      .eq('statut', 'en_cours')
      .eq('is_deleted', false)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'Ce téléphone a déjà un crédit en cours' },
        { status: 400 }
      )
    }

    // ── Créer la vente à crédit ──
    const { data: creditRaw, error: creditErr } = await (supabase as any)
      .from('phone_credit_sales')
      .insert({
        phone_id,
        client_name,
        client_tel:   client_tel  ?? null,
        client_cin:   client_cin  ?? null,
        montant_total,
        montant_paye: 0,
        statut:       'en_cours',
        phone_remis,
        notes:        notes ?? null,
        store_id:     storeId,
        created_by:   user.id,
      })
      .select()
      .single()

    if (creditErr) throw creditErr
    const credit = creditRaw as Record<string, unknown>

    // ── Avance initiale ──
    let firstPayment: unknown = null
    let finalMontantPaye = 0

    if (avance_initiale > 0) {
      const { data: paymentRaw, error: payErr } = await (supabase as any)
        .from('phone_credit_payments')
        .insert({
          credit_id:      credit.credit_id,
          montant:         avance_initiale,
          payment_method,
          date_paiement:   new Date().toISOString().split('T')[0],
          store_id:        storeId,
          created_by:      user.id,
        })
        .select()
        .single()

      if (payErr) throw payErr
      firstPayment     = paymentRaw
      finalMontantPaye = avance_initiale

      const autoSolde = finalMontantPaye >= montant_total
      const { error: updateErr } = await (supabase as any)
        .from('phone_credit_sales')
        .update({
          montant_paye: finalMontantPaye,
          ...(autoSolde ? { statut: 'solde' } : {}),
        })
        .eq('credit_id', credit.credit_id)

      if (updateErr) throw updateErr
    }

    // ── Statut téléphone : حجز (réservé) ou مباع (parti) ──
    const newStatus = phone_remis ? 'مباع' : 'حجز'
    const { error: statusErr } = await (supabase as any)
      .from('phones')
      .update({ status: newStatus, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq('phone_id', phone_id)

    if (statusErr) throw statusErr

    await logActivity({
      user_id:    user.id,
      store_id:   storeId,
      user_name:  (profile?.display_name as string) ?? 'Inconnu',
      module:     'phones' as any,
      action_type: 'INSERT',
      after_state: {
        credit_id:        credit.credit_id,
        phone_id,
        client_name,
        montant_total,
        avance_initiale,
        phone_remis,
        new_phone_status: newStatus,
      },
    })

    return NextResponse.json({ data: { credit, firstPayment } }, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue'
    console.error('[POST /api/phone-credits]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}