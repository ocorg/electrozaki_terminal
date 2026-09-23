import { NextRequest } from 'next/server'
import { json, handleError, requireUser, requireActiveUser, HttpError } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite } from '@/lib/storefront/access'

// Repair requests and contact messages sent from the website (all staff).

export async function GET() {
  try {
    await requireUser()
    const [repairs, messages] = await Promise.all([
      site().repairRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
      site().contactMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
    ])
    return json({ data: { repairs, messages } })
  } catch (err) {
    return handleError(err, 'GET /api/site/requests')
  }
}

const REPAIR_STATUSES = ['NEW', 'CONTACTED', 'QUOTED', 'CONFIRMED', 'CANCELLED'] as const

// PATCH { id, status } — follow-up of a website repair request.
async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const { id, status } = await request.json()
    if (!(REPAIR_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, 'Statut invalide')
    const before = await site().repairRequest.findUnique({ where: { id: String(id) }, select: { id: true, status: true, customerName: true } })
    if (!before) throw new HttpError(404, 'Demande introuvable')
    await site().repairRequest.update({ where: { id: before.id }, data: { status } })
    await logSite(user, 'modification', `Demande de réparation web de ${before.customerName} : ${before.status} → ${status}`, { record_id: before.id })
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'PATCH /api/site/requests')
  }
}

export const PATCH = withNotify(PATCH_)
