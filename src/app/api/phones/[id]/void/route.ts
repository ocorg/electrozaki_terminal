import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { liveSale } from '@/lib/phoneExit'

// "The Void" (owner, 2026-10-04): a phone that left the stock with no sale to
// record — sold but nobody remembers to whom or when, or taken apart for
// parts. Managers, with a reason. Its purchase price is a loss in the
// figures and its supplier is still owed.
//   POST   { motif }  → into The Void
//   DELETE            → back to "disponible"
async function POST_(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await req.json().catch(() => ({})) as { motif?: string }
    const motif = String(body.motif ?? '').trim()
    if (motif.length < 3) throw new HttpError(400, 'Indiquez le motif (vendu sans trace, démonté pour pièces…)')

    const { before, data } = await prisma.$transaction(async (tx) => {
      const before = await tx.phones.findFirst({ where: { phone_id: params.id, is_deleted: false } })
      if (!before) throw new HttpError(404, 'Téléphone introuvable')
      if (before.status === 'void') throw new HttpError(400, 'Ce téléphone est déjà dans The Void')
      const live = await liveSale(tx, before.phone_id, before.status)
      if (live) throw new HttpError(400, `Ce téléphone a ${live.kind === 'vente' ? 'une vente' : 'un dossier'} (${live.ref}) : il est déjà sorti du stock normalement`)
      const data = await tx.phones.update({
        where: { phone_id: before.phone_id },
        data:  { status: 'void', void_at: new Date(), void_by: user.id, void_motif: motif, updated_by: user.id },
      })
      return { before, data }
    })
    await logActivity({
      store_id: data.store_id, user_id: user.id, user_name: user.display_name, action_type: 'modification', module: 'telephones',
      record_id: data.phone_id, before_state: before, after_state: data, notes: `Envoyé dans The Void : ${motif}`, ip_address: getIpFromRequest(req),
    })
    return json({ data: { phone_id: data.phone_id, status: data.status } })
  } catch (err) {
    return handleError(err, 'POST /api/phones/[id]/void')
  }
}

async function DELETE_(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const before = await prisma.phones.findFirst({ where: { phone_id: params.id, is_deleted: false } })
    if (!before) throw new HttpError(404, 'Téléphone introuvable')
    if (before.status !== 'void') throw new HttpError(400, 'Ce téléphone n’est pas dans The Void')
    const data = await prisma.phones.update({
      where: { phone_id: before.phone_id },
      data:  { status: 'disponible', void_at: null, void_by: null, void_motif: null, updated_by: user.id },
    })
    await logActivity({
      store_id: data.store_id, user_id: user.id, user_name: user.display_name, action_type: 'modification', module: 'telephones',
      record_id: data.phone_id, before_state: before, after_state: data, notes: 'Sorti du Void : remis disponible', ip_address: getIpFromRequest(req),
    })
    return json({ data: { phone_id: data.phone_id, status: data.status } })
  } catch (err) {
    return handleError(err, 'DELETE /api/phones/[id]/void')
  }
}

export const POST = withNotify(POST_)
export const DELETE = withNotify(DELETE_)
