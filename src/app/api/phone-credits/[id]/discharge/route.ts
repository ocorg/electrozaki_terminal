import { NextRequest, NextResponse } from 'next/server'
import { createUntypedClient, createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/utils/logger'

// ─────────────────────────────────────────────
// POST /api/phone-credits/[id]/discharge
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
    const storeId  = (profile?.store_id as string | null) ?? (body.store_id as string) ?? 'EZ-001'

    // ── Récupérer le crédit via la vue ──
    const { data: creditRaw, error: creditErr } = await (supabase as any)
      .from('phone_credits_summary')
      .select('*')
      .eq('credit_id', creditId)
      .single()

    if (creditErr || !creditRaw) {
      return NextResponse.json({ error: 'Crédit introuvable' }, { status: 404 })
    }

    const credit = creditRaw as Record<string, unknown>

    // ── Garde-fous ──
    if (Number(credit.montant_restant) > 0.01) {
      return NextResponse.json(
        {
          error: `Décharge impossible — reste ${Number(credit.montant_restant).toFixed(2)} DH à payer`,
        },
        { status: 400 }
      )
    }

    if (credit.discharged_at) {
      return NextResponse.json({ error: 'Ce crédit a déjà été déchargé' }, { status: 400 })
    }

    // ── Reprise : préparer warning si jamais marquée comme reçue avant ──
    const hasReprise     = Boolean(credit.has_reprise)
    const repriseRemise  = Boolean(credit.reprise_remise)
    const repriseWarning = hasReprise && !repriseRemise
      ? 'reprise_not_previously_confirmed' as const
      : null

    // ── Marquer soldé + déchargé ──
    const { error: dischargeErr } = await (supabase as any)
      .from('phone_credit_sales')
      .update({
        discharged_at: new Date().toISOString(),
        discharged_by: user.id,
        statut:        'solde',
      })
      .eq('credit_id', creditId)

    if (dischargeErr) throw dischargeErr

    // ── Créer stock entry pour le téléphone de reprise ──
    let reprisePhoneId: string | null = null

    if (hasReprise) {
      const etatMap: Record<string, string> = {
        bon:     'مستعمل',
        moyen:   'مستعمل',
        mauvais: 'معطوب',
      }
      const repriseCondition = etatMap[credit.reprise_etat as string] ?? 'مستعمل'
      const repriseNow       = new Date().toISOString()

      const { data: reprisePhoneRaw, error: repriseErr } = await (supabase as any)
        .from('phones')
        .insert({
          source:      'Reprise',
          status:      'متوفر',
          marque:      credit.reprise_marque as string,
          serie:       (credit.reprise_serie as string | null) ?? (credit.reprise_marque as string),
          model:       credit.reprise_model  as string,
          imei:        (credit.reprise_imei  as string | null) ?? null,
          condition:   repriseCondition,
          prix_achat:  credit.reprise_valeur as number,
          store_id:    storeId,
          description: `Reprise crédit ${creditId} — ${credit.client_name as string}`,
          created_by:  user.id,
          updated_by:  user.id,
          is_deleted:  false,
        })
        .select('phone_id')
        .single()

      if (repriseErr) throw repriseErr
      reprisePhoneId = (reprisePhoneRaw as Record<string, unknown>).phone_id as string

      // Lier le téléphone repris au crédit et confirmer la réception
      const { error: repriseUpdateErr } = await (supabase as any)
        .from('phone_credit_sales')
        .update({
          reprise_phone_id:  reprisePhoneId,
          reprise_remise:    true,
          reprise_remise_at: repriseNow,
        })
        .eq('credit_id', creditId)

      if (repriseUpdateErr) throw repriseUpdateErr
    }

    // ── حجز → مباع si téléphone réservé qui part maintenant ──
    if (!credit.phone_remis) {
      const { error: statusErr } = await (supabase as any)
        .from('phones')
        .update({
          status:     'مباع',
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('phone_id', credit.phone_id as string)

      if (statusErr) throw statusErr
    }

    // ── Récupérer IMEI pour pré-remplir la FAC ──
    const { data: phoneRaw } = await (supabase as any)
      .from('phones')
      .select('imei, serie')
      .eq('phone_id', credit.phone_id as string)
      .single()

    const phoneData = phoneRaw as Record<string, unknown> | null

    await logActivity({
      user_id:    user.id,
      store_id:   storeId,
      user_name:  (profile?.display_name as string) ?? 'Inconnu',
      module:     'phones' as any,
      action_type: 'UPDATE',
      after_state: {
        credit_id:        creditId,
        phone_id:         credit.phone_id,
        action:           'DISCHARGE',
        phone_remis:      credit.phone_remis,
        montant_total:    credit.montant_total,
        has_reprise:      hasReprise,
        reprise_phone_id: reprisePhoneId,
        ...(repriseWarning ? { warning: repriseWarning } : {}),
      },
    })

    return NextResponse.json({
      data: {
        discharged:       true,
        credit_id:        creditId,
        reprise_phone_id: reprisePhoneId,
        ...(repriseWarning ? { warning: repriseWarning } : {}),
        fac_prefill: {
          phone_id:     credit.phone_id     as string,
          client_name:  credit.client_name  as string,
          client_tel:   (credit.client_tel  as string | null) ?? '',
          client_cin:   (credit.client_cin  as string | null) ?? '',
          montant:      credit.montant_total as number,
          device_label: `${credit.marque as string} ${credit.model as string}`,
          imei:         (phoneData?.imei as string | null) ?? (phoneData?.serie as string | null) ?? '',
        },
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue'
    console.error('[POST /api/phone-credits/[id]/discharge]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}