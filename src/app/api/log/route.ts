import { NextRequest } from 'next/server'
import type { log_action, log_module } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, dateOnly, HttpError, MANAGERS } from '@/lib/api'

// GET /api/log — activity log (manager/owner only)
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!MANAGERS.includes(user.role)) throw new HttpError(403, 'Accès refusé')

    const { searchParams } = new URL(request.url)
    const store_id    = searchParams.get('store_id')
    const user_id     = searchParams.get('user_id')
    const module      = searchParams.get('module') as log_module | null
    const action_type = searchParams.get('action_type') as log_action | null
    const date_from   = searchParams.get('date_from')
    const date_to     = searchParams.get('date_to')
    const limit       = Math.min(Number(searchParams.get('limit') || 100), 1000)

    const to = date_to ? new Date(dateOnly(date_to)!.getTime() + 86_400_000 - 1) : undefined
    const data = await prisma.activity_log.findMany({
      where: {
        ...(store_id    && { store_id }),
        ...(user_id     && { user_id }),
        ...(module      && { module }),
        ...(action_type && { action_type }),
        ...((date_from || to) && { created_at: { gte: dateOnly(date_from), lte: to } }),
      },
      orderBy: { created_at: 'desc' },
      take:    limit,
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/log')
  }
}
