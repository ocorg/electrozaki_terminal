import { NextRequest } from 'next/server'
import type { supplier_payment_type } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, dateOnly, todayDate, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { assertCaisseOpen } from '@/lib/phoneCredits'

// One logic for every supplier (2026-09-28): a "règlement" settles chosen
// SOLD phones (it may use the supplier's credit, so the cash paid can be less
// than the phones' total, even 0); an "avance" adds credit. The old
// 'paiement_b' stays readable in the history but can't be created any more.
const PAYMENT_TYPES: supplier_payment_type[] = ['reglement_a', 'avance_a']

export async function GET(request: NextRequest) {
  try {
    await requireUser(MANAGERS)
    const { searchParams } = new URL(request.url)
    const supplier_id = searchParams.get('supplier_id')
    const store_id    = searchParams.get('store_id')

    // Sold phones not yet settled, for every supplier (phones_unsettled_a is a view)
    if (searchParams.get('mode') === 'unsettled_phones' && supplier_id) {
      const data = await prisma.$queryRaw`
        SELECT phone_id, fournisseur_id, marque, model, imei, couleur, stockage, prix_achat, cash_recu, fac_ref, sold_at, origine_phone_id
        FROM phones_unsettled_a WHERE fournisseur_id = ${supplier_id} ORDER BY sold_at DESC`
      return json({ data })
    }

    const data = await prisma.supplier_payments.findMany({
      where:   { is_deleted: false, ...(supplier_id && { supplier_id }), ...(store_id && { store_id }) },
      orderBy: { date_paiement: 'desc' },
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/supplier-payments')
  }
}

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const store_id = body.store_id ?? user.store_id ?? null

    if (!body.supplier_id) throw new HttpError(400, 'supplier_id requis')
    if (!PAYMENT_TYPES.includes(body.payment_type)) throw new HttpError(400, 'Type de paiement invalide')
    const montant  = Math.round(Number(body.montant) * 100) / 100
    const phoneIds: string[] = Array.isArray(body.phone_ids) ? [...new Set((body.phone_ids as unknown[]).map(String))] : []
    if (!Number.isFinite(montant) || montant < 0) throw new HttpError(400, 'Montant invalide')
    if (body.payment_type === 'avance_a' && (montant <= 0 || phoneIds.length)) throw new HttpError(400, 'Une avance est un montant positif, sans téléphones')
    if (body.payment_type === 'reglement_a' && !phoneIds.length) throw new HttpError(400, 'Choisissez les téléphones vendus à régler')
    // Where the money comes from: the day's drawer leaves the caisse
    const source = ['caisse', 'hors_caisse', 'virement'].includes(body.source) ? body.source as string : 'hors_caisse'
    const datePaiement = dateOnly(body.date_paiement) ?? todayDate()

    // Payment and (for a règlement) settling the phones commit together
    const data = await prisma.$transaction(async (tx) => {
      if (source === 'caisse' && montant > 0) await assertCaisseOpen(tx, store_id, datePaiement)
      if (body.payment_type === 'reglement_a') {
        // Only this supplier's sold phones still waiting, and enough paid:
        // cash now + the supplier's credit must cover them.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supplier:${body.supplier_id}`}))`
        const rows = await tx.$queryRaw<{ phone_id: string; cash_recu: unknown }[]>`
          SELECT phone_id, cash_recu FROM phones_unsettled_a
          WHERE fournisseur_id = ${body.supplier_id} AND phone_id = ANY(${phoneIds})`
        if (rows.length !== phoneIds.length) throw new HttpError(409, 'Certains téléphones ne sont pas (ou plus) à régler pour ce fournisseur')
        const due = rows.reduce((sum, r) => sum + Number(r.cash_recu ?? 0), 0)
        const [summary] = await tx.$queryRaw<{ credit_total: unknown }[]>`
          SELECT credit_total FROM suppliers_summary WHERE supplier_id = ${body.supplier_id}`
        const credit = Number(summary?.credit_total ?? 0)
        if (montant + credit + 0.01 < due) {
          throw new HttpError(400, `Montant insuffisant : ${Math.round(due - credit)} DH à payer (crédit du fournisseur déduit)`)
        }
      }
      const payment = await tx.supplier_payments.create({
        data: {
          supplier_id:   body.supplier_id,
          payment_type:  body.payment_type,
          montant,
          phone_ids:     phoneIds,
          date_paiement: datePaiement,
          source,
          payment_method: source === 'virement' ? 'virement' : 'especes',
          notes:         body.notes ?? null,
          store_id,
          created_by:    user.id,
        },
      })
      if (body.payment_type === 'reglement_a' && phoneIds.length) {
        await tx.phones.updateMany({
          where: { phone_id: { in: phoneIds } },
          data:  { settled_at: new Date(), settled_by: user.id },
        })
      }
      return payment
    })

    await logActivity({
      store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'paiements_fournisseurs',
      record_id:   data.payment_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/supplier-payments')
  }
}

export const POST = withNotify(POST_)

// Owner only: fix a payment typed wrong — correct its amount, or cancel it
// (its phones go back to "to settle"). A reason is required; both are logged.
async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser(['proprietaire'])
    const body = await request.json()
    const motif = String(body.motif ?? '').trim()
    if (!body.payment_id) throw new HttpError(400, 'payment_id requis')
    if (motif.length < 3) throw new HttpError(400, 'Indiquez le motif de la correction')
    if (!['montant', 'annuler'].includes(body.action)) throw new HttpError(400, 'Action invalide')
    const montant = Math.round(Number(body.montant) * 100) / 100
    if (body.action === 'montant' && (!Number.isFinite(montant) || montant < 0)) throw new HttpError(400, 'Montant invalide')

    const { before, data } = await prisma.$transaction(async (tx) => {
      const before = await tx.supplier_payments.findUnique({ where: { payment_id: body.payment_id } })
      if (!before || before.is_deleted) throw new HttpError(404, 'Paiement introuvable')
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supplier:${before.supplier_id}`}))`
      if (body.action === 'montant' && before.payment_type === 'avance_a' && montant <= 0) {
        throw new HttpError(400, 'Une avance doit rester positive — annulez-la plutôt')
      }
      const note = `${body.action === 'annuler' ? 'Annulé' : `Corrigé (était ${Number(before.montant)} DH)`} : ${motif}`
      const data = await tx.supplier_payments.update({
        where: { payment_id: before.payment_id },
        data: {
          ...(body.action === 'annuler' ? { is_deleted: true } : { montant }),
          notes:      before.notes ? `${before.notes} · ${note}` : note,
          updated_at: new Date(),
          updated_by: user.id,
        },
      })
      if (body.action === 'annuler' && before.phone_ids.length) {
        await tx.phones.updateMany({
          where: { phone_id: { in: before.phone_ids } },
          data:  { settled_at: null, settled_by: null },
        })
      }
      return { before, data }
    })

    await logActivity({
      store_id:     data.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  body.action === 'annuler' ? 'annulation' : 'modification',
      module:       'paiements_fournisseurs',
      record_id:    data.payment_id,
      before_state: before,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/supplier-payments')
  }
}

export const PATCH = withNotify(PATCH_)
