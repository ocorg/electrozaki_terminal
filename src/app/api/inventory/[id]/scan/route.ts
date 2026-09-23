import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { phoneLabel } from '@/lib/inventory'
import { withNotify } from '@/lib/realtime'

// Response `type`: trouve | hors_perimetre | non_enregistre | deja_scanne
async function POST_(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json()
    const rawImei: string = (body.imei ?? '').trim()
    if (!rawImei) throw new HttpError(400, 'IMEI requis')

    const user = await requireActiveUser(MANAGERS)
    const session = await prisma.inventory_sessions.findFirst({
      where:  { session_id: params.id, ...(user.store_id && { store_id: user.store_id }) },
      select: { statut: true },
    })
    if (!session) throw new HttpError(404, 'Session introuvable')
    if (session.statut !== 'en_cours') throw new HttpError(409, 'Session déjà terminée')

    // A PHO-XXX reference code resolves to the phone's real IMEI
    let imei = rawImei
    if (/^PHO-\d+$/i.test(rawImei)) {
      const byRef = await prisma.phones.findFirst({ where: { phone_id: rawImei, is_deleted: false }, select: { imei: true } })
      if (byRef?.imei) imei = byRef.imei
    }
    const now = new Date()

    const existing = await prisma.inventory_session_items.findFirst({ where: { session_id: params.id, imei } })
    if (existing) {
      if (existing.resultat !== 'en_attente') return json({ type: 'deja_scanne', item: existing })
      // A — expected in the shop: found
      const item = await prisma.inventory_session_items.update({
        where: { item_id: existing.item_id },
        data:  { resultat: 'trouve', scanned_at: now },
      })
      return json({ type: 'trouve', item })
    }

    const phone = await prisma.phones.findFirst({
      where:  { imei, is_deleted: false },
      select: { phone_id: true, marque: true, model: true, status: true },
    })
    if (phone) {
      // B — known phone, not expected here (e.g. already sold)
      const item = await prisma.inventory_session_items.create({
        data: {
          session_id: params.id, phone_id: phone.phone_id, imei, phone_label: phoneLabel(phone.marque, phone.model),
          phone_status: phone.status, resultat: 'hors_perimetre', scanned_at: now,
        },
      })
      return json({ type: 'hors_perimetre', item })
    }

    // C — IMEI never registered
    const item = await prisma.inventory_session_items.create({
      data: { session_id: params.id, phone_id: null, imei, phone_label: null, phone_status: null, resultat: 'non_enregistre', scanned_at: now },
    })
    return json({ type: 'non_enregistre', item })
  } catch (err) {
    return handleError(err, 'POST /api/inventory/[id]/scan')
  }
}

export const POST = withNotify(POST_)
