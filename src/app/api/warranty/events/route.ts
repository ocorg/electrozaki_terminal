import type { warranty_event_type } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, todayDate, HttpError } from '@/lib/api'

// POST /api/warranty/events — records a SAV opening or closing on a sale.
// ouverture_sav → phone status en_reparation (in the workshop under warranty)
// cloture_sav   → phone status vendu (back with the customer)
export async function POST(request: Request) {
  try {
    const user = await requireActiveUser()
    const store_id = user.store_id ?? 'EZ-001'
    const { txn_id, facture_ref, event_type, sav_doc_id, sav_ref, notes } = await request.json() as {
      txn_id?: string; facture_ref?: string; event_type?: warranty_event_type; sav_doc_id?: string; sav_ref?: string; notes?: string
    }
    if (!txn_id || !facture_ref || !event_type) throw new HttpError(400, 'txn_id, facture_ref et event_type sont obligatoires')
    if (event_type !== 'ouverture_sav' && event_type !== 'cloture_sav') {
      throw new HttpError(400, 'event_type doit être ouverture_sav ou cloture_sav')
    }

    const data = await prisma.$transaction(async (tx) => {
      if (event_type === 'cloture_sav') {
        const existing = await tx.warranty_events.findMany({ where: { txn_id }, select: { event_type: true } })
        const openCount = existing.reduce((acc, ev) => acc + (ev.event_type === 'ouverture_sav' ? 1 : -1), 0)
        if (openCount <= 0) throw new HttpError(400, 'Aucun SAV ouvert à clôturer pour cette transaction')
      }

      const txn = await tx.transactions.findUnique({ where: { txn_id }, select: { device_id: true, device_type: true } })
      if (txn?.device_type === 'telephone') {
        await tx.phones.updateMany({
          where: { phone_id: txn.device_id },
          data:  { status: event_type === 'ouverture_sav' ? 'en_reparation' : 'vendu', updated_by: user.id },
        })
      }

      return tx.warranty_events.create({
        data: {
          store_id, txn_id, facture_ref, event_type, event_date: todayDate(),
          sav_doc_id: sav_doc_id || null, sav_ref: sav_ref || null, notes: notes || null, created_by: user.id,
        },
      })
    })

    return json({ status: 'success', data })
  } catch (err) {
    return handleError(err, 'POST /api/warranty/events')
  }
}
