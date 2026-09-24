import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    if (!MANAGERS.includes(user.role)) {
      throw new HttpError(403, 'Seul un gérant ou propriétaire peut effectuer un retour')
    }

    const { txn_id, voided_reason } = await request.json()
    if (!txn_id || !voided_reason) throw new HttpError(400, 'txn_id et voided_reason requis')

    // Cancelling is for correcting a mistake while the sale's day is still open.
    // Anything later is a return (POS → Retour): a refund dated the day it
    // happens, so a closed caisse is never rewritten.
    const { before, after } = await prisma.$transaction(async (tx) => {
      const before = await tx.transactions.findUnique({ where: { txn_id } })
      if (before?.store_id) {
        const caisse = await tx.caisse.findFirst({ where: { store_id: before.store_id, date: before.date_vente }, select: { status: true } })
        if (caisse && caisse.status !== 'ouverte') {
          throw new HttpError(409, 'La caisse de ce jour est clôturée : faites un retour depuis le POS (bouton Retour).')
        }
      }
      if (await tx.retours.count({ where: { txn_id } })) {
        throw new HttpError(409, 'Cette vente a déjà un retour : elle ne peut plus être annulée.')
      }
      // Conditional update: a second concurrent void finds nothing to update
      const { count } = await tx.transactions.updateMany({
        where: { txn_id, voided: false },
        data:  { voided: true, voided_by: user.id, voided_at: new Date(), voided_reason, updated_by: user.id },
      })
      if (!before || count === 0) throw new HttpError(404, 'Transaction introuvable ou déjà annulée')

      // Paid with a store credit: the credit goes back to the customer
      if (before.avoir_retour_id && Number(before.avoir_montant) > 0) {
        await tx.retours.update({ where: { retour_id: before.avoir_retour_id }, data: { avoir_solde: { increment: before.avoir_montant } } })
      }

      // Put the device back in stock
      if (before.device_type === 'telephone') {
        await tx.phones.update({ where: { phone_id: before.device_id }, data: { status: 'disponible', updated_by: user.id } })
      } else if (before.device_type === 'laptop') {
        await tx.laptops.update({ where: { laptop_id: before.device_id }, data: { status: 'disponible', updated_by: user.id } })
      } else if (before.device_type === 'accessoire') {
        // Restore the quantity actually sold (a qty>1 sale decremented by qty)
        await tx.accessories.update({
          where: { acc_id: before.device_id },
          data:  { quantite: { increment: before.qty || 1 }, updated_by: user.id },
        })
      }
      const after = await tx.transactions.findUniqueOrThrow({ where: { txn_id } })
      return { before, after }
    })

    // Caisse totals aggregate live from transactions WHERE voided = false — the day is still open, so no caisse mutation needed.
    await logActivity({
      store_id:     before.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'annulation',
      module:       'transactions',
      record_id:    txn_id,
      before_state: before,
      after_state:  after,
      ip_address:   getIpFromRequest(request),
      notes:        `Retour — Motif : ${voided_reason}`,
    })

    return json({ data: after, status: 'voided' })
  } catch (err) {
    return handleError(err, 'PATCH /api/transactions/void')
  }
}

export const PATCH = withNotify(PATCH_)
