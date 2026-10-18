// Website orders to call back (owner, 2026-10-18): a parcel can't always
// leave at once (the delivery company's rounds), so the customer is called
// again before they give up. Three reasons, one rule for the "Commandes web"
// screen and the 11 am Telegram message:
//   • promesse — the delivery date promised at checkout is today or past, and
//     the order is not delivered: warn the customer, give a new date
//   • attente  — ordered WAIT_DAYS ago or more, confirmed, and the parcel hasn't left:
//     tell the customer when it goes
//   • rappel   — a "Rappeler le …" date set by staff has come (with its note)
// Cancelled, delivered or returned orders are never called back.
import { prisma } from '@/lib/db'
import { site, orderRef } from '@/lib/storefront/access'
import { storefrontConfigured } from '@/lib/storefront/db'
import { businessDate } from '@/lib/time'

export const WAIT_DAYS = 2
const NOT_LEFT = ['CONFIRMING', 'AWAITING_ADVANCE', 'PREPARING']
const OVER     = ['DELIVERED', 'CANCELLED', 'RETURNED']

export type CallReason = 'promesse' | 'attente' | 'rappel'

export interface FollowupInfo { relance_le: string; note: string | null }

interface OrderLike {
  id: string; status: string; createdAt: Date; deliveryEstimate: Date | null; shippingStatus: string | null
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
/** Whole days since the order was placed. */
export const daysSince = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000)

/** Why this order's customer should be called today, or null. */
export function callReason(o: OrderLike, followup: FollowupInfo | null | undefined, today = businessDate()): CallReason | null {
  if (o.status === 'CANCELLED' || (o.shippingStatus && OVER.includes(o.shippingStatus))) return null
  if (followup && followup.relance_le <= today) return 'rappel'
  if (o.status !== 'CONFIRMED') return null
  if (o.deliveryEstimate && iso(o.deliveryEstimate) <= today) return 'promesse'
  if (daysSince(o.createdAt) >= WAIT_DAYS && (!o.shippingStatus || NOT_LEFT.includes(o.shippingStatus))) return 'attente'
  return null
}

/** Open follow-ups (not done yet), by order id. */
export async function openFollowups(orderIds?: string[]) {
  const rows = await prisma.web_order_followups.findMany({
    where:  { done_at: null, ...(orderIds && { order_id: { in: orderIds } }) },
    select: { order_id: true, relance_le: true, note: true },
  })
  return new Map(rows.map(r => [r.order_id, { relance_le: iso(r.relance_le), note: r.note } as FollowupInfo]))
}

/** The web orders whose customer to call today, oldest first. Empty when the website is not set up. */
export async function ordersToCall() {
  if (!storefrontConfigured()) return []
  const since  = new Date(Date.now() - 60 * 86_400_000)
  const orders = await site().orderRequest.findMany({
    where:   { status: { in: ['NEW', 'CONTACTED', 'CONFIRMED'] }, createdAt: { gte: since } },
    select:  { id: true, status: true, createdAt: true, deliveryEstimate: true, shippingStatus: true, customerName: true, customerPhone: true,
               deliveryCity: true, items: { select: { productNameSnapshot: true, quantity: true, isGift: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const followups = await openFollowups(orders.map(o => o.id))
  const today = businessDate()
  return orders
    .map(o => ({ ...o, ref: orderRef(o.id), reason: callReason(o, followups.get(o.id), today), followup: followups.get(o.id) ?? null,
                 days: daysSince(o.createdAt) }))
    .filter(o => o.reason)
}
