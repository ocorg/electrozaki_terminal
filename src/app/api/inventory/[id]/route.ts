import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, HttpError, MANAGERS } from '@/lib/api'
import { syncInventoryWithStock } from '@/lib/inventory'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser()
    if (!MANAGERS.includes(user.role)) throw new HttpError(403, 'Accès refusé')

    let session = await prisma.inventory_sessions.findFirst({
      where: { session_id: params.id, ...(user.store_id && { store_id: user.store_id }) },
    })
    if (!session) throw new HttpError(404, 'Session introuvable')
    // An open inventory follows the live stock (sales, new phones, corrections)
    if (session.statut === 'en_cours' && await syncInventoryWithStock(session.session_id, session.store_id)) {
      session = (await prisma.inventory_sessions.findUnique({ where: { session_id: params.id } })) ?? session
    }

    const items = await prisma.inventory_session_items.findMany({
      where:   { session_id: params.id },
      orderBy: { scanned_at: { sort: 'desc', nulls: 'last' } },
    })
    return json({ session, items })
  } catch (err) {
    return handleError(err, 'GET /api/inventory/[id]')
  }
}
