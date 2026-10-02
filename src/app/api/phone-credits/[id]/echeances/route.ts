import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, dateOnly, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

// PUT /api/phone-credits/[id]/echeances — replace the payment schedule.
// body: { lines: [{ date_echeance, montant }], rebase?: boolean }
// rebase (a new plan): payments made so far don't count towards it — the
// plan covers what is left to pay from now on.
async function PUT_(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await req.json() as { lines?: unknown; rebase?: boolean }
    const raw = Array.isArray(body.lines) ? body.lines as Record<string, unknown>[] : null
    if (!raw) throw new HttpError(400, 'Lignes manquantes')
    if (raw.length > 60) throw new HttpError(400, '60 échéances au maximum')
    const lines = raw.map((l, i) => {
      const date = dateOnly(l.date_echeance)
      const montant = Math.round(Number(l.montant) * 100) / 100
      if (!date) throw new HttpError(400, `Échéance ${i + 1} : date invalide`)
      if (!(montant > 0)) throw new HttpError(400, `Échéance ${i + 1} : montant invalide`)
      return { date, montant }
    })

    const { credit, saved } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT credit_id FROM phone_credit_sales WHERE credit_id = ${params.id} FOR UPDATE`
      const credit = await tx.phone_credit_sales.findFirst({ where: { credit_id: params.id, is_deleted: false } })
      if (!credit) throw new HttpError(404, 'Crédit introuvable')
      if (credit.statut === 'annule') throw new HttpError(400, 'Ce dossier est annulé')
      if (credit.discharged_at) throw new HttpError(400, 'Dossier déjà déchargé')

      await tx.phone_credit_echeances.deleteMany({ where: { credit_id: params.id } })
      if (lines.length) {
        await tx.phone_credit_echeances.createMany({
          data: lines.map(l => ({ credit_id: params.id, date_echeance: l.date, montant: l.montant, created_by: user.id })),
        })
      }
      if (body.rebase) {
        await tx.phone_credit_sales.update({ where: { credit_id: params.id }, data: { echeancier_base: credit.montant_paye } })
      }
      const saved = await tx.phone_credit_echeances.findMany({ where: { credit_id: params.id }, orderBy: { date_echeance: 'asc' } })
      return { credit, saved }
    })

    await logActivity({
      store_id: credit.store_id, user_id: user.id, user_name: user.display_name,
      action_type: 'modification', module: 'telephones', record_id: params.id,
      after_state: { echeances: saved.map(e => ({ date: e.date_echeance, montant: Number(e.montant) })), rebase: !!body.rebase },
      notes: lines.length ? `Échéancier : ${lines.length} échéance(s)` : 'Échéancier supprimé',
      ip_address: getIpFromRequest(req),
    })
    return json({ data: saved })
  } catch (err) {
    return handleError(err, 'PUT /api/phone-credits/[id]/echeances')
  }
}

export const PUT = withNotify(PUT_)
