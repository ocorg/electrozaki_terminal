import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { logActivity } from '@/lib/utils/logger'
import { site, orderRef, phonesForRef } from '@/lib/storefront/access'
import { receiptViewUrl } from '@/lib/storefront/storage'

type Ctx = { params: { id: string } }

// GET — one order with, for each phone line, the ERP phone(s) it points to
// and a 5-minute link to the customer's receipt.
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    await requireUser()
    const order = await site().orderRequest.findUnique({
      where:   { id: params.id },
      include: { items: { include: { product: { select: { slug: true, isPhone: true } } } }, promoCode: { select: { code: true } } },
    })
    if (!order) throw new HttpError(404, 'Commande introuvable')

    const items = await Promise.all(order.items.map(async item => {
      if (!item.unitRef) return { ...item, erpPhones: [] }
      const ids    = await phonesForRef(item.unitRef)
      const phones = ids.length
        ? await prisma.phones.findMany({
            where:  { phone_id: { in: ids } },
            select: { phone_id: true, marque: true, model: true, stockage: true, couleur: true, battery_level: true, status: true, imei: true },
          })
        : []
      return {
        ...item,
        // Staff identify the unit by the end of its IMEI, as on the POS.
        erpPhones: phones.map(({ imei, ...p }) => ({ ...p, imei_end: imei ? imei.slice(-4) : null })),
      }
    }))

    return json({
      data: {
        ...order,
        ref:        orderRef(order.id),
        receiptKey: undefined,
        receiptUrl: order.receiptKey ? await receiptViewUrl(order.receiptKey) : null,
        receiptIsPdf: order.receiptKey?.endsWith('.pdf') ?? false,
        items,
      },
    })
  } catch (err) {
    return handleError(err, 'GET /api/site/orders/[id]')
  }
}

// CONFIRMED / CANCELLED go through ./reserve and ./release, which also
// reserve / free the phones in the ERP.
const STATUSES  = ['NEW', 'CONTACTED'] as const
const PAYMENTS  = ['VERIFIED', 'REJECTED'] as const

// PATCH { status?, advancePaymentStatus? } — follow-up (all staff); verifying
// the 300 DH advance is money, so managers only.
async function PATCH_(request: NextRequest, { params }: Ctx) {
  try {
    const body: { status?: string; advancePaymentStatus?: string } = await request.json()
    const user = await requireActiveUser(body.advancePaymentStatus ? MANAGERS : undefined)

    const data: { status?: (typeof STATUSES)[number]; advancePaymentStatus?: (typeof PAYMENTS)[number] } = {}
    if (body.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(body.status)) throw new HttpError(400, 'Statut invalide')
      data.status = body.status as (typeof STATUSES)[number]
    }
    if (body.advancePaymentStatus !== undefined) {
      if (!(PAYMENTS as readonly string[]).includes(body.advancePaymentStatus)) throw new HttpError(400, 'Statut de paiement invalide')
      data.advancePaymentStatus = body.advancePaymentStatus as (typeof PAYMENTS)[number]
    }
    if (!Object.keys(data).length) throw new HttpError(400, 'Rien à modifier')

    const before = await site().orderRequest.findUnique({ where: { id: params.id }, select: { status: true, advancePaymentStatus: true } })
    if (!before) throw new HttpError(404, 'Commande introuvable')
    const after = await site().orderRequest.update({ where: { id: params.id }, data, select: { status: true, advancePaymentStatus: true } })

    await logActivity({
      store_id: user.store_id ?? null, user_id: user.id, user_name: user.display_name,
      action_type: 'modification', module: 'site_web', record_id: orderRef(params.id),
      before_state: before, after_state: after,
      notes: `Commande web ${orderRef(params.id)} mise à jour`,
    })
    return json({ ok: true, data: after })
  } catch (err) {
    return handleError(err, 'PATCH /api/site/orders/[id]')
  }
}

export const PATCH = withNotify(PATCH_)
