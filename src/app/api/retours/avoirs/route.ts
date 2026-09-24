import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, todayDate, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { deviceLabels } from '@/lib/device-labels'
import { assertDrawerOpen } from '@/lib/retours'

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v))

// GET ?store_id=&q= — store credits (avoirs) still available, for the POS:
// by avoir number, client name or phone.
export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const q        = (searchParams.get('q') ?? '').trim().slice(0, 60)
    if (!store_id) throw new HttpError(400, 'store_id requis')
    const digits = q.replace(/\D/g, '')

    const rows = await prisma.retours.findMany({
      where: {
        store_id, type: 'retour', mode: 'avoir', avoir_solde: { gt: 0 },
        ...(q && {
          OR: [
            { retour_id: { contains: q.toUpperCase().replace(/\s+/g, '') } },
            { sale: { clients: { nom: { contains: q, mode: 'insensitive' } } } },
            ...(digits.length >= 4 ? [{ sale: { clients: { telephone: { contains: digits } } } }] : []),
          ],
        }),
      },
      include: { sale: { select: { txn_id: true, device_type: true, device_id: true, clients: { select: { nom: true, telephone: true } } } } },
      orderBy: { created_at: 'desc' },
      take: 30,
    })
    const labels = await deviceLabels(rows.map(r => r.sale))
    return json({
      data: rows.map(r => ({
        retour_id:   r.retour_id,
        date:        r.date,
        montant:     num(r.montant),
        avoir_solde: num(r.avoir_solde),
        txn_id:      r.txn_id,
        item:        labels.get(r.sale.device_id) ?? r.sale.device_id,
        client:      r.sale.clients,
      })),
    })
  } catch (err) {
    return handleError(err, 'GET /api/retours/avoirs')
  }
}

// POST { avoir_id, montant, mode: especes|virement } — pay back (part of)
// what is left on a store credit. Managers only; comes out of today's caisse.
async function POST_(request: NextRequest) {
  try {
    const user     = await requireActiveUser(MANAGERS)
    const body     = await request.json()
    const avoir_id = String(body.avoir_id ?? '')
    const montant  = Math.round(Number(body.montant) * 100) / 100
    const mode     = body.mode === 'virement' ? 'virement' : 'especes'
    if (!avoir_id) throw new HttpError(400, 'Avoir manquant')
    if (!Number.isFinite(montant) || montant <= 0) throw new HttpError(400, 'Montant invalide')

    const payout = await prisma.$transaction(async tx => {
      const avoir = await tx.retours.findUnique({ where: { retour_id: avoir_id } })
      if (!avoir || avoir.mode !== 'avoir' || avoir.type !== 'retour') throw new HttpError(404, 'Avoir introuvable')
      if (mode === 'especes') await assertDrawerOpen(tx, avoir.store_id)
      // Conditional decrement: the same credit can't be paid out or spent twice.
      const { count } = await tx.retours.updateMany({
        where: { retour_id: avoir_id, avoir_solde: { gte: montant } },
        data:  { avoir_solde: { decrement: montant } },
      })
      if (count === 0) throw new HttpError(409, 'Solde de l\'avoir insuffisant')
      return tx.retours.create({
        data: {
          type: 'solde_avoir', txn_id: avoir.txn_id, avoir_id, store_id: avoir.store_id, date: todayDate(),
          qty: 0, montant, mode, motif: `Solde de l'avoir ${avoir_id} remboursé`, created_by: user.id,
        },
      })
    })

    await logActivity({
      store_id: payout.store_id, user_id: user.id, user_name: user.display_name,
      action_type: 'creation', module: 'transactions', record_id: payout.retour_id, after_state: payout,
      ip_address: getIpFromRequest(request),
      notes: `Solde de l'avoir ${avoir_id} remboursé : ${montant} DH (${mode === 'especes' ? 'espèces' : 'virement'})`,
    })
    return json({ data: payout }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/retours/avoirs')
  }
}

export const POST = withNotify(POST_)
