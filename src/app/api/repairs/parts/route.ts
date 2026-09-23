import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const { rep_id, nom_piece, fournisseur, cout } = await request.json() as {
      rep_id: string; nom_piece: string; fournisseur?: string; cout: number
    }
    if (!rep_id || !nom_piece || cout == null) throw new HttpError(400, 'rep_id, nom_piece et cout sont requis')
    if (nom_piece.length > 200) throw new HttpError(400, 'nom_piece trop long')
    const coutNum = Number(cout)
    if (Number.isNaN(coutNum) || coutNum < 0) throw new HttpError(400, 'cout doit être un nombre positif')

    const data = await prisma.reparations_parts.create({
      data: { rep_id, description: nom_piece.trim(), fournisseur: fournisseur?.trim() ?? null, cout: coutNum, created_by: user.id },
    })

    await logActivity({
      store_id:    user.store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'pieces_reparation',
      record_id:   data.part_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `Pièce ajoutée : ${nom_piece} — ${coutNum} MAD`,
    })

    return json({ status: 'success', data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/repairs/parts')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const part_id = new URL(request.url).searchParams.get('part_id')
    if (!part_id) throw new HttpError(400, 'part_id requis')

    const before = await prisma.reparations_parts.findUnique({ where: { part_id } })
    if (!before) throw new HttpError(404, 'Pièce introuvable')
    await prisma.reparations_parts.delete({ where: { part_id } })

    await logActivity({
      store_id:     null,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'suppression',
      module:       'pieces_reparation',
      record_id:    part_id,
      before_state: before,
      ip_address:   getIpFromRequest(request),
    })

    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'DELETE /api/repairs/parts')
  }
}
