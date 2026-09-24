import { NextRequest } from 'next/server'
import type { Prisma, retour_destination, retour_mode } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, dateOnly, todayDate, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { codeLabel } from '@/lib/codes'
import { deviceLabels } from '@/lib/device-labels'
import { saleBalance, unpaidSale, assertDrawerOpen, lockSale } from '@/lib/retours'

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v))

// GET ?store_id=&q=&from=&to= — sales that can be returned, from the whole
// history: by sale number, client name or phone, product (name, model, IMEI)
// and/or date range. Without a search: the latest sales.
export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const q        = (searchParams.get('q') ?? '').trim().slice(0, 80)
    const from     = dateOnly(searchParams.get('from'))
    const to       = dateOnly(searchParams.get('to'))
    if (!store_id) throw new HttpError(400, 'store_id requis')

    const or: Prisma.transactionsWhereInput[] = []
    if (q) {
      const words  = q.split(/\s+/).filter(Boolean).slice(0, 5)
      const digits = q.replace(/\D/g, '')
      // Every word must be found in one of the fields ("iphone 13 noir").
      const every  = (fields: string[]) => ({ AND: words.map(w => ({ OR: fields.map(f => ({ [f]: { contains: w, mode: 'insensitive' } })) })) })
      const [clients, phones, accessories, laptops] = await Promise.all([
        prisma.clients.findMany({
          where: { OR: [every(['nom']), ...(digits.length >= 4 ? [{ telephone: { contains: digits } }] : [])] },
          select: { client_id: true }, take: 100,
        }),
        prisma.phones.findMany({
          where: { OR: [every(['marque', 'model', 'serie', 'couleur', 'stockage']), ...(digits.length >= 4 ? [{ imei: { contains: digits } }] : [])] },
          select: { phone_id: true }, take: 200,
        }),
        prisma.accessories.findMany({ where: every(['nom', 'marque', 'categorie']), select: { acc_id: true }, take: 200 }),
        prisma.laptops.findMany({ where: every(['marque', 'model']), select: { laptop_id: true }, take: 100 }),
      ])
      or.push({ txn_id: { contains: q.toUpperCase().replace(/\s+/g, '') } })
      if (clients.length) or.push({ client_id: { in: clients.map(c => c.client_id) } })
      const deviceIds = [...phones.map(p => p.phone_id), ...accessories.map(a => a.acc_id), ...laptops.map(l => l.laptop_id)]
      if (deviceIds.length) or.push({ device_id: { in: deviceIds } })
    }

    const rows = await prisma.transactions.findMany({
      where: {
        store_id,
        voided: false,
        NOT: { type_operation: 'retour' },
        ...((from || to) && { date_vente: { gte: from, lte: to } }),
        ...(or.length && { OR: or }),
      },
      include: { clients: { select: { nom: true, telephone: true } } },
      orderBy: { created_at: 'desc' },
      take: 40,
    })

    const [labels, returned] = await Promise.all([
      deviceLabels(rows),
      prisma.retours.groupBy({
        by:    ['txn_id'],
        where: { txn_id: { in: rows.map(r => r.txn_id) }, type: 'retour' },
        _sum:  { qty: true, montant: true },
      }),
    ])
    const back = new Map(returned.map(r => [r.txn_id, r._sum]))

    return json({
      data: rows.map(r => ({
        txn_id:          r.txn_id,
        date_vente:      r.date_vente,
        device_type:     r.device_type,
        device_id:       r.device_id,
        device_label:    labels.get(r.device_id) ?? r.device_id,
        client:          r.clients,
        qty:             r.qty,
        prix_vente:      num(r.prix_vente),
        payment_method:  r.payment_method,
        warranty_expiry: r.warranty_expiry,
        returned_qty:    back.get(r.txn_id)?.qty ?? 0,
        refunded:        num(back.get(r.txn_id)?.montant),
        unpaid:          unpaidSale(r),
      })),
    })
  } catch (err) {
    return handleError(err, 'GET /api/retours')
  }
}

const MODES: retour_mode[]               = ['especes', 'virement', 'avoir']
const DESTINATIONS: retour_destination[] = ['stock', 'reparation', 'defectueux']

// POST — record a return: { txn_id, qty, montant, mode, destination, motif }.
// Managers only. The sale stays as it was; the refund is dated today.
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const txn_id      = String(body.txn_id ?? '')
    const qty         = Number(body.qty)
    const montant     = Math.round(Number(body.montant) * 100) / 100
    const mode        = body.mode as retour_mode
    const destination = body.destination as retour_destination
    const motif       = String(body.motif ?? '').trim()

    if (!txn_id) throw new HttpError(400, 'Vente manquante')
    if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, 'Quantité invalide')
    if (!Number.isFinite(montant) || montant < 0) throw new HttpError(400, 'Montant invalide')
    if (!MODES.includes(mode)) throw new HttpError(400, 'Mode de remboursement invalide')
    if (!DESTINATIONS.includes(destination)) throw new HttpError(400, 'Destination invalide')
    if (motif.length < 3) throw new HttpError(400, 'Motif du retour obligatoire')

    const retour = await prisma.$transaction(async tx => {
      await lockSale(tx, txn_id)
      const sale = await tx.transactions.findUnique({ where: { txn_id } })
      if (!sale || sale.voided || sale.type_operation === 'retour') throw new HttpError(404, 'Vente introuvable')
      if (unpaidSale(sale)) {
        throw new HttpError(409, 'Vente à crédit ou avec avance non soldée : le retour se règle avec le propriétaire (module Crédits).')
      }
      if (sale.device_type === 'accessoire' && destination === 'reparation') throw new HttpError(400, 'Un accessoire ne part pas en réparation')
      if (sale.device_type === 'laptop' && destination === 'defectueux') throw new HttpError(400, 'Pour un ordinateur : remis en vente ou en réparation')
      // A phone or laptop is a single unit: if it was sold again since, this
      // sale can't bring it back (it belongs to the new customer).
      if (sale.device_type !== 'accessoire') {
        const latest = await tx.transactions.findFirst({
          where:   { device_id: sale.device_id, voided: false, NOT: { type_operation: 'retour' } },
          orderBy: { created_at: 'desc' },
          select:  { txn_id: true },
        })
        if (latest && latest.txn_id !== sale.txn_id) {
          throw new HttpError(409, `Cet appareil a été revendu depuis (${latest.txn_id}) : faites le retour sur la dernière vente.`)
        }
      }

      const { returnedQty, refunded } = await saleBalance(tx, txn_id)
      const leftQty = sale.qty - returnedQty
      if (leftQty <= 0) throw new HttpError(409, 'Cette vente a déjà été entièrement retournée')
      if (qty > leftQty) throw new HttpError(400, `Il ne reste que ${leftQty} article(s) à retourner sur cette vente`)
      const leftMoney = Math.round((num(sale.prix_vente) - refunded) * 100) / 100
      if (montant > leftMoney) throw new HttpError(400, `Le remboursement ne peut pas dépasser ${leftMoney} DH pour cette vente`)
      if (mode === 'especes') await assertDrawerOpen(tx, sale.store_id)

      const created = await tx.retours.create({
        data: {
          type: 'retour', txn_id, store_id: sale.store_id, date: todayDate(), qty, montant, mode, destination, motif,
          avoir_solde: mode === 'avoir' ? montant : 0,
          created_by:  user.id,
        },
      })

      // Where the item goes
      const note = `Retour ${created.retour_id} : ${motif}`.slice(0, 500)
      if (sale.device_type === 'telephone') {
        await tx.phones.update({
          where: { phone_id: sale.device_id },
          data:  destination === 'reparation'
            ? { status: 'en_reparation', updated_by: user.id }
            : destination === 'defectueux'
              // Sellable as-is, flagged (badge in Téléphones, kept off the website)
              ? { status: 'disponible', is_damaged: true, damage_notes: note, updated_by: user.id }
              : { status: 'disponible', updated_by: user.id },
        })
      } else if (sale.device_type === 'laptop') {
        await tx.laptops.update({
          where: { laptop_id: sale.device_id },
          data:  { status: destination === 'reparation' ? 'en_reparation' : 'disponible', updated_by: user.id },
        })
      } else if (sale.device_type === 'accessoire' && destination === 'stock') {
        await tx.accessories.update({ where: { acc_id: sale.device_id }, data: { quantite: { increment: qty }, updated_by: user.id } })
      }
      // accessoire + défectueux: not put back in stock (written off)
      return { created, sale }
    })

    await logActivity({
      store_id:    retour.sale.store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'transactions',
      record_id:   retour.created.retour_id,
      after_state: retour.created,
      ip_address:  getIpFromRequest(request),
      notes: `Retour de ${retour.sale.txn_id} — ${qty} article(s), ${montant} DH en ${codeLabel('retour_mode', mode, 'fr')}, `
           + `${codeLabel('retour_destination', destination, 'fr')} — Motif : ${motif}`,
    })

    return json({ data: retour.created }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/retours')
  }
}

export const POST = withNotify(POST_)
