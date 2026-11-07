import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { addCode, cleanCode, articleShortCode } from '@/lib/accessoryCodes'

// The codes that find one accessory (owner, 2026-11-07; lib/accessoryCodes).
// Everyone who receives stock may add one (scanning boxes); removing is a manager's.

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser()
    const codes = await prisma.accessory_codes.findMany({ where: { acc_id: params.id }, orderBy: { created_at: 'asc' }, select: { code: true, variant_id: true, created_at: true } })
    return json({ data: { codes, short: articleShortCode(params.id) } })
  } catch (err) {
    return handleError(err, 'GET /api/accessories/[id]/codes')
  }
}

// POST { code, variant_id? }
async function POST_(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    const acc = await prisma.accessories.findUnique({ where: { acc_id: params.id }, select: { acc_id: true, nom: true, store_id: true, is_deleted: true } })
    if (!acc || acc.is_deleted) throw new HttpError(404, 'Accessoire introuvable')
    const variantId = typeof body.variant_id === 'string' && body.variant_id ? body.variant_id : null
    const r = await prisma.$transaction(tx => addCode(tx, acc.acc_id, body.code, variantId, user.id))
    if (r.added || r.moved) await logActivity({
      store_id: acc.store_id, user_id: user.id, user_name: user.display_name, action_type: 'modification', module: 'accessoires',
      record_id: acc.acc_id, notes: `Code ${r.code} ${r.moved ? 'déplacé' : 'associé'} à « ${acc.nom} »${variantId ? ` (variante ${variantId})` : ''}`,
      ip_address: getIpFromRequest(request),
    })
    return json({ ok: true, data: r }, { status: r.added ? 201 : 200 })
  } catch (err) {
    return handleError(err, 'POST /api/accessories/[id]/codes')
  }
}

// DELETE { code }
async function DELETE_(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const code = cleanCode((await request.json()).code)
    const { count } = await prisma.accessory_codes.deleteMany({ where: { code, acc_id: params.id } })
    if (!count) throw new HttpError(404, 'Code introuvable sur cet article')
    await logActivity({ store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name, action_type: 'modification', module: 'accessoires', record_id: params.id, notes: `Code ${code} retiré`, ip_address: getIpFromRequest(request) })
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'DELETE /api/accessories/[id]/codes')
  }
}

export const POST = withNotify(POST_)
export const DELETE = withNotify(DELETE_)
