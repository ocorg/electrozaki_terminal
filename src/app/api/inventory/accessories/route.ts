import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { logActivity } from '@/lib/utils/logger'
import { openCount } from '@/lib/accessoryCount'

// The accessory count of the store (owner, 2026-11-07; lib/accessoryCount).
// Inventaire is a managers' screen.

// GET ?store_id= — the open count with its counted lines, or null
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(MANAGERS)
    const storeId = new URL(request.url).searchParams.get('store_id') || user.store_id || 'EZ-001'
    return json({ data: await openCount(prisma, storeId) })
  } catch (err) {
    return handleError(err, 'GET /api/inventory/accessories')
  }
}

// POST { store_id, categories: [] } — starts a count (one open at a time)
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const storeId = typeof body.store_id === 'string' && body.store_id ? body.store_id : user.store_id ?? 'EZ-001'
    const categories = Array.isArray(body.categories) ? body.categories.filter((c: unknown): c is string => typeof c === 'string').slice(0, 50) : []
    if (await openCount(prisma, storeId)) throw new HttpError(409, 'Un comptage est déjà en cours')
    const data = await prisma.acc_counts.create({ data: { store_id: storeId, categories, created_by: user.id } })
    await logActivity({ store_id: storeId, user_id: user.id, user_name: user.display_name, action_type: 'creation', module: 'inventaire', record_id: data.count_id, notes: `Comptage des accessoires commencé${categories.length ? ` (${categories.join(', ')})` : ' (tous les types)'}` })
    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/inventory/accessories')
  }
}

export const POST = withNotify(POST_)
