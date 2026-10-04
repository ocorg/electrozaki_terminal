import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { requireMotif } from '@/lib/phoneCredits'

// POST /api/phone-credits/[id]/cancel — the client gives up (owner only,
// owner's decision 2026-10-02). The phone goes back on sale; payments stay
// recorded (money received) and the answer says how much was paid, to
// refund or keep. A traded-in phone already in stock stays there.
async function POST_(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireActiveUser(['proprietaire'])
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const motif = requireMotif(body.motif)

    const { before, after, phoneBack } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT credit_id FROM phone_credit_sales WHERE credit_id = ${params.id} FOR UPDATE`
      const before = await tx.phone_credit_sales.findFirst({ where: { credit_id: params.id, is_deleted: false } })
      if (!before) throw new HttpError(404, 'Crédit introuvable')
      if (before.statut === 'annule') throw new HttpError(400, 'Ce dossier est déjà annulé')
      if (before.discharged_at) throw new HttpError(400, 'Dossier déjà déchargé (facture émise) : faites un retour depuis le POS')

      const note = `Annulé le ${new Date().toISOString().slice(0, 10)} : ${motif}`
      const after = await tx.phone_credit_sales.update({
        where: { credit_id: params.id },
        data:  { statut: 'annule', notes: before.notes ? `${before.notes} · ${note}` : note },
      })
      const phone = await tx.phones.findUnique({ where: { phone_id: before.phone_id }, select: { status: true } })
      const phoneBack = !!phone && ['reserve', 'vendu'].includes(phone.status)
      if (phoneBack) await tx.phones.update({ where: { phone_id: before.phone_id }, data: { status: 'disponible', updated_by: user.id } })
      // The file follows a POS sale: the sale is cancelled with it
      if (before.txn_id) {
        await tx.transactions.updateMany({
          where: { txn_id: before.txn_id, voided: false },
          data:  { voided: true, voided_at: new Date(), voided_by: user.id, voided_reason: `Dossier ${params.id} annulé : ${motif}` },
        })
      }
      // The schedule has no meaning any more
      await tx.phone_credit_echeances.deleteMany({ where: { credit_id: params.id } })
      return { before, after, phoneBack }
    })

    await logActivity({
      store_id: before.store_id, user_id: user.id, user_name: user.display_name,
      action_type: 'annulation', module: 'telephones', record_id: params.id,
      before_state: before, after_state: after, notes: `Crédit annulé : ${motif}`,
      ip_address: getIpFromRequest(req),
    })
    return json({
      data: {
        credit: after,
        phone_back_on_sale: phoneBack,
        montant_deja_verse: Number(before.montant_paye),
        reprise_in_stock: before.reprise_phone_id,
      },
    })
  } catch (err) {
    return handleError(err, 'POST /api/phone-credits/[id]/cancel')
  }
}

export const POST = withNotify(POST_)
