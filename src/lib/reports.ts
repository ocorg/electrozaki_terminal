// What the owner and the managers want to know without opening the ERP
// (owner, 2026-10-06), sent to the store's Telegram group:
//   • the day's summary, when the caisse is closed
//   • a morning list of what needs doing today (nothing to say = no message)
//   • a weekly summary on Monday
//   • short alerts when money moves out of the ordinary
// Figures come from the same calculations as the screens (lib/analytics, caisse).
import { Prisma } from '@prisma/client'
import { orderMoney } from '@/lib/deliveryOrders'
import { phoneMatchesProspect } from '@/lib/prospects'
import { ordersToCall, WAIT_DAYS } from '@/lib/storefront/followups'
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db'
import { financials } from '@/lib/analytics'
import { scheduleStatus } from '@/lib/creditSchedule'
import { telegram, bold } from '@/lib/siteNotify'
import { storefrontConfigured } from '@/lib/storefront/db'
import { site } from '@/lib/storefront/access'
import { businessDate, STORE_TIME_ZONE } from '@/lib/time'

// Amounts to the centime when there is one (never rounded), in bold
const dh = (v: unknown) => {
  const n = Math.round(Number(v ?? 0) * 100) / 100
  return bold(`${n.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} DH`)
}
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
    bold(`📊 Bilan du ${dayOf(iso)}`),
    `Ventes : ${bold(t.tickets)} (${plural(qty('telephones'), 'téléphone', 'téléphones')}, ${plural(qty('accessoires'), 'accessoire', 'accessoires')}) — ${dh(t.revenue)}`,
    `Bénéfice brut : ${dh(t.gross)} · net : ${dh(t.net)}`,
    top ? `Téléphones vendus : ${top}` : null,
    `Encaissé : ${dh(pb.cash)} espèces · ${dh(pb.transfer)} virement${Number(pb.credit) > 0 ? ` · ${dh(pb.credit)} à crédit` : ''}`,
    out ? `Sorties du tiroir : ${out}` : null,
    returns.length ? `Retours : ${returns.length} (${dh(returns.reduce((s, r) => s + r.montant, 0))})` : null,
    t.losses > 0 ? `Pertes (The Void) : ${dh(t.losses)}` : null,
    t.missingCost > 0 ? `⚠️ ${plural(t.missingCost, 'vente sans prix d’achat', 'ventes sans prix d’achat')} : bénéfice à vérifier` : null,
    `Caisse : comptée ${dh(caisse.solde_reel)} · calculée ${dh(caisse.solde_theorique)} · écart ${ecart === 0 ? bold('0') : `${ecart > 0 ? '+' : ''}${dh(ecart)}`}${Math.abs(ecart) >= 50 ? ' ⚠️' : ''}`,
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
  const [credits, ready, overdue, noPrice, [low], openDays, web, follow, toShip, unpaid] = await Promise.all([
    creditsToChase(storeId, today),
    prisma.reparations.count({ where: { store_id: storeId, is_deleted: false, statut: 'pret' } }),
    prisma.reparations.count({ where: { store_id: storeId, is_deleted: false, statut: { in: ['en_attente', 'devis_envoye', 'en_cours'] }, date_prevue: { lt: utc(today) } } }),
    prisma.phones.count({ where: { store_id: storeId, is_deleted: false, status: 'disponible', OR: [{ prix_vente_recommande: null }, { prix_vente_recommande: { lte: 0 } }] } }),
    prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM accessories WHERE store_id = ${storeId} AND NOT is_deleted AND categorie <> 'service' AND quantite <= seuil_alerte`),
    prisma.caisse.findMany({ where: { store_id: storeId, status: 'ouverte', date: { lt: utc(today) } }, select: { date: true }, orderBy: { date: 'asc' } }),
    storefrontConfigured()
      ? Promise.all([site().orderRequest.count({ where: { status: 'NEW' } }), site().repairRequest.count({ where: { status: 'NEW' } })]).catch(() => [0, 0])
      : Promise.resolve([0, 0]),
    // CRM: conversations to follow up today (or overdue)
    prisma.leads.count({ where: { store_id: storeId, is_deleted: false, etape: { in: ['nouveau', 'en_discussion', 'proposition', 'attente_stock'] }, relance_le: { lte: utc(today) } } }),
    // Orders to deliver still waiting for their advance or to ship
    prisma.deliveries.count({ where: { store_id: storeId, commande: true, is_deleted: false, statut: { in: ['attente_avance', 'prepare'] } } }),
    // Delivered, but the delivery company has not paid yet
    prisma.deliveries.findMany({ where: { store_id: storeId, commande: true, is_deleted: false, statut: 'livre', versement_recu_at: null }, select: { montant_total: true, montant_avance: true, frais_livraison: true, frais_charge: true } }),
  ])
  const owed = unpaid.reduce((sum, d) => sum + orderMoney(d).verse, 0)
  const lines = [
    follow ? `• ${plural(follow, 'conversation à relancer', 'conversations à relancer')} (CRM)` : null,
    toShip ? `• ${plural(toShip, 'commande à livrer attend', 'commandes à livrer attendent')} son avance ou son envoi` : null,
    unpaid.length ? `• Le transporteur doit encore verser ${dh(owed)} (${plural(unpaid.length, 'commande livrée', 'commandes livrées')})` : null,
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
  return lines.length ? [bold(`☀️ À faire aujourd’hui — ${dayOf(today)}`), ...lines].join('\n') : null
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
    bold(`🗓 Semaine du ${dayOf(from)} au ${dayOf(to)}`),
    `Chiffre d’affaires : ${dh(t.revenue)}${vs(t.revenue, p.revenue)}`,
    `Bénéfice brut : ${dh(t.gross)}${vs(t.gross, p.gross)} · net : ${dh(t.net)}${vs(t.net, p.net)}`,
    `Ventes : ${bold(t.tickets)}${vs(t.tickets, p.tickets)} · dépenses : ${dh(t.opex)}`,
    fin.phones.length ? `Les plus vendus : ${fin.phones.slice(0, 5).map(x => `${x.name} ×${x.qty}`).join(', ')}` : null,
    old.length
      ? `En stock depuis plus de 30 jours : ${plural(old.length, 'téléphone', 'téléphones')} (${old.slice(0, 3).map(x => `${x.model.toLowerCase().startsWith(x.marque.toLowerCase()) ? x.model : `${x.marque} ${x.model}`}${x.stockage ? ` ${x.stockage}` : ''}, ${age(x.date_entree)} j`).join(' ; ')}${old.length > 3 ? '…' : ''})`
      : null,
    `Dû aux fournisseurs : ${dh(owed?.du)}${owed?.n ? ` (${plural(owed.n, 'fournisseur', 'fournisseurs')})` : ''}`,
    credits.late.length ? `Crédits en retard : ${credits.late.length} (${dh(credits.lateAmount)})` : 'Crédits : aucun retard',
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * A phone comes into stock: the CRM leads still open that it fits (same
 * matching rules as the screens), so they are contacted. Null when nobody waits.
 */
export async function waitingFor(phone: { phone_id: string; store_id: string | null; marque: string; model: string; stockage: string | null; prix_vente_recommande: Prisma.Decimal | null; promo_type: string | null; promo_montant: Prisma.Decimal | null }): Promise<string | null> {
  if (!phone.store_id) return null
  const leads = await prisma.leads.findMany({
    where:  { store_id: phone.store_id, is_deleted: false, etape: { in: ['nouveau', 'en_discussion', 'proposition', 'attente_stock'] }, type_demande: { in: ['achat', 'reprise'] }, NOT: { cherche: 'accessoire' } },
    select: { lead_id: true, nom: true, pseudo: true, telephone: true, canal: true, marque: true, model: true, stockage: true, budget_min: true, budget_max: true },
  })
  const priced = {
    marque: phone.marque, model: phone.model, stockage: phone.stockage,
    prix_vente_recommande: phone.prix_vente_recommande == null ? null : Number(phone.prix_vente_recommande),
    promo_type: phone.promo_type as 'valeur' | 'pourcentage' | null, promo_montant: phone.promo_montant == null ? null : Number(phone.promo_montant),
  }
  const hits = leads.filter(l => phoneMatchesProspect({ ...l, budget_min: l.budget_min == null ? null : Number(l.budget_min), budget_max: l.budget_max == null ? null : Number(l.budget_max) }, priced))
  if (!hits.length) return null
  const who = hits.slice(0, 6).map(l => `${l.nom ?? (l.pseudo ? '@' + l.pseudo : l.telephone ?? l.lead_id)} (${l.lead_id})`).join(', ')
  return `🔔 Arrivé en stock : ${await deviceName('telephone', phone.phone_id)}${priced.prix_vente_recommande ? ` à ${dh(priced.prix_vente_recommande)}` : ''}\n`
    + `${plural(hits.length, 'personne l’attend', 'personnes l’attendent')} dans le CRM : ${who}${hits.length > 6 ? '…' : ''}`
}

/**
 * 11 am (owner, 2026-10-18): the parcels to get ready before the delivery
 * company comes to collect. Ready to go = the order is prepared (its advance
 * is in, or accessories only); waiting for the advance = do not send yet.
 * Null when nothing is pending.
 */
export async function deliveriesToPrepare(storeId: string): Promise<string | null> {
  const pending = await prisma.deliveries.findMany({
    where:   { store_id: storeId, is_deleted: false, statut: { in: ['confirmation_en_cours', 'attente_avance', 'prepare'] } },
    include: { delivery_items: { select: { device_type: true, device_id: true, qty: true } } },
    orderBy: { created_at: 'asc' },
  })
  if (!pending.length) return null
  const line = async (d: (typeof pending)[number]) => {
    const what = await Promise.all(d.delivery_items.map(async i => `${await deviceName(i.device_type, i.device_id)}${i.qty > 1 ? ` ×${i.qty}` : ''}`))
    const cash = d.commande ? orderMoney(d).aEncaisser : Number(d.montant_restant ?? 0)
    return `• ${d.delivery_id} — ${d.client_name}${d.ville ? `, ${d.ville}` : ''}${d.transporteur ? ` (${d.transporteur})` : ''}\n   ${what.join(', ') || '—'} · à encaisser ${dh(cash)}`
  }
  const ready   = pending.filter(d => d.statut === 'prepare')
  const waiting = pending.filter(d => d.statut !== 'prepare')
  return [
    bold(`📦 Colis à préparer — ${dayOf(businessDate())}`),
    ready.length ? `${plural(ready.length, 'colis prêt à partir', 'colis prêts à partir')} :\n${(await Promise.all(ready.map(line))).join('\n')}` : 'Aucun colis prêt à partir.',
    waiting.length ? `\n⏳ ${plural(waiting.length, 'commande attend', 'commandes attendent')} son avance (ne pas envoyer) :\n${(await Promise.all(waiting.map(line))).join('\n')}` : null,
    ready.length ? '\nUne fois remis au transporteur : Livraisons → « En route ».' : null,
  ].filter(Boolean).join('\n')
}

/** 11 am, with the parcels: website customers to call back today (lib/storefront/followups). Null when none. */
export async function webOrdersToCall(): Promise<string | null> {
  const orders = await ordersToCall()
  if (!orders.length) return null
  const why = {
    promesse: (o: (typeof orders)[number]) => `date promise dépassée (${o.deliveryEstimate ? o.deliveryEstimate.toISOString().slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '?'}) : prévenez-le`,
    attente:  (o: (typeof orders)[number]) => `commandée il y a ${o.days} j, pas encore partie : dites-lui quand`,
    rappel:   (o: (typeof orders)[number]) => `à rappeler${o.followup?.note ? ` : « ${o.followup.note} »` : ''}`,
  }
  const lines = orders.map(o => {
    const what = o.items.filter(i => !i.isGift).map(i => `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.productNameSnapshot}`).join(', ')
    return `• #${o.ref} — ${o.customerName} ${o.customerPhone}${o.deliveryCity ? `, ${o.deliveryCity}` : ''}
   ${what || '—'} · ${why[o.reason!](o)}`
  })
  return [bold(`📞 Clients du site à rappeler (${orders.length})`), ...lines,
    `(Commandes de ${WAIT_DAYS} jours ou plus pas encore parties, dates promises dépassées et rappels notés — Commandes web → « À rappeler ».)`].join('\n')
}
