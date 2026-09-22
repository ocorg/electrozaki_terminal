import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, HttpError, MANAGERS } from '@/lib/api'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser()
    if (!MANAGERS.includes(user.role)) throw new HttpError(403, 'Accès refusé')

    const session = await prisma.inventory_sessions.findFirst({
      where: { session_id: params.id, ...(user.store_id && { store_id: user.store_id }) },
    })
    if (!session) throw new HttpError(404, 'Session introuvable')

    const items = await prisma.inventory_session_items.findMany({
      where:   { session_id: params.id },
      orderBy: { scanned_at: { sort: 'desc', nulls: 'last' } },
    })
    return json({ session, items })
  } catch (err) {
    return handleError(err, 'GET /api/inventory/[id]')
  }
}
