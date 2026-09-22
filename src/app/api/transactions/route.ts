import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, requireFields, dateOnly, todayDate } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { notifyCaisseChange } from '@/lib/realtime'
import { codeLabel } from '@/lib/codes'
import { computeStatutPaiement } from '@/lib/utils'

export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const client_id      = searchParams.get('client_id')
    const store_id       = searchParams.get('store_id')
    const limit          = Math.min(Number(searchParams.get('limit') || 50), 1000)
    const date_from      = searchParams.get('date_from')
    const date_to        = searchParams.get('date_to')
    const type_operation = searchParams.get('type_operation') as Prisma.transactionsWhereInput['type_operation']
    const include_voided = searchParams.get('include_voided') === 'true'

    const rows = await prisma.transactions.findMany({
      where: {
        ...(client_id && { client_id }),
        ...(store_id  && { store_id }),
        ...(!include_voided && { voided: false }),
        ...((date_from || date_to) && { date_vente: { gte: dateOnly(date_from), lte: dateOnly(date_to) } }),
        ...(type_operation && { type_operation }),
      },
      include: { clients: { select: { nom: true, telephone: true } } },
      orderBy: { created_at: 'desc' },
      take:    limit,
    })

    const labels = searchParams.get('with_device') ? await deviceLabels(rows) : null

    const data = rows.map(t => {
      const avance = Number(t.avance ?? 0)
      const fariq =
        t.payment_method === 'echange' ? 0
        : t.payment_method === 'credit' || avance > 0
          ? Math.max(0, Number(t.prix_vente) - avance - Number(t.valeur_echange ?? 0))
          : 0
      return {
        ...t,
        fariq,
        statut_paiement: computeStatutPaiement(fariq),
        ...(labels && { device_label: labels.get(t.device_id) ?? t.device_id }),
      }
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/transactions')
  }
}

// "Apple iPhone 13 128Go · Noir" / "Chargeur · Oraimo" — one query per device type
async function deviceLabels(rows: { device_type: string; device_id: string }[]) {
  const ids = (type: string) => rows.filter(r => r.device_type === type).map(r => r.device_id)
  const [phones, accessories, laptops] = await Promise.all([
    prisma.phones.findMany({ where: { phone_id: { in: ids('telephone') } }, select: { phone_id: true, marque: true, model: true, stockage: true, couleur: true } }),
    prisma.accessories.findMany({ where: { acc_id: { in: ids('accessoire') } }, select: { acc_id: true, nom: true, marque: true } }),
    prisma.laptops.findMany({ where: { laptop_id: { in: ids('laptop') } }, select: { laptop_id: true, marque: true, model: true, stockage: true } }),
  ])
  const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' ')
  const labels = new Map<string, string>()
  for (const p of phones)      labels.set(p.phone_id,  join([p.marque, p.model, p.stockage, p.couleur && `· ${p.couleur}`]))
  for (const a of accessories) labels.set(a.acc_id,    join([a.nom, a.marque && `· ${a.marque}`]))
  for (const l of laptops)     labels.set(l.laptop_id, join([l.marque, l.model, l.stockage]))
  return labels
}

const str  = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v))
const nums = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v))

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    requireFields(body, ['device_type', 'device_id', 'type_operation', 'payment_method', 'prix_vente'])

    const deviceType = body.device_type as 'telephone' | 'laptop' | 'accessoire'
    const soldQty    = Number(body.qty) || 1

    // Warranty: device's own warranty_months, 6 by default
    let warrantyMonths = 6
    if (deviceType === 'telephone') {
      const phone = await prisma.phones.findUnique({ where: { phone_id: body.device_id }, select: { warranty_months: true } })
      if (phone?.warranty_months) warrantyMonths = phone.warranty_months
    } else if (deviceType === 'laptop') {
      const laptop = await prisma.laptops.findUnique({ where: { laptop_id: body.device_id }, select: { warranty_months: true } })
      if (laptop?.warranty_months) warrantyMonths = laptop.warranty_months
    }
    const warrantyStart  = dateOnly(body.warranty_start) ?? todayDate()
    const warrantyExpiry = new Date(warrantyStart)
    warrantyExpiry.setUTCMonth(warrantyExpiry.getUTCMonth() + warrantyMonths)

    // One sale = one database transaction: the row, the device status and the stock
    // change either all happen or none do.
    const data = await prisma.$transaction(async (tx) => {
      const txn = await tx.transactions.create({
        data: {
          device_type:           deviceType,
          device_id:             String(body.device_id),
          client_id:             str(body.client_id),
          type_operation:        body.type_operation,
          txn_original_id:       str(body.txn_original_id),
          qty:                   soldQty,
          prix_vente:            Number(body.prix_vente),
          date_vente:            dateOnly(body.date_vente),
          avance:                nums(body.avance),
          date_avance:           dateOnly(body.date_avance),
          payment_method:        body.payment_method,
          montant_especes:       nums(body.montant_especes),
          montant_carte:         nums(body.montant_carte),
          montant_rendu:         nums(body.montant_rendu),
          payment_ref:           str(body.payment_ref),
          valeur_echange:        nums(body.valeur_echange),
          marque_echange:        str(body.marque_echange),
          model_echange:         str(body.model_echange),
          stockage_echange:      str(body.stockage_echange),
          ram_echange:           str(body.ram_echange),
          etat_batterie_echange: body.etat_batterie_echange == null ? null : Number(body.etat_batterie_echange),
          imei_echange:          str(body.imei_echange),
          description_echange:   str(body.description_echange),
          warranty_start:        warrantyStart,
          warranty_expiry:       warrantyExpiry,
          override_required:     body.override_required ?? null,
          override_by:           str(body.override_by),
          override_reason:       str(body.override_reason),
          facture_ref:           str(body.facture_ref),
          notes:                 str(body.notes),
          store_id:              body.store_id ?? user.store_id ?? null,
          created_by:            user.id,
          updated_by:            user.id,
        },
      })

      if (deviceType === 'telephone') {
        await tx.phones.update({ where: { phone_id: txn.device_id }, data: { status: 'vendu', updated_by: user.id } })
      } else if (deviceType === 'laptop') {
        await tx.laptops.update({ where: { laptop_id: txn.device_id }, data: { status: 'vendu', updated_by: user.id } })
      } else if (deviceType === 'accessoire') {
        // Atomic decrement, floored at 0 (two simultaneous sales can't lose an update)
        await tx.$executeRaw`
          UPDATE accessories SET quantite = GREATEST(quantite - ${soldQty}, 0), updated_by = ${user.id}::uuid
          WHERE acc_id = ${txn.device_id}`
      }
      return txn
    })

    await logActivity({
      store_id:    data.store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'transactions',
      record_id:   data.txn_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `${codeLabel('operation_type', data.type_operation, 'fr')} — ${codeLabel('device_type', data.device_type, 'fr')} ${data.device_id}`,
    })
    await notifyCaisseChange(data.store_id)

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/transactions')
  }
}
