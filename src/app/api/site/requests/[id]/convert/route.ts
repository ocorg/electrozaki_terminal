import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, HttpError } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { logActivity } from '@/lib/utils/logger'
import { site, orderRef, logSite } from '@/lib/storefront/access'
import { storeDate } from '@/lib/time'
import { codeLabel } from '@/lib/codes'
import { PROBLEMS_BY_KIND } from '@/lib/repairs'

type Ctx = { params: { id: string } }

const KIND = { HARDWARE: 'materiel', SOFTWARE: 'logiciel', CONSULTATION: 'consultation' } as const

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
    if (req.status === 'CANCELLED') throw new HttpError(409, 'Demande annulée')

    const tag = marker(req.id)
    const already = await prisma.reparations.findFirst({
      where:  { notes: { contains: tag }, is_deleted: false },
      select: { rep_id: true },
    })
    if (already) {
      // Links older conversions too, so the customer's DEM number follows the ticket.
      if (req.repairRef !== already.rep_id) {
        await site().repairRequest.update({ where: { id: req.id }, data: { repairRef: already.rep_id } })
      }
      return json({ ok: true, rep_id: already.rep_id, existing: true })
    }

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
      // The website uses the same problem codes as the ERP (codes.ts).
      const kind     = KIND[req.kind]
      const codes    = req.problemAreas.filter(p => (PROBLEMS_BY_KIND[kind] as string[]).includes(p)) as typeof PROBLEMS_BY_KIND[typeof kind]
      const problems = codes.map(p => codeLabel('repair_problem', p, 'fr')).join(', ')
      return tx.reparations.create({
        data: {
          client_id:       client.client_id,
          type_reparation: kind,
          problemes:       codes,
          marque:          req.deviceBrand || null,
          model:           req.deviceModel || (kind === 'consultation' ? 'Consultation' : 'Appareil'),
          probleme:        [problems, req.preferredSlot ? `Créneau souhaité : ${req.preferredSlot}` : null].filter(Boolean).join(' — ') || 'À diagnostiquer',
          statut:     'en_attente',
          date_depot: new Date(`${storeDate()}T00:00:00Z`),
          notes:      [tag, `N° client : ${req.ref}`, req.notes].filter(Boolean).join(' — '),
          store_id:   storeId,
          created_by: user.id,
          updated_by: user.id,
        },
      })
    })

    // The customer's DEM number now tracks this ticket on the website.
    await site().repairRequest.update({ where: { id: req.id }, data: { status: 'CONFIRMED', repairRef: repair.rep_id } })

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
