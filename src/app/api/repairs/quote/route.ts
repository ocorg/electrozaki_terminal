import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

// POST { rep_id, decision: 'accepte' | 'refuse' } — the customer answered the
// quote (by phone / in the shop). Online answers arrive through the website
// instead (lib/storefront/tracking.ts → pullQuoteDecisions).
//   accepté → en cours (repair goes ahead)
//   refusé  → prêt (device to hand back; adjust the price to any diagnostic fee)
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const { rep_id, decision } = await request.json()
    if (decision !== 'accepte' && decision !== 'refuse') throw new HttpError(400, 'Réponse invalide')

    const rep = await prisma.reparations.findUnique({ where: { rep_id: String(rep_id ?? '') } })
    if (!rep || rep.is_deleted) throw new HttpError(404, 'Réparation introuvable')
    if (rep.statut !== 'devis_envoye') throw new HttpError(409, "Aucun devis en attente de réponse sur ce ticket")

    const accepted = decision === 'accepte'
    const data = await prisma.reparations.update({
      where: { rep_id: rep.rep_id },
      data: {
        statut: accepted ? 'en_cours' : 'pret',
        ...(accepted ? { devis_accepte_le: new Date() } : { devis_refuse_le: new Date() }),
        updated_by: user.id,
      },
    })
    await logActivity({
      store_id: data.store_id, user_id: user.id, user_name: user.display_name,
      action_type: 'modification', module: 'reparations', record_id: data.rep_id,
      before_state: { statut: rep.statut }, after_state: { statut: data.statut },
      ip_address: getIpFromRequest(request),
      notes: accepted ? 'Devis accepté par le client' : 'Devis refusé par le client — appareil à restituer',
    })
    return json({ ok: true, data })
  } catch (err) {
    return handleError(err, 'POST /api/repairs/quote')
  }
}

export const POST = withNotify(POST_)
