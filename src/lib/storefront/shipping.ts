import type { delivery_status } from '@prisma/client'
import { prisma } from '@/lib/db'
import { storefrontDb, storefrontConfigured } from './db'

// ─────────────────────────────────────────────────────────────────────────
// Website orders ↔ ERP deliveries ("Livraisons"). A web order ships with a
// delivery created here; once linked, every status change of the delivery
// is copied onto the order, which the customer follows on the website
// (/commande/suivi). Linking is automatic when a delivery is created for the
// phone number of a confirmed web order, and can be done by hand from
// "Commandes du site".
// ─────────────────────────────────────────────────────────────────────────

type ShippingStatus = 'CONFIRMING' | 'AWAITING_ADVANCE' | 'PREPARING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED' | 'RETURNED'

export const SHIPPING_OF: Record<delivery_status, ShippingStatus> = {
  confirmation_en_cours: 'CONFIRMING',
  attente_avance:        'AWAITING_ADVANCE',
  prepare:               'PREPARING',
  en_transit:            'IN_TRANSIT',
  livre:                 'DELIVERED',
  annule:                'CANCELLED',
  retour:                'RETURNED',
}

const lastDigits = (phone: string) => phone.replace(/\D/g, '').slice(-9)

/** How far back a delivery may match a web order by phone number. */
const MATCH_DAYS = 30

/** Copies a delivery's status onto the web order(s) linked to it. Never throws. */
export async function syncDeliveryToOrders(deliveryId: string, statut: delivery_status): Promise<void> {
  if (!storefrontConfigured()) return
  try {
    await storefrontDb().orderRequest.updateMany({
      where: { erpDeliveryId: deliveryId },
      data:  { shippingStatus: SHIPPING_OF[statut], shippingUpdatedAt: new Date() },
    })
  } catch (err) {
    console.error('[shipping] sync failed', deliveryId, err)
  }
}

/**
 * A new delivery for the phone number of a confirmed web order that has no
 * delivery yet: links them (the most recent such order). Never throws.
 */
export async function autoLinkDelivery(delivery: { delivery_id: string; client_phone: string; statut: delivery_status }): Promise<string | null> {
  if (!storefrontConfigured()) return null
  try {
    const digits = lastDigits(delivery.client_phone)
    if (digits.length < 9) return null
    const since = new Date(Date.now() - MATCH_DAYS * 86_400_000)
    const orders = await storefrontDb().orderRequest.findMany({
      where:   { status: 'CONFIRMED', erpDeliveryId: null, createdAt: { gte: since } },
      select:  { id: true, customerPhone: true },
      orderBy: { createdAt: 'desc' },
      take:    50,
    })
    const order = orders.find(o => lastDigits(o.customerPhone) === digits)
    if (!order) return null
    await linkOrderToDelivery(order.id, delivery.delivery_id, delivery.statut)
    return order.id
  } catch (err) {
    console.error('[shipping] auto-link failed', delivery.delivery_id, err)
    return null
  }
}

/** Links (or, with null, unlinks) a web order and a delivery, copying the delivery's current status. */
export async function linkOrderToDelivery(orderId: string, deliveryId: string | null, statut?: delivery_status): Promise<void> {
  if (!deliveryId) {
    await storefrontDb().orderRequest.update({
      where: { id: orderId },
      data:  { erpDeliveryId: null, shippingStatus: null, shippingUpdatedAt: new Date() },
    })
    return
  }
  const status = statut ?? (await prisma.deliveries.findUnique({ where: { delivery_id: deliveryId }, select: { statut: true } }))?.statut
  if (!status) throw new Error('Livraison introuvable')
  await storefrontDb().orderRequest.update({
    where: { id: orderId },
    data:  { erpDeliveryId: deliveryId, shippingStatus: SHIPPING_OF[status], shippingUpdatedAt: new Date() },
  })
}

/** Deliveries a web order could ship with: same phone number, recent, not deleted (newest first). */
export async function candidateDeliveries(customerPhone: string) {
  const digits = lastDigits(customerPhone)
  const since = new Date(Date.now() - MATCH_DAYS * 86_400_000)
  const rows = await prisma.deliveries.findMany({
    where:   { is_deleted: false, created_at: { gte: since } },
    select:  { delivery_id: true, client_name: true, client_phone: true, statut: true, montant_total: true, created_at: true },
    orderBy: { created_at: 'desc' },
    take:    200,
  })
  return rows
    .filter(d => lastDigits(d.client_phone) === digits)
    .map(d => ({ id: d.delivery_id, name: d.client_name, statut: d.statut, total: Number(d.montant_total), createdAt: d.created_at }))
}
