import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { countByResult, syncInventoryWithStock } from '@/lib/inventory'
import { withNotify } from '@/lib/realtime'

async function PATCH_(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const session = await prisma.inventory_sessions.findFirst({
      where: { session_id: params.id, ...(user.store_id && { store_id: user.store_id }) },
    })
    if (!session) throw new HttpError(404, 'Session introuvable')
    if (session.statut !== 'en_cours') throw new HttpError(409, 'Session déjà terminée')

    // Last look at the stock: what left or came in during the count is settled first
    await syncInventoryWithStock(session.session_id, session.store_id)

    const { closedSession, counts } = await prisma.$transaction(async (tx) => {
      // Everything never scanned is missing
      await tx.inventory_session_items.updateMany({
        where: { session_id: params.id, resultat: 'en_attente' },
        data:  { resultat: 'manquant' },
      })
      const closedSession = await tx.inventory_sessions.update({
        where: { session_id: params.id },
        data:  { statut: 'terminee', completed_at: new Date() },
      })
      const items = await tx.inventory_session_items.findMany({ where: { session_id: params.id }, select: { resultat: true } })
      return { closedSession, counts: countByResult(items) }
    })

    await logActivity({
      user_id:     user.id,
      store_id:    user.store_id,
      user_name:   user.display_name,
      module:      'inventaire',
      action_type: 'modification',
      record_id:   params.id,
      ip_address:  getIpFromRequest(req),
      after_state: { session_id: params.id, counts },
    })

    return json({ session: closedSession, counts })
  } catch (err) {
    return handleError(err, 'PATCH /api/inventory/[id]/close')
  }
}

export const PATCH = withNotify(PATCH_)
