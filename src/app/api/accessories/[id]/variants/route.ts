import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { listCouleurs } from '@/lib/couleurs'
import { stockOf, cleanLines, setVariants, lineLabel } from '@/lib/accessoryVariants'

// An article's stock per variant (owner, 2026-11-06; rules in lib/accessoryVariants).
// Everyone who counts stock may set it, like the article's quantity.

// GET — the variants, their sum and the non réparti pieces
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser()
    const s = await stockOf(prisma, params.id)
    return json({ data: s })
  } catch (err) {
    return handleError(err, 'GET /api/accessories/[id]/variants')
  }
}

// PUT { lines: [{ design, couleur, modeles: [], quantite }] } — replaces the variants (ids kept)
async function PUT_(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    const acc = await prisma.accessories.findUnique({ where: { acc_id: params.id }, select: { acc_id: true, nom: true, store_id: true, is_deleted: true } })
    if (!acc || acc.is_deleted) throw new HttpError(404, 'Accessoire introuvable')
    const colours = new Set((await listCouleurs(true)).map(c => c.nom))
    const lines = cleanLines(body.lines, colours)
    const result = await prisma.$transaction(tx => setVariants(tx, acc.acc_id, lines, user.id))
    await logActivity({
      store_id: acc.store_id, user_id: user.id, user_name: user.display_name,
      action_type: 'modification', module: 'accessoires', record_id: acc.acc_id,
      before_state: result.before, after_state: result.after,
      notes: `Stock par variante de « ${acc.nom} » : ${lines.map(l => `${lineLabel(l)} = ${l.quantite}`).join(', ') || 'aucune'}`
        + (result.added > 0 ? ` · ${result.added} pièce(s) ajoutée(s) au stock` : ''),
      ip_address: getIpFromRequest(request),
    })
    return json({ ok: true, data: result })
  } catch (err) {
    return handleError(err, 'PUT /api/accessories/[id]/variants')
  }
}

export const PUT = withNotify(PUT_)
