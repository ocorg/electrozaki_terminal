import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

// Financial analysis of one store over a date range (EZ → Analyse).
//
// Definitions (owner's decisions, 2026-09-27):
// - Sales = the sale price of every item sold (credit sales and trade-ins
//   included: a trade-in phone is a payment, it enters stock), minus the
//   returns refunded in the period. Cash actually received is reported
//   separately (Trésorerie).
// - Cost of goods = purchase price of what was sold (phones / laptops per
//   unit, accessories × quantity); a return put back in stock gives its cost
//   back.
// - Repairs = price of the repairs handed back in the period, minus parts.
// - Expenses = every category except "marchandises", which is buying stock
//   (its cost is already counted when the item sells). Dons are an expense.
// - Net profit = gross margin − expenses.

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const round = (v: number) => Math.round(v * 100) / 100
export const STOCK_PURCHASE_CATEGORY = 'marchandises'

type Row = Record<string, unknown>

/** One sold line with its cost and category, for the store and range. */
const SALES = (store: string, from: Date, to: Date) => Prisma.sql`
  SELECT t.txn_id, t.date_vente AS d, t.created_at, t.device_type, t.device_id, t.qty, t.prix_vente AS pv,
         t.payment_method, COALESCE(t.avance, 0) AS avance, COALESCE(t.valeur_echange, 0) AS ve,
         COALESCE(t.avoir_montant, 0) AS ao, t.type_operation, t.created_by, t.client_id,
         COALESCE(p.prix_achat, a.prix_achat, l.prix_achat) AS unit_cost,
         COALESCE(p.is_deleted, a.is_deleted, l.is_deleted, false) AS device_deleted,
         COALESCE(p.prix_achat, a.prix_achat, l.prix_achat, 0) * (CASE WHEN t.device_type = 'accessoire' THEN t.qty ELSE 1 END) AS cost,
         CASE t.device_type
           WHEN 'telephone' THEN 'telephone_' || COALESCE(p.condition::text, 'occasion')
           WHEN 'laptop'    THEN 'laptop'
           ELSE 'acc_' || COALESCE(a.categorie, 'autre') END AS cat,
         p.marque AS p_marque, p.serie AS p_serie, p.model AS p_model, p.stockage AS p_stockage,
         a.nom AS a_nom, a.marque AS a_marque, l.marque AS l_marque, l.model AS l_model
  FROM transactions t
  LEFT JOIN phones      p ON t.device_type = 'telephone'  AND p.phone_id  = t.device_id
  LEFT JOIN accessories a ON t.device_type = 'accessoire' AND a.acc_id    = t.device_id
  LEFT JOIN laptops     l ON t.device_type = 'laptop'     AND l.laptop_id = t.device_id
  WHERE NOT t.voided AND t.type_operation <> 'retour' AND t.store_id = ${store}
    AND t.date_vente >= ${from} AND t.date_vente <= ${to}`

/** Returns refunded in the range, with the cost given back when restocked. */
const RETURNS = (store: string, from: Date, to: Date) => Prisma.sql`
  SELECT r.retour_id, r.date AS d, r.qty, r.montant, r.mode, r.destination, r.motif, t.txn_id, t.device_type,
         CASE WHEN r.destination = 'stock'
              THEN COALESCE(p.prix_achat, a.prix_achat, l.prix_achat, 0) * (CASE WHEN t.device_type = 'accessoire' THEN r.qty ELSE 1 END)
              ELSE 0 END AS cost_back,
         CASE t.device_type
           WHEN 'telephone' THEN 'telephone_' || COALESCE(p.condition::text, 'occasion')
           WHEN 'laptop'    THEN 'laptop'
           ELSE 'acc_' || COALESCE(a.categorie, 'autre') END AS cat,
         COALESCE(p.marque || ' ' || p.model, a.nom, l.marque || ' ' || l.model, t.device_id) AS item
  FROM retours r
  JOIN transactions t ON t.txn_id = r.txn_id
  LEFT JOIN phones      p ON t.device_type = 'telephone'  AND p.phone_id  = t.device_id
  LEFT JOIN accessories a ON t.device_type = 'accessoire' AND a.acc_id    = t.device_id
  LEFT JOIN laptops     l ON t.device_type = 'laptop'     AND l.laptop_id = t.device_id
  WHERE r.type = 'retour' AND r.store_id = ${store} AND r.date >= ${from} AND r.date <= ${to}`

/** Repairs handed back in the range, with their parts. */
const REPAIRS = (store: string, from: Date, to: Date) => Prisma.sql`
  SELECT r.rep_id, r.date_livraison AS d, COALESCE(r.cout_reparation, 0) AS price,
         COALESCE((SELECT SUM(pp.cout) FROM reparations_parts pp WHERE pp.rep_id = r.rep_id), 0) AS parts,
         r.type_reparation::text AS kind, COALESCE(r.marque || ' ', '') || r.model AS item
  FROM reparations r
  WHERE r.store_id = ${store} AND NOT r.is_deleted AND r.statut = 'recupere'
    AND r.date_livraison >= ${from} AND r.date_livraison <= ${to}`

const EXPENSES = (store: string, from: Date, to: Date) => Prisma.sql`
  SELECT e.exp_id, e.date AS d, e.categorie, c.label_fr, e.montant, e.notes
  FROM expenses e JOIN categories c ON c.code = e.categorie
  WHERE e.store_id = ${store} AND NOT e.is_deleted AND e.date >= ${from} AND e.date <= ${to}`

type Sale = ReturnType<typeof toSale>
const toSale = (r: Row) => ({
  txn_id: String(r.txn_id), d: iso(r.d), at: r.created_at as Date, device_type: String(r.device_type), qty: num(r.qty),
  // A service sold as an "accessory" with no purchase price is pure labour: cost 0, nothing missing
  pv: num(r.pv), cost: num(r.cost), hasCost: r.unit_cost !== null || r.cat === 'acc_service', payment: String(r.payment_method),
  device_id: String(r.device_id), deleted: r.device_deleted === true,
  avance: num(r.avance), ve: num(r.ve), ao: num(r.ao), op: String(r.type_operation), seller: r.created_by as string | null,
  client: r.client_id as string | null, cat: String(r.cat),
  item: r.device_type === 'telephone' ? phoneName(r) : r.device_type === 'laptop' ? `${r.l_marque ?? ''} ${r.l_model ?? ''}`.trim() : String(r.a_nom ?? 'Accessoire'),
  model: r.device_type === 'telephone' ? phoneName(r, false) : null,
})

// "iPhone 13" (Apple stores serie "iPhone 13" + model "13"), "Samsung Galaxy A16"
function phoneName(r: Row, withStorage = true) {
  const marque = String(r.p_marque ?? '')
  const model  = String(r.p_model ?? '').replace(/\s*\d+\s*(GB|TB)\s*$/i, '').trim()
  const family = String(r.p_serie ?? '').trim().split(/\s+/)[0] ?? ''
  const lower  = model.toLowerCase()
  const base   = lower.startsWith(marque.toLowerCase()) || (family && lower.startsWith(family.toLowerCase()))
    ? model
    : `${family || marque} ${model}`.trim()
  return withStorage && r.p_stockage ? `${base} ${r.p_stockage}` : base
}
function iso(d: unknown) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10) }

/** What the customer actually handed over now (same rules as the caisse). */
function collected(s: Sale) {
  if (s.payment === 'credit') return s.avance
  const partial = s.avance > 0 && s.pv - s.avance - s.ve > 0
  return partial ? s.avance : Math.max(s.pv - s.ve - s.ao, 0)
}

async function load(store: string, from: Date, to: Date) {
  const [sales, returns, repairs, expenses] = await Promise.all([
    prisma.$queryRaw<Row[]>(SALES(store, from, to)),
    prisma.$queryRaw<Row[]>(RETURNS(store, from, to)),
    prisma.$queryRaw<Row[]>(REPAIRS(store, from, to)),
    prisma.$queryRaw<Row[]>(EXPENSES(store, from, to)),
  ])
  return {
    sales: sales.map(toSale),
    returns: returns.map(r => ({ id: String(r.retour_id), d: iso(r.d), qty: num(r.qty), montant: num(r.montant), mode: String(r.mode),
      destination: r.destination as string | null, motif: String(r.motif), txn_id: String(r.txn_id), cat: String(r.cat), costBack: num(r.cost_back), item: String(r.item) })),
    repairs: repairs.map(r => ({ id: String(r.rep_id), d: iso(r.d), price: num(r.price), parts: num(r.parts), kind: String(r.kind), item: String(r.item) })),
    expenses: expenses.map(e => ({ id: String(e.exp_id), d: iso(e.d), cat: String(e.categorie), label: String(e.label_fr), montant: num(e.montant), notes: e.notes as string | null })),
  }
}
type Data = Awaited<ReturnType<typeof load>>

function totals({ sales, returns, repairs, expenses }: Data, days: number) {
  const salesRevenue = sales.reduce((s, x) => s + x.pv, 0)
  const refunds      = returns.reduce((s, x) => s + x.montant, 0)
  const cogs         = sales.reduce((s, x) => s + x.cost, 0) - returns.reduce((s, x) => s + x.costBack, 0)
  const repairRev    = repairs.reduce((s, x) => s + x.price, 0)
  const repairParts  = repairs.reduce((s, x) => s + x.parts, 0)
  const revenue      = salesRevenue - refunds + repairRev
  const gross        = revenue - cogs - repairParts
  const opex         = expenses.filter(e => e.cat !== STOCK_PURCHASE_CATEGORY).reduce((s, x) => s + x.montant, 0)
  const net          = gross - opex
  const nbSales      = new Set(sales.map(s => s.at.toISOString().slice(0, 16) + (s.client ?? '') + (s.seller ?? ''))).size
  return {
    revenue: round(revenue), salesRevenue: round(salesRevenue), refunds: round(refunds), repairRevenue: round(repairRev),
    cogs: round(cogs), repairParts: round(repairParts), gross: round(gross), opex: round(opex), net: round(net),
    grossMargin: revenue ? round((gross / revenue) * 100) : null, netMargin: revenue ? round((net / revenue) * 100) : null,
    itemsSold: sales.reduce((s, x) => s + x.qty, 0), lines: sales.length, tickets: nbSales,
    basket: nbSales ? round(salesRevenue / nbSales) : null, perDay: days ? round(revenue / days) : null,
    collected: round(sales.reduce((s, x) => s + collected(x), 0)),
    missingCost: sales.filter(s => !s.hasCost).length,
  }
}

const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1

export async function financials(store: string, from: Date, to: Date) {
  const days = daysBetween(from, to)
  const prevTo = new Date(from.getTime() - 86_400_000)
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000)

  const [data, prev, users, accCats] = await Promise.all([
    load(store, from, to),
    load(store, prevFrom, prevTo),
    prisma.user_profiles.findMany({ select: { id: true, display_name: true } }),
    prisma.categories.findMany({ where: { type: 'accessoire' }, select: { code: true, label_fr: true } }),
  ])
  const { sales, returns, repairs, expenses } = data
  const userName = new Map(users.map(u => [u.id, u.display_name]))
  const accLabel = new Map(accCats.map(c => [c.code, c.label_fr]))
  const catLabel = (cat: string) =>
    cat === 'telephone_neuf' ? 'Téléphones neufs'
    : cat.startsWith('telephone_') ? "Téléphones d'occasion"
    : cat === 'laptop' ? 'Ordinateurs'
    : cat === 'repairs' ? 'Réparations'
    : accLabel.get(cat.slice(4)) ?? cat.slice(4)

  // ── By category: sales − returns, cost, margin; repairs as one more line ──
  const byCat = new Map<string, { revenue: number; cost: number; qty: number }>()
  const bump = (k: string, revenue: number, cost: number, qty: number) => {
    const v = byCat.get(k) ?? { revenue: 0, cost: 0, qty: 0 }
    v.revenue += revenue; v.cost += cost; v.qty += qty
    byCat.set(k, v)
  }
  for (const s of sales) bump(s.cat, s.pv, s.cost, s.qty)
  for (const r of returns) bump(r.cat, -r.montant, -r.costBack, -r.qty)
  if (repairs.length) bump('repairs', repairs.reduce((s, x) => s + x.price, 0), repairs.reduce((s, x) => s + x.parts, 0), repairs.length)
  const t = totals(data, days)
  const categories = [...byCat].map(([k, v]) => ({
    key: k, label: catLabel(k), group: k.startsWith('acc_') ? 'accessoires' : k.startsWith('telephone_') ? 'telephones' : k,
    revenue: round(v.revenue), cost: round(v.cost), profit: round(v.revenue - v.cost), qty: v.qty,
    margin: v.revenue ? round(((v.revenue - v.cost) / v.revenue) * 100) : null,
    profitShare: t.gross ? round(((v.revenue - v.cost) / t.gross) * 100) : null,
  })).sort((a, b) => b.revenue - a.revenue)

  // ── Top items ──
  const top = (rows: Sale[], key: (s: Sale) => string) => {
    const m = new Map<string, { qty: number; revenue: number; cost: number }>()
    for (const s of rows) {
      const k = key(s)
      const v = m.get(k) ?? { qty: 0, revenue: 0, cost: 0 }
      v.qty += s.qty; v.revenue += s.pv; v.cost += s.cost
      m.set(k, v)
    }
    return [...m].map(([name, v]) => ({ name, qty: v.qty, revenue: round(v.revenue), profit: round(v.revenue - v.cost),
      margin: v.revenue ? round(((v.revenue - v.cost) / v.revenue) * 100) : null }))
  }
  const phones = top(sales.filter(s => s.device_type === 'telephone'), s => s.model ?? s.item)
  const accessories = top(sales.filter(s => s.device_type === 'accessoire'), s => s.item)

  // ── Expenses ──
  const expMap = new Map<string, { label: string; total: number; n: number }>()
  for (const e of expenses) {
    const v = expMap.get(e.cat) ?? { label: e.label, total: 0, n: 0 }
    v.total += e.montant; v.n += 1
    expMap.set(e.cat, v)
  }
  const expenseCats = [...expMap].map(([code, v]) => ({
    code, label: v.label, total: round(v.total), n: v.n, stock: code === STOCK_PURCHASE_CATEGORY,
    share: t.opex && code !== STOCK_PURCHASE_CATEGORY ? round((v.total / t.opex) * 100) : null,
  })).sort((a, b) => b.total - a.total)

  // ── Sellers, payment methods, busy hours ──
  const group = <K extends string>(key: (s: Sale) => K) => {
    const m = new Map<K, { n: number; revenue: number; profit: number }>()
    for (const s of sales) {
      const k = key(s)
      const v = m.get(k) ?? { n: 0, revenue: 0, profit: 0 }
      v.n += 1; v.revenue += s.pv; v.profit += s.pv - s.cost
      m.set(k, v)
    }
    return [...m].map(([k, v]) => ({ key: k, n: v.n, revenue: round(v.revenue), profit: round(v.profit) })).sort((a, b) => b.revenue - a.revenue)
  }
  const sellers = group(s => (s.seller ?? '—') as string).map(r => ({ ...r, name: r.key === '—' ? '—' : userName.get(r.key) ?? '—' }))
  const payments = group(s => s.payment)
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, n: 0, revenue: 0 }))
  for (const s of sales) { const h = s.at.getUTCHours(); hours[h].n += 1; hours[h].revenue = round(hours[h].revenue + s.pv) }

  // ── Series: per day (per month when the range is long) ──
  const monthly = days > 92
  const bucket = (d: string) => (monthly ? d.slice(0, 7) : d)
  const series = new Map<string, { revenue: number; gross: number; opex: number; n: number }>()
  const cursor = new Date(from)
  while (cursor <= to) { series.set(bucket(cursor.toISOString().slice(0, 10)), { revenue: 0, gross: 0, opex: 0, n: 0 }); cursor.setUTCDate(cursor.getUTCDate() + 1) }
  const at = (d: string) => series.get(bucket(d))
  for (const s of sales) { const b = at(s.d); if (b) { b.revenue += s.pv; b.gross += s.pv - s.cost; b.n += 1 } }
  for (const r of returns) { const b = at(r.d); if (b) { b.revenue -= r.montant; b.gross -= r.montant - r.costBack } }
  for (const r of repairs) { const b = at(r.d); if (b) { b.revenue += r.price; b.gross += r.price - r.parts } }
  for (const e of expenses) { const b = at(e.d); if (b && e.cat !== STOCK_PURCHASE_CATEGORY) b.opex += e.montant }

  // ── Cash (trésorerie) ──
  const cash = {
    received:     round(sales.reduce((s, x) => s + collected(x), 0)),
    tradeIns:     round(sales.reduce((s, x) => s + x.ve, 0)),
    avoirs:       round(sales.reduce((s, x) => s + x.ao, 0)),
    toCollect:    round(sales.reduce((s, x) => s + (x.payment === 'credit' ? Math.max(x.pv - x.avance - x.ve, 0) : x.avance > 0 ? Math.max(x.pv - x.avance - x.ve, 0) : 0), 0)),
    repairs:      round(repairs.reduce((s, x) => s + x.price, 0)),
    stockBuys:    round(expenses.filter(e => e.cat === STOCK_PURCHASE_CATEGORY).reduce((s, x) => s + x.montant, 0)),
    refundsPaid:  round(returns.filter(r => r.mode !== 'avoir').reduce((s, x) => s + x.montant, 0)),
    expenses:     t.opex,
  }

  // ── Items sold without a purchase price (to complete from the screen) ──
  const missing = new Map<string, { device_type: string; device_id: string; item: string; lines: number; revenue: number; deleted: boolean }>()
  for (const s of sales.filter(x => !x.hasCost)) {
    const k = `${s.device_type}:${s.device_id}`
    const v = missing.get(k) ?? { device_type: s.device_type, device_id: s.device_id, item: s.item, lines: 0, revenue: 0, deleted: s.deleted }
    v.lines += 1; v.revenue = round(v.revenue + s.pv)
    missing.set(k, v)
  }
  const missingCosts = [...missing.values()].sort((a, b) => b.revenue - a.revenue)

  // ── One day: the full journal ──
  const journal = days === 1 ? {
    sales: sales.sort((a, b) => a.at.getTime() - b.at.getTime()).map(s => ({
      time: s.at.toISOString().slice(11, 16), txn_id: s.txn_id, item: s.item, qty: s.qty, price: s.pv, cost: s.hasCost ? s.cost : null,
      profit: s.hasCost ? round(s.pv - s.cost) : null, payment: s.payment, op: s.op, seller: s.seller ? userName.get(s.seller) ?? '—' : '—',
    })),
    returns: returns.map(r => ({ id: r.id, item: r.item, qty: r.qty, montant: r.montant, mode: r.mode, destination: r.destination, motif: r.motif })),
    repairs: repairs.map(r => ({ id: r.id, item: r.item, price: r.price, parts: r.parts, kind: r.kind })),
    expenses: expenses.map(e => ({ id: e.id, label: e.label, montant: e.montant, notes: e.notes, stock: e.cat === STOCK_PURCHASE_CATEGORY })),
  } : null

  return {
    from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days, bucket: monthly ? 'month' : 'day',
    totals: t, previous: totals(prev, days),
    series: [...series].map(([k, v]) => ({ key: k, revenue: round(v.revenue), gross: round(v.gross), net: round(v.gross - v.opex), opex: round(v.opex), n: v.n })),
    categories, phones: phones.sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 12),
    phonesByProfit: [...phones].sort((a, b) => b.profit - a.profit).slice(0, 5),
    accessories: accessories.sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 12),
    expenseCats, sellers, payments, hours, cash, journal, missingCosts,
  }
}
