import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, dateOnly, HttpError, MANAGERS } from '@/lib/api'

// GET /api/dashboard?store_id=&start=YYYY-MM-DD&end=YYYY-MM-DD
// Everything the store dashboard needs, in one round trip. Purchase costs
// (for profit figures) are only included for managers/owners.
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const start    = dateOnly(searchParams.get('start'))
    const end      = dateOnly(searchParams.get('end'))
    if (!store_id || !start || !end) throw new HttpError(400, 'store_id, start et end requis')

    const txnSelect = {
      txn_id: true, device_id: true, device_type: true, type_operation: true, prix_vente: true,
      avance: true, valeur_echange: true, payment_method: true, date_vente: true,
    } as const

    const [periodTxns, recent, repairs, accessories, credits, expenses, retours] = await Promise.all([
      prisma.transactions.findMany({ where: { store_id, voided: false, date_vente: { gte: start, lte: end } }, select: txnSelect }),
      prisma.transactions.findMany({
        where:   { store_id, voided: false },
        select:  { ...txnSelect, clients: { select: { nom: true } } },
        orderBy: { created_at: 'desc' },
        take:    8,
      }),
      prisma.reparations.findMany({ where: { store_id, statut: { not: 'recupere' }, is_deleted: false }, select: { rep_id: true, statut: true } }),
      prisma.accessories.findMany({ where: { store_id, is_deleted: false }, select: { acc_id: true, nom: true, quantite: true, seuil_alerte: true } }),
      // Open credits: partial advances and deferred sales
      prisma.transactions.findMany({
        where:  { store_id, voided: false, OR: [{ avance: { gt: 0 } }, { payment_method: 'credit' }] },
        select: { txn_id: true, prix_vente: true, avance: true, valeur_echange: true, payment_method: true },
      }),
      prisma.expenses.findMany({ where: { store_id, is_deleted: false, date: { gte: start, lte: end } }, select: { montant: true, date: true } }),
      // Returns refunded in the period (dated the day of the refund)
      prisma.retours.findMany({
        where:  { store_id, type: 'retour', date: { gte: start, lte: end } },
        select: { date: true, montant: true, qty: true, destination: true, sale: { select: { device_id: true, device_type: true } } },
      }),
    ])
    const returns = retours.map(r => ({
      date: r.date, montant: Number(r.montant), qty: r.qty, destination: r.destination,
      device_id: r.sale.device_id, device_type: r.sale.device_type,
    }))

    const costMap: Record<string, number> = {}
    if (MANAGERS.includes(user.role) && (periodTxns.length || returns.length)) {
      const all = [...periodTxns, ...returns]
      const ids = (type: string) => Array.from(new Set(all.filter(t => t.device_type === type).map(t => t.device_id)))
      const [phones, accs, laptops] = await Promise.all([
        prisma.phones.findMany({ where: { phone_id: { in: ids('telephone') } }, select: { phone_id: true, prix_achat: true } }),
        prisma.accessories.findMany({ where: { acc_id: { in: ids('accessoire') } }, select: { acc_id: true, prix_achat: true } }),
        prisma.laptops.findMany({ where: { laptop_id: { in: ids('laptop') } }, select: { laptop_id: true, prix_achat: true } }),
      ])
      for (const p of phones)  costMap[p.phone_id]  = Number(p.prix_achat ?? 0)
      for (const a of accs)    costMap[a.acc_id]    = Number(a.prix_achat ?? 0)
      for (const l of laptops) costMap[l.laptop_id] = Number(l.prix_achat ?? 0)
    }

    return json({ periodTxns, recent, repairs, accessories, credits, expenses, returns, costMap })
  } catch (err) {
    return handleError(err, 'GET /api/dashboard')
  }
}
