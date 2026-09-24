import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, requireFields, dateOnly, todayDate, HttpError, isManager } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { codeLabel } from '@/lib/codes'
import { computeStatutPaiement } from '@/lib/utils'
import { withNotify } from '@/lib/realtime'
import { deviceLabels } from '@/lib/device-labels'

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()
    const { searchParams } = new URL(request.url)
    const client_id      = searchParams.get('client_id')
    // Staff see a client's own purchases (Clients screen), not the shop's sales list
    if (!isManager(user.role) && !client_id) throw new HttpError(403, 'Réservé aux gérants')
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

const str  = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v))
const nums = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v))

async function POST_(request: NextRequest) {
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

    // Part paid with a store credit (avoir) from a return
    const avoirMontant = Math.round((Number(body.avoir_montant) || 0) * 100) / 100
    const avoirId      = str(body.avoir_retour_id)
    if (avoirMontant < 0) throw new HttpError(400, 'Avoir invalide')
    if (avoirMontant > 0) {
      if (!avoirId) throw new HttpError(400, 'Avoir manquant')
      if (body.payment_method === 'credit') throw new HttpError(400, 'Un avoir ne peut pas servir pour une vente à crédit')
      if (avoirMontant > Number(body.prix_vente)) throw new HttpError(400, "L'avoir dépasse le prix de l'article")
    }

    // One sale = one database transaction: the row, the device status and the stock
    // change either all happen or none do.
    const data = await prisma.$transaction(async (tx) => {
      if (avoirMontant > 0) {
        // Conditional decrement: the same credit can't be spent twice.
        const { count } = await tx.retours.updateMany({
          where: { retour_id: avoirId!, type: 'retour', mode: 'avoir', avoir_solde: { gte: avoirMontant } },
          data:  { avoir_solde: { decrement: avoirMontant } },
        })
        if (count === 0) throw new HttpError(409, 'Avoir introuvable ou solde insuffisant')
      }
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
          avoir_montant:         avoirMontant,
          avoir_retour_id:       avoirMontant > 0 ? avoirId : null,
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

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/transactions')
  }
}

export const POST = withNotify(POST_)
