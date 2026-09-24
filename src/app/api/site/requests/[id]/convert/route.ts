import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { logActivity } from '@/lib/utils/logger'
import { site, orderRef, logSite } from '@/lib/storefront/access'
import { storeDate } from '@/lib/time'

type Ctx = { params: { id: string } }

// Website problem keys (storefront RepairDiagnostic) → wording on the ticket.
const AREA: Record<string, string> = {
  ecran: 'Écran', batterie: 'Batterie', camera: 'Appareil photo',
  connecteur: 'Port de charge', son: 'Son / Micro', reseau: 'Désimlockage réseau',
}

/** Marker written in the ticket's notes — also what prevents a second ticket. */
const marker = (id: string) => `[Demande site web ${orderRef(id)}]`

/** Last 9 digits: "06 12 34 56 78", "+212 612345678" and "0612345678" match. */
const phoneKey = (phone: string) => phone.replace(/\D/g, '').slice(-9)

// POST — "Créer la réparation": the customer brought the device in. Turns the
// website request into a repair ticket (Réparations), reusing the customer's
// client record when the phone number is already known.
async function POST_(_request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireActiveUser()
    const req  = await site().repairRequest.findUnique({ where: { id: params.id } })
    if (!req) throw new HttpError(404, 'Demande introuvable')

    const tag = marker(req.id)
    const already = await prisma.reparations.findFirst({
      where:  { notes: { contains: tag }, is_deleted: false },
      select: { rep_id: true },
    })
    if (already) return json({ ok: true, rep_id: already.rep_id, existing: true })

    const storeId = user.store_id ?? 'EZ-001'
    const key     = phoneKey(req.customerPhone)
    if (key.length < 9) throw new HttpError(400, 'Numéro de téléphone du client invalide')

    const repair = await prisma.$transaction(async tx => {
      let client = await tx.clients.findFirst({
        where:  { telephone: { endsWith: key }, is_deleted: false },
        select: { client_id: true },
      })
      if (!client) {
        client = await tx.clients.create({
          data:   { nom: req.customerName, telephone: `0${key}`, store_id: storeId, created_by: user.id, updated_by: user.id },
          select: { client_id: true },
        })
      }
      const problems = req.problemAreas.map(a => AREA[a] ?? a).join(', ')
      return tx.reparations.create({
        data: {
          client_id:  client.client_id,
          marque:     req.deviceBrand,
          model:      req.deviceModel,
          probleme:   problems || 'À diagnostiquer',
          statut:     'en_attente',
          date_depot: new Date(`${storeDate()}T00:00:00Z`),
          notes:      [tag, req.notes].filter(Boolean).join(' — '),
          store_id:   storeId,
          created_by: user.id,
          updated_by: user.id,
        },
      })
    })

    await site().repairRequest.update({ where: { id: req.id }, data: { status: 'CONFIRMED' } })

    await logActivity({
      store_id: repair.store_id, user_id: user.id, user_name: user.display_name,
      action_type: 'creation', module: 'reparations', record_id: repair.rep_id, after_state: repair,
      notes: `${repair.marque ?? ''} ${repair.model} — ${repair.probleme} (depuis le site web)`.trim(),
    })
    await logSite(user, 'modification', `Demande de réparation web de ${req.customerName} → ${repair.rep_id}`, { record_id: req.id })

    return json({ ok: true, rep_id: repair.rep_id }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/site/requests/[id]/convert')
  }
}

export const POST = withNotify(POST_)
