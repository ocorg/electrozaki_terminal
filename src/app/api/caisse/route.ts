import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, dateOnly, HttpError } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

// ─── Shared aggregation — single source of truth for GET (live view) and PATCH (EOD submit) ───
//
// IMPORTANT: `solde_theorique` must reflect PHYSICAL CASH ONLY. Sales/repayments paid by
// virement or by card (the card portion of mixte) never enter the drawer — they must
// never be added to the theoretical cash balance, or it will drift further from the real count
// every time a customer pays by transfer/card. `total_ventes` / `total_credit_versements` below
// stay as gross (all-methods) figures for display only; `payment_breakdown.cash` is the figure
// that actually drives solde_theorique.
type CaisseTotals = {
  total_ventes:            number   // gross sales, all payment methods — display only
  total_reparations:       number   // cash repairs only (mode_paiement NULL/especes), cancelled tickets excluded
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
    credit:   number   // remaining balance still due on credit sales (not yet collected)
    reprises: number
  }
}

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v))
const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0)

async function computeCaisseTotals(store_id: string, date: Date): Promise<CaisseTotals> {
  const nextDay = new Date(date.getTime() + 86_400_000)
  const byMethod = { montant: true, payment_method: true } as const

  const [
    txns, repsDelivered, repsDepot, exps, drops,
    phoneCreditPmts, manualCreditPmts, importCreditPmts, reprises,
  ] = await Promise.all([
    prisma.transactions.findMany({
      where:  { store_id, date_vente: date, voided: false },
      select: { prix_vente: true, payment_method: true, avance: true, valeur_echange: true, montant_especes: true, montant_carte: true },
    }),
    // Cash only: cancelled tickets and repairs paid by bank transfer never
    // reach the drawer (mode_paiement NULL = older tickets, all cash).
    prisma.reparations.findMany({
      where:  { store_id, date_livraison: date, statut: 'recupere', is_deleted: false, OR: [{ mode_paiement: null }, { mode_paiement: 'especes' }] },
      select: { cout_reparation: true, avance_rep: true },
    }),
    prisma.reparations.findMany({
      where:  { store_id, date_depot: date, avance_rep: { gt: 0 }, is_deleted: false, OR: [{ mode_paiement: null }, { mode_paiement: 'especes' }] },
      select: { avance_rep: true },
    }),
    prisma.expenses.findMany({ where: { store_id, date, is_deleted: false }, select: { montant: true } }),
    prisma.cash_drops.findMany({ where: { store_id, date }, select: { amount: true } }),
    // Repayments on POS phone-credit installment plans
    prisma.phone_credit_payments.findMany({ where: { store_id, date_paiement: date }, select: byMethod }),
    // Repayments on ad-hoc client credit balances (Crédits tab) — no date_paiement column, use created_at
    prisma.credit_payments.findMany({ where: { store_id, created_at: { gte: date, lt: nextDay } }, select: byMethod }),
    // Repayments on imported legacy credit balances (Crédits > Imports tab)
    prisma.credit_import_payments.findMany({ where: { store_id, date_paiement: date }, select: byMethod }),
    prisma.phone_credit_sales.findMany({
      where:  { store_id, has_reprise: true, reprise_phone_id: { not: null }, discharged_at: { gte: date, lt: nextDay } },
      select: { reprise_valeur: true },
    }),
  ])

  // Combine all three client-repayment streams — each is a real cash/transfer event
  const creditPmts = [...phoneCreditPmts, ...manualCreditPmts, ...importCreditPmts]

  const total_ventes = sum(txns, t => {
    const pv = num(t.prix_vente), av = num(t.avance), ve = num(t.valeur_echange)
    if (t.payment_method === 'echange') return pv - ve
    if (t.payment_method === 'credit')  return av
    const isPartial = av > 0 && (pv - av - ve) > 0
    return isPartial ? av : pv - ve
  })

  // Cash physically collected from sales today — excludes virement entirely and the card portion of mixte
  const ventes_cash = sum(txns, t => {
    const pv = num(t.prix_vente), av = num(t.avance), ve = num(t.valeur_echange)
    switch (t.payment_method) {
      case 'especes': {
        const isPartial = av > 0 && (pv - av - ve) > 0
        return isPartial ? av : Math.max(pv - ve, 0)
      }
      case 'mixte':   return num(t.montant_especes)
      case 'echange': return Math.max(pv - ve, 0)
      case 'credit':  return av   // down payment taken at signing — assumed cash
      default:        return 0    // virement — bank money, never enters the drawer
    }
  })

  const ventes_transfer = sum(txns, t => {
    const pv = num(t.prix_vente), av = num(t.avance)
    if (t.payment_method === 'virement') {
      const isPartial = av > 0 && (pv - av) > 0
      return isPartial ? av : pv
    }
    if (t.payment_method === 'mixte') return num(t.montant_carte)
    return 0
  })

  const ventes_credit_due = sum(txns, t =>
    t.payment_method === 'credit' ? Math.max(num(t.prix_vente) - num(t.avance) - num(t.valeur_echange), 0) : 0)

  const total_reparations =
    sum(repsDelivered, r => Math.max(num(r.cout_reparation) - num(r.avance_rep), 0))
    + sum(repsDepot, r => num(r.avance_rep))

  const total_depenses   = sum(exps,  e => num(e.montant))
  const total_cash_drops = sum(drops, d => num(d.amount))

  const total_credit_versements = sum(creditPmts, p => num(p.montant))
  const credit_cash     = sum(creditPmts.filter(p => p.payment_method === 'especes'),  p => num(p.montant))
  const credit_transfer = sum(creditPmts.filter(p => p.payment_method === 'virement'), p => num(p.montant))

  const total_reprises = sum(reprises, r => num(r.reprise_valeur))

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

// solde_theorique is driven ONLY by payment_breakdown.cash (physical cash in) — see note above
const soldeTheorique = (ouverture: Prisma.Decimal | number, t: CaisseTotals) =>
  num(ouverture) + t.payment_breakdown.cash + t.total_reparations - t.total_depenses

export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const date     = dateOnly(searchParams.get('date') || new Date().toISOString().slice(0, 10))!
    if (!store_id) throw new HttpError(400, 'store_id requis')

    const caisse = await prisma.caisse.findFirst({ where: { store_id, date } })
    if (!caisse) return json({ data: null })

    // Once EOD has been submitted, the totals are a FROZEN snapshot taken at submit time and
    // already persisted on the row (see PATCH below). Re-computing live here would silently
    // disagree with the approved/pending ecart if a backdated edit or a void happens
    // afterwards — return the persisted snapshot as-is instead, so history stays honest.
    if (caisse.status !== 'ouverte') return json({ data: caisse })

    const totals = await computeCaisseTotals(store_id, date)
    return json({
      data: {
        ...caisse,
        total_ventes:            totals.total_ventes,
        total_reparations:       totals.total_reparations,
        total_depenses:          totals.total_depenses,
        total_cash_drops:        totals.total_cash_drops,
        solde_theorique:         soldeTheorique(caisse.ouverture, totals),
        payment_breakdown:       totals.payment_breakdown,
        total_credit_versements: totals.total_credit_versements,
        total_reprises:          totals.total_reprises,
        nb_transactions:         totals.nb_transactions,
        nb_cash_drops:           totals.nb_cash_drops,
        nb_credit_versements:    totals.nb_credit_versements,
        nb_reprises:             totals.nb_reprises,
      },
    })
  } catch (err) {
    return handleError(err, 'GET /api/caisse')
  }
}

// BOD — open the drawer for today
async function POST_(request: NextRequest) {
  try {
    const user     = await requireActiveUser()
    const body     = await request.json()
    const store_id = body.store_id ?? user.store_id
    const date     = dateOnly(new Date().toISOString().slice(0, 10))!
    if (!store_id) throw new HttpError(400, 'store_id manquant')

    const existing = await prisma.caisse.findFirst({ where: { store_id, date }, select: { caisse_id: true, status: true } })
    if (existing) return json({ error: 'Caisse déjà ouverte pour aujourd\'hui', data: existing }, { status: 409 })

    const ouverture = Number(body.ouverture ?? 0)
    const data = await prisma.caisse.create({
      data: { date, store_id, ouverture, status: 'ouverte', created_by: user.id },
    })

    await logActivity({
      store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'caisse',
      record_id:   data.caisse_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `Ouverture de caisse : ${ouverture} MAD`,
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/caisse')
  }
}

// EOD — submit closure for approval
async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const { caisse_id, solde_reel, notes } = await request.json()
    if (!caisse_id) throw new HttpError(400, 'caisse_id requis')
    if (solde_reel == null) throw new HttpError(400, 'solde_reel requis')

    const current = await prisma.caisse.findUnique({ where: { caisse_id } })
    if (!current) throw new HttpError(404, 'Caisse introuvable')
    if (current.status !== 'ouverte') throw new HttpError(400, 'Caisse non ouverte')
    if (!current.store_id) throw new HttpError(400, 'Caisse sans magasin')

    // Re-compute live solde_theorique at EOD time (the stored column value is stale)
    const totals          = await computeCaisseTotals(current.store_id, current.date)
    const solde_theorique = soldeTheorique(current.ouverture, totals)
    const ecart           = Number(solde_reel) - solde_theorique

    const data = await prisma.caisse.update({
      where: { caisse_id },
      data: {
        solde_reel:        Number(solde_reel),
        ecart,
        // Persist computed totals so BZG cross-store view reads real figures
        total_ventes:      totals.total_ventes,
        total_reparations: totals.total_reparations,
        total_depenses:    totals.total_depenses,
        total_cash_drops:  totals.total_cash_drops,
        solde_theorique,
        payment_breakdown: totals.payment_breakdown,
        status:            'en_attente_cloture',
        eod_submitted_at:  new Date(),
        closed_by:         user.id,
        notes:             notes || null,
      },
    })

    await logActivity({
      store_id:     current.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'soumission_cloture',
      module:       'caisse',
      record_id:    caisse_id,
      before_state: current,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
      notes:        `Clôture soumise — Réel : ${solde_reel} MAD | Écart : ${ecart} MAD`,
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/caisse')
  }
}

// EOD approval/rejection lives solely in /api/bzg/caisse/eod (PATCH) — it's the only path that
// role-checks AND writes an activity_log entry, and it supports both approve and reject.

export const POST = withNotify(POST_)
export const PATCH = withNotify(PATCH_)
