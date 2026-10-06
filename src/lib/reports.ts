// What the owner and the managers want to know without opening the ERP
// (owner, 2026-10-06), sent to the store's Telegram group:
//   • the day's summary, when the caisse is closed
//   • a morning list of what needs doing today (nothing to say = no message)
//   • a weekly summary on Monday
//   • short alerts when money moves out of the ordinary
// Figures come from the same calculations as the screens (lib/analytics, caisse).
import { Prisma } from '@prisma/client'
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db'
import { financials } from '@/lib/analytics'
import { scheduleStatus } from '@/lib/creditSchedule'
import { telegram } from '@/lib/siteNotify'
import { storefrontConfigured } from '@/lib/storefront/db'
import { site } from '@/lib/storefront/access'
import { businessDate, STORE_TIME_ZONE } from '@/lib/time'

const dh = (v: unknown) => `${Math.round(Number(v ?? 0)).toLocaleString('fr-FR')} DH`
const dayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit' })
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const addDays = (iso: string, n: number) => new Date(utc(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/** Sends after the response, never in its way; a failed message only logs. */
export function alertTelegram(text: string) {
  waitUntil(telegram(text).catch(err => { console.error('[alert] failed:', err); return false }))
}

/** Same, for a message that needs a look-up first. */
export function alertLater(build: () => Promise<string | null>) {
  waitUntil(build().then(text => (text ? telegram(text) : false)).catch(err => { console.error('[alert] failed:', err); return false }))
}

export const money = dh

/** "Apple 13 128GB" / the accessory's name — what a line is about, in words. */
export async function deviceName(type: string, id: string) {
  if (type === 'telephone') {
    const p = await prisma.phones.findUnique({ where: { phone_id: id }, select: { marque: true, model: true, stockage: true } })
    return p ? [p.model.toLowerCase().startsWith(p.marque.toLowerCase()) ? p.model : `${p.marque} ${p.model}`, p.stockage].filter(Boolean).join(' ') : id
  }
  if (type === 'accessoire') return (await prisma.accessories.findUnique({ where: { acc_id: id }, select: { nom: true } }))?.nom ?? id
  return id
}

interface ClosedCaisse {
  date: Date
  ouverture: unknown
  solde_theorique: unknown
  solde_reel: unknown
  ecart: unknown
  total_depenses: unknown
  total_fournisseurs: unknown
  payment_breakdown: unknown
}

/** The day in a few lines, sent when its caisse is closed. */
export async function closingReport(storeId: string, caisse: ClosedCaisse, closedBy: string) {
  const iso = caisse.date.toISOString().slice(0, 10)
  const fin = await financials(storeId, utc(iso), utc(iso))
  const t = fin.totals
  const qty = (group: string) => fin.categories.filter(c => c.group === group).reduce((s, c) => s + c.qty, 0)
  const pb = (caisse.payment_breakdown ?? {}) as Record<string, number>
  const returns = fin.journal?.returns ?? []
  const ecart = Number(caisse.ecart ?? 0)
  const top = fin.phones.slice(0, 3).map(p => `${p.name}${p.qty > 1 ? ` ×${p.qty}` : ''}`).join(', ')
  const out = [
    Number(caisse.total_depenses) > 0 ? `${dh(caisse.total_depenses)} de dépenses` : null,
    Number(caisse.total_fournisseurs) > 0 ? `${dh(caisse.total_fournisseurs)} aux fournisseurs` : null,
  ].filter(Boolean).join(' · ')

  const lines = [
    `📊 Bilan du ${dayOf(iso)}`,
    `Ventes : ${t.tickets} (${plural(qty('telephones'), 'téléphone', 'téléphones')}, ${plural(qty('accessoires'), 'accessoire', 'accessoires')}) — ${dh(t.revenue)}`,
    `Bénéfice brut : ${dh(t.gross)} · net : ${dh(t.net)}`,
    top ? `Téléphones vendus : ${top}` : null,
    `Encaissé : ${dh(pb.cash)} espèces · ${dh(pb.transfer)} virement${Number(pb.credit) > 0 ? ` · ${dh(pb.credit)} à crédit` : ''}`,
    out ? `Sorties du tiroir : ${out}` : null,
    returns.length ? `Retours : ${returns.length} (${dh(returns.reduce((s, r) => s + r.montant, 0))})` : null,
    t.losses > 0 ? `Pertes (The Void) : ${dh(t.losses)}` : null,
    t.missingCost > 0 ? `⚠️ ${plural(t.missingCost, 'vente sans prix d’achat', 'ventes sans prix d’achat')} : bénéfice à vérifier` : null,
    `Caisse : comptée ${dh(caisse.solde_reel)} · calculée ${dh(caisse.solde_theorique)} · écart ${ecart === 0 ? '0' : `${ecart > 0 ? '+' : ''}${dh(ecart)}`}${Math.abs(ecart) >= 50 ? ' ⚠️' : ''}`,
    `Clôturée par ${closedBy} à ${new Date().toLocaleTimeString('fr-FR', { timeZone: STORE_TIME_ZONE, hour: '2-digit', minute: '2-digit' })}`,
  ]
  return lines.filter(Boolean).join('\n')
}

/** Credit files with a payment due today or already late. */
async function creditsToChase(storeId: string, today: string) {
  const files = await prisma.phone_credit_sales.findMany({
    where:  { store_id: storeId, statut: 'en_cours', is_deleted: false },
    select: { client_name: true, montant_paye: true, echeancier_base: true, phone_credit_echeances: { select: { date_echeance: true, montant: true } } },
  })
  let dueToday = 0, dueTodayAmount = 0
  const late: { name: string; amount: number; days: number }[] = []
  for (const f of files) {
    if (!f.phone_credit_echeances.length) continue
    const s = scheduleStatus(
      f.phone_credit_echeances.map(e => ({ date_echeance: e.date_echeance.toISOString().slice(0, 10), montant: Number(e.montant) })),
      Number(f.montant_paye), Number(f.echeancier_base), today,
    )
    if (s.lateAmount > 0) late.push({ name: f.client_name, amount: s.lateAmount, days: s.daysLate })
    for (const l of s.lines) if (l.date_echeance === today && l.state !== 'payee') { dueToday++; dueTodayAmount += l.montant - l.covered }
  }
  late.sort((a, b) => b.days - a.days)
  return { dueToday, dueTodayAmount, late, lateAmount: late.reduce((s, l) => s + l.amount, 0) }
}

/** What needs doing today; null when there is nothing to say. */
export async function morningBrief(storeId: string): Promise<string | null> {
  const today = businessDate()
  const [credits, ready, overdue, noPrice, [low], openDays, web] = await Promise.all([
    creditsToChase(storeId, today),
    prisma.reparations.count({ where: { store_id: storeId, is_deleted: false, statut: 'pret' } }),
    prisma.reparations.count({ where: { store_id: storeId, is_deleted: false, statut: { in: ['en_attente', 'devis_envoye', 'en_cours'] }, date_prevue: { lt: utc(today) } } }),
    prisma.phones.count({ where: { store_id: storeId, is_deleted: false, status: 'disponible', OR: [{ prix_vente_recommande: null }, { prix_vente_recommande: { lte: 0 } }] } }),
    prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM accessories WHERE store_id = ${storeId} AND NOT is_deleted AND categorie <> 'service' AND quantite <= seuil_alerte`),
    prisma.caisse.findMany({ where: { store_id: storeId, status: 'ouverte', date: { lt: utc(today) } }, select: { date: true }, orderBy: { date: 'asc' } }),
    storefrontConfigured()
      ? Promise.all([site().orderRequest.count({ where: { status: 'NEW' } }), site().repairRequest.count({ where: { status: 'NEW' } })]).catch(() => [0, 0])
      : Promise.resolve([0, 0]),
  ])
  const lines = [
    openDays.length ? `• Caisse non clôturée : ${openDays.map(c => dayOf(c.date.toISOString().slice(0, 10))).join(', ')}` : null,
    web[0] ? `• ${plural(web[0], 'commande web attend', 'commandes web attendent')} une réponse` : null,
    web[1] ? `• ${plural(web[1], 'demande du site attend', 'demandes du site attendent')} une réponse` : null,
    credits.dueToday ? `• ${plural(credits.dueToday, 'échéance de crédit', 'échéances de crédit')} aujourd’hui (${dh(credits.dueTodayAmount)})` : null,
    credits.late.length
      ? `• ${plural(credits.late.length, 'crédit en retard', 'crédits en retard')} (${dh(credits.lateAmount)}) : ${credits.late.slice(0, 4).map(l => `${l.name} ${dh(l.amount)}, ${l.days} j`).join(' ; ')}${credits.late.length > 4 ? '…' : ''}`
      : null,
    ready ? `• ${plural(ready, 'réparation prête', 'réparations prêtes')}, pas encore récupérée${ready > 1 ? 's' : ''}` : null,
    overdue ? `• ${plural(overdue, 'réparation en retard', 'réparations en retard')} sur la date prévue` : null,
    noPrice ? `• ${plural(noPrice, 'téléphone disponible', 'téléphones disponibles')} sans prix de vente` : null,
    low?.n ? `• Stock bas : ${plural(low.n, 'accessoire', 'accessoires')}` : null,
  ].filter(Boolean)
  return lines.length ? [`☀️ À faire aujourd’hui — ${dayOf(today)}`, ...lines].join('\n') : null
}

/** Last week (Monday to Sunday) against the one before. */
export async function weeklyReport(storeId: string) {
  const today = businessDate()
  const weekday = (utc(today).getUTCDay() + 6) % 7          // Monday = 0
  const to = addDays(today, -weekday - 1), from = addDays(to, -6)
  const [fin, old, [owed], credits] = await Promise.all([
    financials(storeId, utc(from), utc(to)),
    prisma.phones.findMany({
      where:   { store_id: storeId, is_deleted: false, status: 'disponible', date_entree: { lt: utc(addDays(today, -30)) } },
      select:  { marque: true, model: true, stockage: true, date_entree: true },
      orderBy: { date_entree: 'asc' },
    }),
    prisma.$queryRaw<{ du: number; n: number }[]>(Prisma.sql`
      SELECT COALESCE(sum(ss.solde_du), 0)::float AS du, (count(*) FILTER (WHERE ss.solde_du > 0))::int AS n
      FROM suppliers_summary ss JOIN suppliers s ON s.supplier_id = ss.supplier_id
      WHERE s.type_fournisseur IS DISTINCT FROM 'D'`),
    creditsToChase(storeId, today),
  ])
  const t = fin.totals, p = fin.previous
  const vs = (cur: number, prev: number) => (prev ? ` (${cur >= prev ? '+' : ''}${Math.round(((cur - prev) / Math.abs(prev)) * 100)} %)` : '')
  const age = (d: Date | null) => (d ? Math.round((utc(today).getTime() - d.getTime()) / 86_400_000) : 0)
  const lines = [
    `🗓 Semaine du ${dayOf(from)} au ${dayOf(to)}`,
    `Chiffre d’affaires : ${dh(t.revenue)}${vs(t.revenue, p.revenue)}`,
    `Bénéfice brut : ${dh(t.gross)}${vs(t.gross, p.gross)} · net : ${dh(t.net)}${vs(t.net, p.net)}`,
    `Ventes : ${t.tickets}${vs(t.tickets, p.tickets)} · dépenses : ${dh(t.opex)}`,
    fin.phones.length ? `Les plus vendus : ${fin.phones.slice(0, 5).map(x => `${x.name} ×${x.qty}`).join(', ')}` : null,
    old.length
      ? `En stock depuis plus de 30 jours : ${plural(old.length, 'téléphone', 'téléphones')} (${old.slice(0, 3).map(x => `${x.model.toLowerCase().startsWith(x.marque.toLowerCase()) ? x.model : `${x.marque} ${x.model}`}${x.stockage ? ` ${x.stockage}` : ''}, ${age(x.date_entree)} j`).join(' ; ')}${old.length > 3 ? '…' : ''})`
      : null,
    `Dû aux fournisseurs : ${dh(owed?.du)}${owed?.n ? ` (${plural(owed.n, 'fournisseur', 'fournisseurs')})` : ''}`,
    credits.late.length ? `Crédits en retard : ${credits.late.length} (${dh(credits.lateAmount)})` : 'Crédits : aucun retard',
  ]
  return lines.filter(Boolean).join('\n')
}
