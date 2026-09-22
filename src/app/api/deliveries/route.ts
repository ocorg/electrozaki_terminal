import { NextRequest } from 'next/server'
import type { Prisma, delivery_status, device_status, device_type } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, pickInput, columnsOf, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { notifyCaisseChange } from '@/lib/realtime'
import { codeLabel } from '@/lib/codes'

const EDITABLE = columnsOf('deliveries', ['delivery_id', 'caisse_entry_created'])
const TERMINAL: delivery_status[] = ['livre', 'annule', 'retour']

async function setDeviceStatus(tx: Prisma.TransactionClient, type: device_type, id: string, status: device_status, userId: string) {
  if (type === 'telephone') await tx.phones.update({ where: { phone_id: id }, data: { status, updated_by: userId } })
  else if (type === 'laptop') await tx.laptops.update({ where: { laptop_id: id }, data: { status, updated_by: userId } })
}

// ── GET — list deliveries ─────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id = searchParams.get('store_id')
    const statut   = searchParams.get('statut') as delivery_status | null

    const data = await prisma.deliveries.findMany({
      where:   { is_deleted: false, ...(store_id && { store_id }), ...(statut && { statut }) },
      include: { delivery_items: true },
      orderBy: { created_at: 'desc' },
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/deliveries')
  }
}

// ── POST — create delivery ────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { items, ...body } = await request.json()
    const store_id = body.store_id ?? user.store_id
    if (!body.client_name || !body.client_phone || !body.client_address) {
      throw new HttpError(400, 'Informations client incomplètes')
    }
    const input = pickInput('deliveries', body, EDITABLE) as Prisma.deliveriesUncheckedCreateInput
    const withAdvance = input.payment_scenario === 'avance_totale' || input.payment_scenario === 'avance_partielle'

    const delivery = await prisma.$transaction(async (tx) => {
      const delivery = await tx.deliveries.create({
        data: { ...input, store_id, caisse_entry_created: withAdvance, created_by: user.id, updated_by: user.id },
      })
      if (Array.isArray(items) && items.length) {
        await tx.delivery_items.createMany({
          data: items.map((i: { device_type: device_type; device_id: string; txn_id?: string }) => ({
            delivery_id: delivery.delivery_id, device_type: i.device_type, device_id: i.device_id, txn_id: i.txn_id ?? null,
          })),
        })
        // Past confirmation, the devices are out for delivery
        if (delivery.statut !== 'confirmation_en_cours') {
          for (const i of items) await setDeviceStatus(tx, i.device_type, i.device_id, 'en_livraison', user.id)
        }
      }
      return delivery
    })

    await logActivity({
      store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'transactions',
      record_id:   delivery.delivery_id,
      after_state: delivery,
      ip_address:  getIpFromRequest(request),
      notes:       `Livraison créée — scénario : ${codeLabel('payment_scenario', delivery.payment_scenario, 'fr')}`,
    })

    return json({ data: delivery }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/deliveries')
  }
}

// ── PATCH — update delivery status ───────────────────────────
// Manager/owner only: cancelling or returning voids the linked transaction, which
// must need the same approval as /api/transactions/void.
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { delivery_id, statut, notes } = await request.json() as { delivery_id?: string; statut?: delivery_status; notes?: string }
    if (!delivery_id || !statut) throw new HttpError(400, 'delivery_id et statut requis')

    const { before, updated } = await prisma.$transaction(async (tx) => {
      const before = await tx.deliveries.findUnique({ where: { delivery_id }, include: { delivery_items: true } })
      if (!before) throw new HttpError(404, 'Livraison introuvable')
      if (TERMINAL.includes(before.statut)) throw new HttpError(400, 'Statut terminal — impossible de modifier')
      const items = before.delivery_items

      if (statut !== 'confirmation_en_cours' && before.statut === 'confirmation_en_cours') {
        for (const i of items) await setDeviceStatus(tx, i.device_type, i.device_id, 'en_livraison', user.id)
      }
      if (statut === 'livre') {
        for (const i of items) await setDeviceStatus(tx, i.device_type, i.device_id, 'vendu', user.id)
      }
      if (statut === 'annule' || statut === 'retour') {
        for (const i of items) {
          await setDeviceStatus(tx, i.device_type, i.device_id, 'disponible', user.id)
          if (i.txn_id) {
            await tx.transactions.update({
              where: { txn_id: i.txn_id },
              data:  { voided: true, voided_by: user.id, voided_at: new Date(), voided_reason: `Livraison ${codeLabel('delivery_status', statut, 'fr').toLowerCase()} — ${delivery_id}` },
            })
          }
        }
      }

      const updated = await tx.deliveries.update({
        where: { delivery_id },
        data:  { statut, notes: notes ?? before.notes, updated_by: user.id, ...(statut === 'livre' && { caisse_entry_created: true }) },
      })
      return { before, updated }
    })

    await logActivity({
      store_id:     before.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'modification',
      module:       'transactions',
      record_id:    delivery_id,
      before_state: before,
      after_state:  updated,
      ip_address:   getIpFromRequest(request),
      notes:        `Statut livraison : ${codeLabel('delivery_status', before.statut, 'fr')} → ${codeLabel('delivery_status', statut, 'fr')}`,
    })
    if (statut === 'annule' || statut === 'retour') await notifyCaisseChange(before.store_id)

    return json({ data: updated })
  } catch (err) {
    return handleError(err, 'PATCH /api/deliveries')
  }
}
