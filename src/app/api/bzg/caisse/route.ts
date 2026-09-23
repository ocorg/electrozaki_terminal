import { NextRequest } from 'next/server'
import type { caisse_status } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, dateOnly, HttpError, MANAGERS } from '@/lib/api'

// GET /api/bzg/caisse?store_id=&status=&date= — cash-register history across stores
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!MANAGERS.includes(user.role)) throw new HttpError(403, 'Accès refusé')

    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const status   = searchParams.get('status') as caisse_status | null
    const date     = searchParams.get('date')

    const data = await prisma.caisse.findMany({
      where: {
        ...(store_id && { store_id }),
        ...(status   && { status }),
        ...(date     && { date: dateOnly(date) }),
      },
      orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
      take:    100,
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/bzg/caisse')
  }
}
