import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

// POST { rep_id, motif } — cancel a repair ticket (managers, reason required).
// Nothing is erased: the ticket is hidden from the lists and from the caisse,
// with who / when / why kept on it and in the activity log.
// Money already counted in a validated (clôturée) caisse can't be withdrawn
// this way — that day's totals would silently change.
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { rep_id, motif } = await request.json()
    const reason = typeof motif === 'string' ? motif.trim() : ''
    if (reason.length < 5) throw new HttpError(400, "Indiquez le motif de l'annulation (5 caractères minimum)")
    if (reason.length > 500) throw new HttpError(400, 'Motif trop long (500 caractères maximum)')

    const rep = await prisma.reparations.findUnique({ where: { rep_id: String(rep_id ?? '') } })
    if (!rep) throw new HttpError(404, 'Réparation introuvable')
    if (rep.is_deleted) return json({ ok: true, already: true })

    // Days on which this ticket put money in the caisse.
    const cashDays = [
      Number(rep.avance_rep ?? 0) > 0 ? rep.date_depot : null,
      rep.statut === 'recupere' && rep.date_livraison ? rep.date_livraison : null,
    ].filter((d): d is Date => d !== null)
    if (cashDays.length) {
      const closed = await prisma.caisse.findFirst({
        where:  { date: { in: cashDays }, status: 'cloturee', ...(rep.store_id && { store_id: rep.store_id }) },
        select: { date: true },
      })
      if (closed) {
        throw new HttpError(409,
          `La caisse du ${closed.date.toISOString().slice(0, 10)} est clôturée avec l'argent de ce ticket : ` +
          'annulation impossible. Enregistrez plutôt un remboursement en dépense.')
      }
    }

    const data = await prisma.reparations.update({
      where: { rep_id: rep.rep_id },
      data:  { is_deleted: true, annule_le: new Date(), annule_par: user.id, motif_annulation: reason, updated_by: user.id },
    })
    await logActivity({
      store_id: data.store_id, user_id: user.id, user_name: user.display_name,
      action_type: 'annulation', module: 'reparations', record_id: data.rep_id,
      before_state: rep, after_state: data, ip_address: getIpFromRequest(request),
      notes: `Ticket annulé — ${reason}`,
    })
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'POST /api/repairs/cancel')
  }
}

export const POST = withNotify(POST_)
