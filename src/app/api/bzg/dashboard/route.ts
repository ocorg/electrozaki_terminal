import { prisma } from '@/lib/db'
import { json, handleError, requireUser, dateOnly, todayDate, HttpError, MANAGERS } from '@/lib/api'

const STORE_MAP: Record<string, string> = {
  'EZ-001': 'Electro Zaki',
}

const day = (d: Date) => d.toISOString().slice(0, 10)

export async function GET() {
  try {
    const user = await requireUser()
    if (!MANAGERS.includes(user.role)) throw new HttpError(403, 'Accès refusé')

    const today      = todayDate()
    const monthStart = dateOnly(`${day(today).slice(0, 7)}-01`)!

    const [txns, repairs, caisses, staffToday, retours] = await Promise.all([
      prisma.transactions.findMany({
        where:  { voided: false, date_vente: { gte: monthStart } },
        select: { store_id: true, prix_vente: true, date_vente: true },
      }),
      prisma.reparations.findMany({ where: { statut: { not: 'recupere' }, is_deleted: false }, select: { store_id: true } }),
      prisma.caisse.findMany({
        where:   { date: { gte: monthStart } },
        select:  { caisse_id: true, store_id: true, date: true, status: true, solde_reel: true, solde_theorique: true, ecart: true, created_by: true },
        orderBy: { date: 'desc' },
      }),
      prisma.staff_attendance.findMany({
        where:   { date: today },
        select:  { user_name: true, store_id: true, punch_type: true, punched_at: true },
        orderBy: { punched_at: 'desc' },
      }),
      // Returns refunded this month lower the sales of the day they happen
      prisma.retours.findMany({ where: { type: 'retour', date: { gte: monthStart } }, select: { store_id: true, date: true, montant: true } }),
    ])

    const snapshots = Object.keys(STORE_MAP).map(storeId => {
      const storeTxns   = txns.filter(t => t.store_id === storeId)
      const storeRets   = retours.filter(r => r.store_id === storeId)
      const refunds     = (rows: typeof storeRets) => rows.reduce((s, r) => s + Number(r.montant), 0)
      const todayCaisse = caisses.find(c => c.store_id === storeId && day(c.date) === day(today))
      return {
        store_id:       storeId,
        ca_today:       storeTxns.filter(t => day(t.date_vente) === day(today)).reduce((s, t) => s + Number(t.prix_vente), 0)
                        - refunds(storeRets.filter(r => day(r.date) === day(today))),
        ca_month:       storeTxns.reduce((s, t) => s + Number(t.prix_vente), 0) - refunds(storeRets),
        nb_ventes:      storeTxns.length,
        active_repairs: repairs.filter(r => r.store_id === storeId).length,
        caisse_status:  todayCaisse ? todayCaisse.status : 'none',
        caisse_id:      todayCaisse?.caisse_id ?? null,
      }
    })

    const pendingEOD = caisses
      .filter(c => c.status === 'en_attente_cloture')
      .map(c => ({
        caisse_id:       c.caisse_id,
        store_id:        c.store_id,
        store_name:      STORE_MAP[c.store_id ?? ''] ?? c.store_id,
        date:            c.date,
        solde_reel:      c.solde_reel,
        solde_theorique: c.solde_theorique,
        ecart:           c.ecart,
        submitted_by:    c.created_by ?? '—',
      }))

    return json({ snapshots, pendingEOD, staffToday })
  } catch (err) {
    return handleError(err, 'GET /api/bzg/dashboard')
  }
}
