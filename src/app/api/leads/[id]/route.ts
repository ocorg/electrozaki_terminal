import { NextRequest } from 'next/server'
import type { Prisma, lead_etape, lead_motif } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, dateOnly, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { MOTIFS, OPEN } from '@/lib/leads'
import { leadInput } from '@/lib/leadsServer'

const num = (v: unknown) => (v == null ? 0 : Number(v))

// GET — the lead, its notes, and what it became
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser(MANAGERS)
    const lead = await prisma.leads.findFirst({
      where:   { lead_id: params.id, is_deleted: false },
      include: { lead_notes: { orderBy: { created_at: 'desc' } } },
    })
    if (!lead) throw new HttpError(404, 'Lead introuvable')
    const users = await prisma.user_profiles.findMany({
      where: { id: { in: [lead.created_by, ...lead.lead_notes.map(n => n.created_by)].filter(Boolean) as string[] } },
      select: { id: true, display_name: true },
    })
    const name = new Map(users.map(u => [u.id, u.display_name]))
    const delivery = lead.delivery_id
      ? await prisma.deliveries.findUnique({ where: { delivery_id: lead.delivery_id }, select: { delivery_id: true, statut: true, montant_total: true, ville: true } })
      : null
    return json({
      data: {
        ...lead,
        created_by_name: lead.created_by ? name.get(lead.created_by) ?? null : null,
        lead_notes: lead.lead_notes.map(n => ({ ...n, by: n.created_by ? name.get(n.created_by) ?? null : null })),
        delivery,
      },
    })
  } catch (err) {
    return handleError(err, 'GET /api/leads/[id]')
  }
}

// PATCH — details, follow-up date, a note, and the stage. Closing a lead:
//   • perdu  → a reason from the fixed list
//   • gagne  → linked to what happened: a POS sale (txn_id), or the phone bought
//              from them (phone_id). A lead sold by delivery is won by the
//              delivery itself when it is delivered (api/deliveries).
async function PATCH_(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user   = await requireActiveUser(MANAGERS)
    const body   = await req.json() as Record<string, unknown>
    const before = await prisma.leads.findFirst({ where: { lead_id: params.id, is_deleted: false } })
    if (!before) throw new HttpError(404, 'Lead introuvable')

    const data: Prisma.leadsUncheckedUpdateInput = { ...(leadInput(body) as Prisma.leadsUncheckedUpdateInput), updated_by: user.id, updated_at: new Date() }
    if ('relance_le' in body) data.relance_le = dateOnly(body.relance_le) ?? null
    let what = 'Lead modifié'

    const etape = body.etape as lead_etape | undefined
    if (etape && etape !== before.etape) {
      if (OPEN.includes(etape)) {
        if (before.delivery_id && before.etape === 'gagne') throw new HttpError(400, 'Ce lead a été gagné par une livraison : il ne se rouvre pas')
        Object.assign(data, { etape, motif_perte: null, closed_at: null, txn_id: null, phone_id: null, montant: null })
        what = `Étape : ${etape}`
      } else if (etape === 'perdu') {
        const motif = body.motif_perte as lead_motif
        if (!MOTIFS.includes(motif)) throw new HttpError(400, 'Choisissez pourquoi ce lead est perdu')
        if (before.delivery_id) {
          const d = await prisma.deliveries.findUnique({ where: { delivery_id: before.delivery_id }, select: { statut: true } })
          if (d && !['annule', 'retour'].includes(d.statut)) throw new HttpError(400, 'Une livraison est en cours pour ce lead : réglez-la dans Livraisons')
        }
        Object.assign(data, { etape, motif_perte: motif, closed_at: new Date(), txn_id: null, phone_id: null, montant: null })
        what = `Perdu — ${motif}`
      } else if (etape === 'gagne') {
        const txnId = typeof body.txn_id === 'string' ? body.txn_id.trim().toUpperCase() : ''
        const phoneId = typeof body.phone_id === 'string' ? body.phone_id.trim().toUpperCase() : ''
        if (txnId) {
          const txn = await prisma.transactions.findUnique({ where: { txn_id: txnId }, select: { txn_id: true, voided: true, prix_vente: true, type_operation: true } })
          if (!txn || txn.voided || txn.type_operation === 'retour') throw new HttpError(400, `Vente ${txnId} introuvable`)
          const montant = body.montant != null && Number(body.montant) >= 0 ? Number(body.montant) : num(txn.prix_vente)
          Object.assign(data, { etape, txn_id: txnId, phone_id: null, montant, motif_perte: null, closed_at: new Date() })
          what = `Gagné — vente ${txnId}`
        } else if (phoneId) {
          const phone = await prisma.phones.findFirst({ where: { phone_id: phoneId, is_deleted: false }, select: { phone_id: true, prix_achat: true } })
          if (!phone) throw new HttpError(400, `Téléphone ${phoneId} introuvable`)
          Object.assign(data, { etape, phone_id: phoneId, txn_id: null, montant: num(phone.prix_achat), motif_perte: null, closed_at: new Date() })
          what = `Gagné — téléphone acheté ${phoneId}`
        } else {
          throw new HttpError(400, 'Un lead gagné se relie à sa vente (ou au téléphone acheté)')
        }
      } else {
        throw new HttpError(400, 'Étape inconnue')
      }
    }

    const note = typeof body.note === 'string' ? body.note.trim() : ''
    const lead = await prisma.leads.update({
      where: { lead_id: before.lead_id },
      data:  { ...data, ...(note && { lead_notes: { create: { texte: note.slice(0, 1000), created_by: user.id } } }) },
    })

    await logActivity({
      store_id: lead.store_id, user_id: user.id, user_name: user.display_name, action_type: 'modification',
      module: 'prospects', record_id: lead.lead_id, before_state: before, after_state: lead, ip_address: getIpFromRequest(req),
      notes: `${lead.lead_id} — ${what}`,
    })
    return json({ data: lead })
  } catch (err) {
    return handleError(err, 'PATCH /api/leads/[id]')
  }
}

async function DELETE_(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const before = await prisma.leads.findFirst({ where: { lead_id: params.id, is_deleted: false } })
    if (!before) throw new HttpError(404, 'Lead introuvable')
    if (before.delivery_id) throw new HttpError(400, 'Ce lead a une livraison : il se garde')
    await prisma.leads.update({ where: { lead_id: before.lead_id }, data: { is_deleted: true, updated_by: user.id } })
    await logActivity({
      store_id: before.store_id, user_id: user.id, user_name: user.display_name, action_type: 'suppression',
      module: 'prospects', record_id: before.lead_id, before_state: before, ip_address: getIpFromRequest(req),
    })
    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'DELETE /api/leads/[id]')
  }
}

export const PATCH = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
