import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser, dateOnly, todayDate, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { liveSale } from '@/lib/phoneExit'

// POST /api/phones/[id]/past-sale — a sale recorded after the fact, at its
// TRUE date (owner, 2026-10-04): for a phone that left the shop without
// going through the POS but whose sale is remembered. The sale lands on its
// real day in the figures. A closed caisse keeps its counted totals (they
// are frozen at closing); an open one counts it like any sale.
// « Plusieurs fois » too (owner, 2026-11-07): the sale + its credit file, like
// the POS — a client is required, the down payment (acompte) is the cash paid
// on the sale day, later payments go on the file (Crédits).
// body: { date_vente, prix_vente, payment_method: especes | virement | credit, client_id?, avance?, notes? }
async function POST_(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await req.json() as Record<string, unknown>
    const date = dateOnly(body.date_vente)
    const prix = Math.round(Number(body.prix_vente) * 100) / 100
    const method = body.payment_method
    if (!date) throw new HttpError(400, 'Date de la vente obligatoire')
    if (date.getTime() > todayDate().getTime()) throw new HttpError(400, 'La date ne peut pas être dans le futur')
    if (!(prix > 0)) throw new HttpError(400, 'Prix de vente invalide')
    if (method !== 'especes' && method !== 'virement' && method !== 'credit') throw new HttpError(400, 'Paiement : espèces, virement ou plusieurs fois')
    const onCredit = method === 'credit'
    const avance = onCredit ? Math.round((Number(body.avance) || 0) * 100) / 100 : 0
    const clientId = body.client_id ? String(body.client_id) : null
    if (onCredit) {
      if (!clientId) throw new HttpError(400, 'Client obligatoire pour un paiement en plusieurs fois')
      if (avance < 0) throw new HttpError(400, 'Acompte invalide')
      if (prix - avance <= 0.01) throw new HttpError(400, 'Rien à payer plus tard : choisissez Espèces ou Virement')
    }

    const { phone, txn } = await prisma.$transaction(async (tx) => {
      const phone = await tx.phones.findFirst({ where: { phone_id: params.id, is_deleted: false } })
      if (!phone) throw new HttpError(404, 'Téléphone introuvable')
      if (!['vendu', 'void', 'disponible'].includes(phone.status)) throw new HttpError(400, 'Ce téléphone n’est pas dans un état qui permet une vente passée')
      const live = await liveSale(tx, phone.phone_id, phone.status)
      if (live) throw new HttpError(400, `Ce téléphone a déjà ${live.kind === 'vente' ? 'une vente' : 'un dossier'} (${live.ref})`)

      const expiry = new Date(date)
      expiry.setUTCMonth(expiry.getUTCMonth() + (phone.warranty_months ?? 6))
      const note = String(body.notes ?? '').trim()
      const client = clientId ? await tx.clients.findFirst({ where: { client_id: clientId, is_deleted: false }, select: { nom: true, telephone: true } }) : null
      if (clientId && !client) throw new HttpError(400, 'Client introuvable')
      const txn = await tx.transactions.create({
        data: {
          device_type: 'telephone', device_id: phone.phone_id, client_id: clientId,
          type_operation: 'vente', qty: 1, prix_vente: prix, date_vente: date, payment_method: method,
          ...(onCredit && { avance, date_avance: date }),
          warranty_start: date, warranty_expiry: expiry,
          notes: `Vente enregistrée après coup le ${todayDate().toISOString().slice(0, 10)}${note ? ` — ${note}` : ''}`,
          store_id: phone.store_id, created_by: user.id, updated_by: user.id,
        },
      })
      await tx.phones.update({
        where: { phone_id: phone.phone_id },
        data:  { status: 'vendu', void_at: null, void_by: null, void_motif: null, updated_by: user.id },
      })
      if (onCredit) {
        const open = await tx.phone_credit_sales.findFirst({ where: { phone_id: phone.phone_id, statut: 'en_cours', is_deleted: false } })
        if (open) throw new HttpError(400, 'Ce téléphone a déjà un dossier en cours')
        await tx.phone_credit_sales.create({
          data: {
            phone_id: phone.phone_id, txn_id: txn.txn_id, client_id: clientId,
            client_name: client?.nom ?? 'Client', client_tel: client?.telephone ?? null,
            montant_total: prix, avance_vente: avance, montant_paye: avance, statut: 'en_cours',
            phone_remis: true, notes: txn.notes, store_id: txn.store_id, created_by: user.id, has_reprise: false,
            created_at: date,   // the file starts on the sale day
          },
        })
      }
      return { phone, txn }
    })
    await logActivity({
      store_id: txn.store_id, user_id: user.id, user_name: user.display_name, action_type: 'creation', module: 'transactions',
      record_id: txn.txn_id, after_state: txn, notes: `Vente passée${onCredit ? ' (plusieurs fois)' : ''} — ${phone.phone_id}, datée du ${date.toISOString().slice(0, 10)}`, ip_address: getIpFromRequest(req),
    })
    return json({ data: { txn_id: txn.txn_id, date_vente: date.toISOString().slice(0, 10) } }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/phones/[id]/past-sale')
  }
}

export const POST = withNotify(POST_)
