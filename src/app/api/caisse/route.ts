import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

// ─── Shared aggregation — single source of truth for GET (live view) and PATCH (EOD submit) ───
//
// IMPORTANT: `solde_theorique` must reflect PHYSICAL CASH ONLY. Sales/repayments paid by
// virement (تحويل) or by card (the card portion of مختلط) never enter the drawer — they must
// never be added to the theoretical cash balance, or it will drift further from the real count
// every time a customer pays by transfer/card. `total_ventes` / `total_credit_versements` below
// stay as gross (all-methods) figures for display only; `payment_breakdown.cash` is the figure
// that actually drives solde_theorique.
type CaisseTotals = {
  total_ventes:            number   // gross sales, all payment methods — display only
  total_reparations:       number   // repairs have no payment_method column — assumed cash
  total_depenses:          number   // expenses have no payment_method column — assumed cash
  total_cash_drops:        number
  total_credit_versements: number   // gross credit repayments (phone-credit + ad-hoc + imported), all payment methods — display only
  total_reprises:          number   // trade-in devices discharged — non-cash, informational
  nb_transactions:         number
  nb_cash_drops:           number
  nb_credit_versements:    number
  nb_reprises:             number
  payment_breakdown: {
    cash:     number   // physical cash actually collected — THE figure behind solde_theorique
    transfer: number
    credit:   number   // remaining balance still due on آجل sales (not yet collected)
    reprises: number
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function computeCaisseTotals(supabase: any, store_id: string, date: string): Promise<CaisseTotals> {
  const nextDate = new Date(new Date(date + 'T00:00:00Z').getTime() + 86_400_000)
    .toISOString().split('T')[0]

  const [
    txnRes, repDeliveredRes, repDepotRes, expRes, dropRes,
    phoneCreditRes, manualCreditRes, importCreditRes, repriseRes,
  ] = await Promise.all([
    supabase.from('transactions')
      .select('prix_vente, payment_method, avance, valeur_echange, montant_especes, montant_carte')
      .eq('store_id', store_id).eq('date_vente', date).eq('voided', false),
    supabase.from('reparations')
      .select('cout_reparation, avance_rep')
      .eq('store_id', store_id).eq('date_livraison', date).eq('statut', 'تم الاستلام'),
    supabase.from('reparations')
      .select('avance_rep')
      .eq('store_id', store_id).eq('date_depot', date).gt('avance_rep', 0),
    supabase.from('expenses')
      .select('montant')
      .eq('store_id', store_id).eq('date', date).eq('is_deleted', false),
    supabase.from('cash_drops')
      .select('amount')
      .eq('store_id', store_id).eq('date', date),
    // Repayments on POS phone-credit installment plans
    supabase.from('phone_credit_payments')
      .select('montant, payment_method')
      .eq('store_id', store_id).eq('date_paiement', date),
    // Repayments on ad-hoc client credit balances (Crédits tab) — no date_paiement column, use created_at
    supabase.from('credit_payments')
      .select('montant, payment_method')
      .eq('store_id', store_id)
      .gte('created_at', `${date}T00:00:00.000Z`).lt('created_at', `${nextDate}T00:00:00.000Z`),
    // Repayments on imported legacy credit balances (Crédits > Imports tab)
    supabase.from('credit_import_payments')
      .select('montant, payment_method')
      .eq('store_id', store_id).eq('date_paiement', date),
    supabase.from('phone_credit_sales')
      .select('reprise_valeur')
      .eq('store_id', store_id).eq('has_reprise', true).not('reprise_phone_id', 'is', null)
      .gte('discharged_at', `${date}T00:00:00.000Z`).lt('discharged_at', `${nextDate}T00:00:00.000Z`),
  ])

  const txns          = (txnRes.data          || []) as Record<string, unknown>[]
  const repsDelivered = (repDeliveredRes.data  || []) as Record<string, unknown>[]
  const repsDepot     = (repDepotRes.data      || []) as Record<string, unknown>[]
  const exps          = (expRes.data           || []) as Record<string, unknown>[]
  const drops         = (dropRes.data          || []) as Record<string, unknown>[]
  const reprises      = (repriseRes.data       || []) as Record<string, unknown>[]
  // Combine all three client-repayment streams — each is a real cash/transfer event
  // that must feed the same caisse totals as phone-credit repayments already did.
  const creditPmts = [
    ...((phoneCreditRes.data  || []) as Record<string, unknown>[]),
    ...((manualCreditRes.data || []) as Record<string, unknown>[]),
    ...((importCreditRes.data || []) as Record<string, unknown>[]),
  ]

  const total_ventes = txns.reduce((s, t) => {
    const pv = (t.prix_vente     as number) || 0
    const av = (t.avance         as number) || 0
    const ve = (t.valeur_echange as number) || 0
    const pm =  t.payment_method as string
    if (pm === 'إستبدال') return s + (pv - ve)
    if (pm === 'آجل')    return s + av
    const isPartial = av > 0 && (pv - av - ve) > 0
    return s + (isPartial ? av : pv - ve)
  }, 0)

  // Cash physically collected from sales today — excludes تحويل entirely and the card portion of مختلط
  const ventes_cash = txns.reduce((s, t) => {
    const pm = t.payment_method as string
    const pv = (t.prix_vente     as number) || 0
    const av = (t.avance         as number) || 0
    const ve = (t.valeur_echange as number) || 0
    if (pm === 'نقد') {
      const isPartial = av > 0 && (pv - av - ve) > 0
      return s + (isPartial ? av : Math.max(pv - ve, 0))
    }
    if (pm === 'مختلط')   return s + ((t.montant_especes as number) || 0)
    if (pm === 'إستبدال') return s + Math.max(pv - ve, 0)
    if (pm === 'آجل')     return s + av   // down payment taken at signing — assumed cash
    return s                              // تحويل — bank money, never enters the drawer
  }, 0)

  const ventes_transfer = txns.reduce((s, t) => {
    const pm = t.payment_method as string
    const pv = (t.prix_vente as number) || 0
    const av = (t.avance    as number) || 0
    if (pm === 'تحويل') {
      const isPartial = av > 0 && (pv - av) > 0
      return s + (isPartial ? av : pv)
    }
    if (pm === 'مختلط') return s + ((t.montant_carte as number) || 0)
    return s
  }, 0)

  const ventes_credit_due = txns.reduce((s, t) => {
    const pm = t.payment_method as string
    const pv = (t.prix_vente     as number) || 0
    const av = (t.avance         as number) || 0
    const ve = (t.valeur_echange as number) || 0
    if (pm === 'آجل') return s + Math.max(pv - av - ve, 0)
    return s
  }, 0)

  const total_reparations =
    repsDelivered.reduce((s, r) => {
      const cout   = (r.cout_reparation as number) || 0
      const avance = (r.avance_rep      as number) || 0
      return s + Math.max(cout - avance, 0)
    }, 0)
    + repsDepot.reduce((s, r) => s + ((r.avance_rep as number) || 0), 0)

  const total_depenses   = exps.reduce( (s, e) => s + ((e.montant as number) || 0), 0)
  const total_cash_drops = drops.reduce((s, d) => s + ((d.amount  as number) || 0), 0)

  const total_credit_versements = creditPmts.reduce((s, p) => s + ((p.montant as number) || 0), 0)
  const credit_cash     = creditPmts.filter(p => (p.payment_method as string) === 'نقد'   ).reduce((s, p) => s + ((p.montant as number) || 0), 0)
  const credit_transfer = creditPmts.filter(p => (p.payment_method as string) === 'تحويل').reduce((s, p) => s + ((p.montant as number) || 0), 0)

  const total_reprises = reprises.reduce((s, r) => s + ((r.reprise_valeur as number) || 0), 0)

  return {
    total_ventes,
    total_reparations,
    total_depenses,
    total_cash_drops,
    total_credit_versements,
    total_reprises,
    nb_transactions:      txns.length,
    nb_cash_drops:        drops.length,
    nb_credit_versements: creditPmts.length,
    nb_reprises:          reprises.length,
    payment_breakdown: {
      cash:     ventes_cash + total_cash_drops + credit_cash,
      transfer: ventes_transfer + credit_transfer,
      credit:   ventes_credit_due,
      reprises: total_reprises,
    },
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const date     = searchParams.get('date') || new Date().toISOString().split('T')[0]

    if (!store_id) return NextResponse.json({ error: 'store_id requis' }, { status: 400 })

    // Fetch today's caisse record
    const { data: caisse } = await supabase
      .from('caisse')
      .select('*')
      .eq('store_id', store_id)
      .eq('date', date)
      .single() as { data: Record<string, unknown> | null }

    if (!caisse) {
      return NextResponse.json({ data: null })
    }

    // Once EOD has been submitted (pending_eod/closed), the totals are a FROZEN snapshot taken
    // at submit time and already persisted on the row (see PATCH below). Re-computing live here
    // would silently disagree with the approved/pending ecart if a backdated edit or a void
    // happens afterwards — return the persisted snapshot as-is instead, so history stays honest.
    if (caisse.status !== 'open') {
      return NextResponse.json({ data: caisse })
    }

    const totals     = await computeCaisseTotals(supabase, store_id, date)
    const ouverture  = (caisse.ouverture as number) || 0
    // solde_theorique is driven ONLY by payment_breakdown.cash (physical cash in) — see note above computeCaisseTotals
    const solde_theorique = ouverture + totals.payment_breakdown.cash + totals.total_reparations - totals.total_depenses

    return NextResponse.json({
      data: {
        ...caisse,
        total_ventes:            totals.total_ventes,
        total_reparations:       totals.total_reparations,
        total_depenses:          totals.total_depenses,
        total_cash_drops:        totals.total_cash_drops,
        solde_theorique,
        payment_breakdown:       totals.payment_breakdown,
        total_credit_versements: totals.total_credit_versements,
        total_reprises:          totals.total_reprises,
        nb_transactions:         totals.nb_transactions,
        nb_cash_drops:           totals.nb_cash_drops,
        nb_credit_versements:    totals.nb_credit_versements,
        nb_reprises:             totals.nb_reprises,
      }
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  // BOD — open the drawer for today
  try {
    const supabase       = await createUntypedClient()
    const typedSupabase  = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, store_id')
      .eq('id', user.id)
      .single() as { data: { display_name: string; store_id: string | null } | null }

    const body     = await request.json()
    const store_id = body.store_id ?? profile?.store_id
    const date     = new Date().toISOString().split('T')[0]

    if (!store_id) return NextResponse.json({ error: 'store_id manquant' }, { status: 400 })

    // Check not already open today
    const { data: existing } = await supabase
      .from('caisse')
      .select('caisse_id, status')
      .eq('store_id', store_id)
      .eq('date', date)
      .single() as { data: { caisse_id: string; status: string } | null }

    if (existing) {
      return NextResponse.json({ error: 'Caisse déjà ouverte pour aujourd\'hui', data: existing }, { status: 409 })
    }

    const { data, error } = await supabase
      .from('caisse')
      .insert({
        date,
        store_id,
        ouverture:  body.ouverture ?? 0,
        status:     'open',
        created_by: user.id,
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      store_id,
      user_id:     user.id,
      user_name:   profile?.display_name ?? '—',
      action_type: 'INSERT',
      module:      'caisse',
      record_id:   data.caisse_id as string,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `BOD — Ouverture: ${body.ouverture} MAD`,
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  // EOD — submit closure for approval
  try {
    const supabase       = await createUntypedClient()
    const typedSupabase  = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, store_id')
      .eq('id', user.id)
      .single() as { data: { display_name: string; store_id: string | null } | null }

    const body = await request.json()
    const { caisse_id, solde_reel, notes } = body

    if (!caisse_id) return NextResponse.json({ error: 'caisse_id requis' }, { status: 400 })
    if (solde_reel == null) return NextResponse.json({ error: 'solde_reel requis' }, { status: 400 })

    // Fetch current to compute ecart
    const { data: current } = await supabase
      .from('caisse')
      .select('*')
      .eq('caisse_id', caisse_id)
      .single() as { data: Record<string, unknown> | null }

    if (!current) return NextResponse.json({ error: 'Caisse introuvable' }, { status: 404 })
    if (current.status !== 'open') return NextResponse.json({ error: 'Caisse non ouverte' }, { status: 400 })

    // Re-compute live solde_theorique at EOD time (the stored column value is stale)
    const caisseDate  = current.date as string
    const caisseStore = current.store_id as string

    const totals = await computeCaisseTotals(supabase, caisseStore, caisseDate)
    // solde_theorique is driven ONLY by payment_breakdown.cash (physical cash in) — see note above computeCaisseTotals
    const solde_theorique = ((current.ouverture as number) || 0) + totals.payment_breakdown.cash + totals.total_reparations - totals.total_depenses
    const ecart           = solde_reel - solde_theorique

    const { data, error } = await supabase
      .from('caisse')
      .update({
        solde_reel,
        ecart,
        // Persist computed totals so BZG cross-store view reads real figures
        total_ventes:      totals.total_ventes,
        total_reparations: totals.total_reparations,
        total_depenses:    totals.total_depenses,
        total_cash_drops:  totals.total_cash_drops,
        solde_theorique,
        payment_breakdown: totals.payment_breakdown,
        status:           'pending_eod',
        eod_submitted_at: new Date().toISOString(),
        closed_by:        user.id,
        notes:            notes || null,
      })
      .eq('caisse_id', caisse_id)
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    await logActivity({
      store_id:     current.store_id as string,
      user_id:      user.id,
      user_name:    profile?.display_name ?? '—',
      action_type:  'EOD_SUBMIT',
      module:       'caisse',
      record_id:    caisse_id,
      before_state: current,
      after_state:  data as Record<string, unknown>,
      ip_address:   getIpFromRequest(request),
      notes:        `EOD — Réel: ${solde_reel} MAD | Écart: ${ecart} MAD`,
    })

    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

// EOD approval/rejection lives solely in /api/bzg/caisse/eod (PATCH) — it's the only path that
// role-checks AND writes an activity_log entry, and it supports both approve and reject.
// A PUT handler used to live here too (approve-only, no reject) and every caller has been
// migrated off it — removed to close off the "two approval paths that can silently drift" gap.