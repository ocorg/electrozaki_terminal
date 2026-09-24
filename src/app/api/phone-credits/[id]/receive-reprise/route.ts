import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

// POST /api/phone-credits/[id]/receive-reprise
// Marks the trade-in phone as physically received. No stock entry — that happens at discharge.
async function POST_(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user     = await requireActiveUser(MANAGERS)
    const body     = await req.json().catch(() => ({})) as Record<string, unknown>
    const creditId = params.id
    const storeId  = user.store_id ?? (body.store_id as string) ?? 'EZ-001'

    const credit = await prisma.phone_credit_sales.findFirst({
      where:  { credit_id: creditId, is_deleted: false },
      select: { has_reprise: true, reprise_remise: true, reprise_model: true, statut: true },
    })
    if (!credit) throw new HttpError(404, 'Crédit introuvable')
    if (!credit.has_reprise) throw new HttpError(400, 'Ce crédit ne contient pas de reprise')
    if (credit.reprise_remise) throw new HttpError(400, 'La reprise a déjà été marquée comme reçue')
    if (credit.statut !== 'en_cours') throw new HttpError(400, 'Le crédit n\'est plus en cours')

    const now = new Date()
    await prisma.phone_credit_sales.update({
      where: { credit_id: creditId },
      data:  { reprise_remise: true, reprise_remise_at: now },
    })

    await logActivity({
      user_id:     user.id,
      store_id:    storeId,
      user_name:   user.display_name,
      module:      'telephones',
      action_type: 'modification',
      record_id:   creditId,
      ip_address:  getIpFromRequest(req),
      after_state: { credit_id: creditId, reprise_remise: true, reprise_remise_at: now, reprise_model: credit.reprise_model },
    })

    return json({ data: { credit_id: creditId, reprise_remise: true, reprise_remise_at: now } })
  } catch (err) {
    return handleError(err, 'POST /api/phone-credits/[id]/receive-reprise')
  }
}

export const POST = withNotify(POST_)
