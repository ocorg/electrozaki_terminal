import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

// PATCH /api/bzg/caisse/eod
// Body: { caisse_id: string, action: 'approve' | 'reject', rejection_note?: string }
async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json() as Record<string, unknown>
    const caisse_id      = body.caisse_id      as string | undefined
    const action         = body.action         as string | undefined
    const rejection_note = (body.rejection_note as string | undefined)?.trim()

    if (!caisse_id) throw new HttpError(400, 'caisse_id requis')
    if (action !== 'approve' && action !== 'reject') {
      throw new HttpError(400, 'action doit être "approve" ou "reject"')
    }
    if (action === 'reject' && (!rejection_note || rejection_note.length < 3)) {
      throw new HttpError(400, 'Motif de rejet requis (3 caractères minimum)')
    }

    const before = await prisma.caisse.findUnique({ where: { caisse_id } })
    if (!before) throw new HttpError(404, 'Caisse introuvable')
    if (before.status !== 'en_attente_cloture') {
      throw new HttpError(400, 'Cette caisse n\'est pas en attente de validation — approbation impossible')
    }

    await prisma.caisse.update({
      where: { caisse_id },
      data: action === 'approve'
        ? { status: 'cloturee', approved_by: user.id, approved_at: new Date() }
        : { status: 'ouverte', rejection_note },
    })

    await logActivity({
      user_id:     user.id,
      store_id:    before.store_id,
      user_name:   user.display_name,
      module:      'caisse',
      action_type: action === 'approve' ? 'validation_cloture' : 'rejet_cloture',
      ip_address:  getIpFromRequest(request),
      after_state: {
        caisse_id,
        action,
        date:            before.date,
        solde_reel:      before.solde_reel,
        solde_theorique: before.solde_theorique,
        ecart:           before.ecart,
        ...(rejection_note ? { rejection_note } : {}),
      },
    })

    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'PATCH /api/bzg/caisse/eod')
  }
}

export const PATCH = withNotify(PATCH_)
