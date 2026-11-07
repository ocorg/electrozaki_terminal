import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { logActivity } from '@/lib/utils/logger'
import { countLine, gapsOf } from '@/lib/accessoryCount'

// One accessory count (owner, 2026-11-07; lib/accessoryCount).

// GET — every line: stock now vs counted (the gaps)
export async function GET(_req: NextRequest, { params }: { params: { countId: string } }) {
  try {
    await requireUser(MANAGERS)
    return json({ data: await gapsOf(prisma, params.countId) })
  } catch (err) {
    return handleError(err, 'GET /api/inventory/accessories/[countId]')
  }
}

// PATCH { acc_id, line_key, add? | set? } — a scan (+1) or a typed number
async function PATCH_(request: NextRequest, { params }: { params: { countId: string } }) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    if (typeof body.acc_id !== 'string' || typeof body.line_key !== 'string') throw new HttpError(400, 'Ligne invalide')
    const op = body.set !== undefined ? { set: Number(body.set) } : { add: body.add === undefined ? 1 : Number(body.add) }
    const data = await prisma.$transaction(tx => countLine(tx, params.countId, body.acc_id, body.line_key, op, user.id))
    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/inventory/accessories/[countId]')
  }
}

// DELETE — cancels the count, nothing changes in the stock
async function DELETE_(_req: NextRequest, { params }: { params: { countId: string } }) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { count } = await prisma.acc_counts.updateMany({ where: { count_id: params.countId, statut: 'en_cours' }, data: { statut: 'annulee', closed_at: new Date(), closed_by: user.id } })
    if (!count) throw new HttpError(409, 'Ce comptage est déjà terminé')
    await logActivity({ store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name, action_type: 'modification', module: 'inventaire', record_id: params.countId, notes: 'Comptage des accessoires annulé (stock inchangé)' })
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'DELETE /api/inventory/accessories/[countId]')
  }
}

export const PATCH = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
