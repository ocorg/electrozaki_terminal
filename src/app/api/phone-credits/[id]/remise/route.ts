import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { requireMotif } from '@/lib/phoneCredits'
import { assertArrived } from '@/lib/phoneOrder'

// POST /api/phone-credits/[id]/remise { remis, motif } — while a payment plan
// runs, the phone changes hands (owner, 2026-10-30):
//   remis = true  → the client takes the reserved phone now (Réservé → Vendu);
//   remis = false → the phone stays / comes back to the shop (Vendu → Réservé).
// Payments, schedule and discharge rule (only once fully paid) don't change.
// Managers only, reason required.
async function POST_(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user  = await requireActiveUser(MANAGERS)
    const body  = await req.json().catch(() => ({})) as Record<string, unknown>
    const remis = body.remis === true
    if (typeof body.remis !== 'boolean') throw new HttpError(400, 'Indiquez si le téléphone est remis ou gardé')
    const motif = requireMotif(body.motif)

    const { before, phoneId } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT credit_id FROM phone_credit_sales WHERE credit_id = ${params.id} FOR UPDATE`
      const before = await tx.phone_credit_sales.findFirst({ where: { credit_id: params.id, is_deleted: false } })
      if (!before) throw new HttpError(404, 'Crédit introuvable')
      if (before.statut === 'annule') throw new HttpError(400, 'Ce dossier est annulé')
      if (before.discharged_at) throw new HttpError(400, 'Dossier déjà déchargé : le téléphone est vendu et remis')
      if (before.phone_remis === remis) throw new HttpError(400, remis ? 'Le téléphone est déjà remis au client' : 'Le téléphone est déjà réservé au magasin')

      // an ordered phone can't be handed over before it arrives
      if (remis) await assertArrived(tx, before.phone_id)
      // The phone must be this file's, in the state that goes with it
      const phone = await tx.phones.findUnique({ where: { phone_id: before.phone_id }, select: { status: true } })
      const expected = remis ? 'reserve' : 'vendu'
      if (phone?.status !== expected) {
        throw new HttpError(409, `Le téléphone est « ${phone?.status ?? 'introuvable'} » : changement impossible (attendu « ${expected === 'reserve' ? 'Réservé' : 'Vendu'} »)`)
      }
      await tx.phones.update({ where: { phone_id: before.phone_id }, data: { status: remis ? 'vendu' : 'reserve', updated_by: user.id } })
      await tx.phone_credit_sales.update({ where: { credit_id: params.id }, data: { phone_remis: remis } })
      return { before, phoneId: before.phone_id }
    })

    const notes = remis ? `Téléphone remis au client en cours de paiement : ${motif}` : `Téléphone gardé au magasin (réservé) : ${motif}`
    // On the file: the phone's history shows its file's notes (no double line)
    await logActivity({
      store_id: before.store_id, user_id: user.id, user_name: user.display_name, action_type: 'modification',
      module: 'telephones', record_id: params.id, notes, ip_address: getIpFromRequest(req),
      before_state: { phone_remis: before.phone_remis, phone_id: phoneId }, after_state: { phone_remis: remis },
    })
    return json({ data: { credit_id: params.id, phone_remis: remis } })
  } catch (err) {
    return handleError(err, 'POST /api/phone-credits/[id]/remise')
  }
}

export const POST = withNotify(POST_)
