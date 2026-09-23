import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

// Key/value settings per store (store_id null = global)
export async function GET() {
  try {
    const user = await requireUser()
    if (!MANAGERS.includes(user.role)) throw new HttpError(403, 'Accès refusé')
    const data = await prisma.settings.findMany({ orderBy: [{ store_id: 'asc' }, { key: 'asc' }] })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/settings')
  }
}

// PUT { key, store_id, value } — create or update one setting
export async function PUT(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { key, store_id, value } = await request.json() as { key?: string; store_id?: string | null; value?: string }
    if (!key) throw new HttpError(400, 'key requis')

    const data = await prisma.$transaction(async (tx) => {
      const existing = await tx.settings.findFirst({ where: { key, store_id: store_id ?? null } })
      return existing
        ? tx.settings.update({ where: { id: existing.id }, data: { value: value ?? null, updated_by: user.id } })
        : tx.settings.create({ data: { key, store_id: store_id ?? null, value: value ?? null, updated_by: user.id } })
    })

    await logActivity({
      store_id:    store_id ?? null,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'modification',
      module:      'parametres',
      record_id:   key,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'PUT /api/settings')
  }
}
