import { NextRequest } from 'next/server'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { prisma } from '@/lib/db'
import { site, logSite, orderRef } from '@/lib/storefront/access'

// Repair requests and contact messages sent from the website (all staff).

export async function GET() {
  try {
    await requireUser(MANAGERS)
    const [repairs, messages] = await Promise.all([
      site().repairRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
      site().contactMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
    ])
    // Tickets already created from a request carry "[Demande site web REF]".
    const tickets = await prisma.reparations.findMany({
      where:  { notes: { contains: '[Demande site web ' }, is_deleted: false },
      select: { rep_id: true, statut: true, notes: true },
    })
    const byRef = new Map(tickets.map(t => [t.notes?.match(/\[Demande site web ([A-Z0-9]+)\]/)?.[1], t]))
    return json({
      data: {
        repairs: repairs.map(r => {
          const t = byRef.get(orderRef(r.id))
          return { ...r, ticket: t ? { rep_id: t.rep_id, statut: t.statut } : null }
        }),
        messages,
      },
    })
  } catch (err) {
    return handleError(err, 'GET /api/site/requests')
  }
}

const REPAIR_STATUSES = ['NEW', 'CONTACTED', 'QUOTED', 'CONFIRMED', 'CANCELLED'] as const

// PATCH { id, status, reason? } — follow-up of a website repair request.
// Cancelling needs a manager and a reason (kept on the request).
async function PATCH_(request: NextRequest) {
  try {
    const { id, status, reason } = await request.json()
    const cancelling = status === 'CANCELLED'
    const user = await requireActiveUser(cancelling ? MANAGERS : undefined)
    if (!(REPAIR_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, 'Statut invalide')
    const motif = typeof reason === 'string' ? reason.trim() : ''
    if (cancelling && (motif.length < 5 || motif.length > 500)) throw new HttpError(400, "Indiquez le motif de l'annulation (5 caractères minimum)")
    const before = await site().repairRequest.findUnique({ where: { id: String(id) }, select: { id: true, status: true, customerName: true } })
    if (!before) throw new HttpError(404, 'Demande introuvable')
    await site().repairRequest.update({ where: { id: before.id }, data: { status, ...(cancelling && { cancelReason: motif }) } })
    await logSite(user, cancelling ? 'annulation' : 'modification',
      `Demande de réparation web de ${before.customerName} : ${before.status} → ${status}${cancelling ? ` — ${motif}` : ''}`,
      { record_id: before.id })
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'PATCH /api/site/requests')
  }
}

export const PATCH = withNotify(PATCH_)
