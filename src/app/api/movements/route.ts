import { NextRequest } from 'next/server'
import type { Prisma, device_status, device_type, location_type, movement_reason } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { codeLabel } from '@/lib/codes'
import { withNotify } from '@/lib/realtime'

export async function GET(request: NextRequest) {
  try {
    await requireUser(MANAGERS)
    const { searchParams } = new URL(request.url)
    const store_id    = searchParams.get('store_id')
    const device_type = searchParams.get('device_type') as device_type | null
    const limit       = Math.min(Number(searchParams.get('limit') || 50), 500)

    const data = await prisma.stock_movements.findMany({
      where:   { ...(store_id && { store_id }), ...(device_type && { device_type }) },
      orderBy: { created_at: 'desc' },
      take:    limit,
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/movements')
  }
}

// Status a phone takes when it moves for a given reason
function phoneStatusFor(reason: movement_reason, to: location_type, toStoreId: string | null): device_status {
  if (reason === 'retour')             return 'disponible'
  if (reason === 'reparation_externe') return 'en_reparation'
  if (reason === 'pret' || to === 'externe' || toStoreId !== null) return 'en_transfert'
  return 'disponible'
}

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS) // only manager/owner can move stock
    const body = await request.json()
    if (!body.device_id || !body.device_type || !body.from_location || !body.to_location) {
      throw new HttpError(400, 'Champs requis manquants')
    }
    if (body.from_location === body.to_location) throw new HttpError(400, 'Source et destination identiques')

    const deviceType = body.device_type as device_type
    const from       = body.from_location as location_type
    const to         = body.to_location as location_type
    const reason     = (body.reason ?? 'transfert') as movement_reason
    const toStoreId  = (body.to_store_id as string | null) ?? null

    const data = await prisma.$transaction(async (tx) => {
      // Accessories are the only type that can move a PARTIAL quantity (phones/laptops are
      // unique serialized items). Validate before writing anything.
      let movedQty = 1
      const srcAcc = deviceType === 'accessoire'
        ? await tx.accessories.findUnique({ where: { acc_id: body.device_id } })
        : null
      if (deviceType === 'accessoire') {
        if (!srcAcc) throw new HttpError(404, 'Accessoire introuvable')
        movedQty = Math.max(1, Math.floor(Number(body.quantity) || 1))
        if (movedQty > srcAcc.quantite) throw new HttpError(400, `Quantité insuffisante — disponible : ${srcAcc.quantite}`)
      }

      const movement = await tx.stock_movements.create({
        data: {
          device_type:   deviceType,
          device_id:     String(body.device_id),
          quantity:      movedQty,
          from_location: from,
          to_location:   to,
          external_name: body.external_name ?? null,
          reason,
          store_id:      body.store_id ?? user.store_id ?? null,
          notes:         body.notes ?? null,
          moved_by:      user.id,
          moved_at:      new Date(),
          created_by:    user.id,
        },
      })

      if (deviceType === 'telephone') {
        await tx.phones.update({
          where: { phone_id: movement.device_id },
          data:  { location: to, status: phoneStatusFor(reason, to, toStoreId), updated_by: user.id, ...(toStoreId && { store_id: toStoreId }) },
        })
      } else if (deviceType === 'laptop') {
        await tx.laptops.update({
          where: { laptop_id: movement.device_id },
          data:  { location: to, updated_by: user.id, ...(toStoreId && { store_id: toStoreId }) },
        })
      } else if (srcAcc) {
        const destStoreId = toStoreId ?? srcAcc.store_id
        if (movedQty >= srcAcc.quantite) {
          // Moving everything — relocate the existing row in place
          await tx.accessories.update({ where: { acc_id: srcAcc.acc_id }, data: { location: to, store_id: destStoreId, updated_by: user.id } })
        } else {
          // Partial move: decrement the source, then merge into the same SKU at the
          // destination or create it there.
          await tx.accessories.update({ where: { acc_id: srcAcc.acc_id }, data: { quantite: { decrement: movedQty }, updated_by: user.id } })
          const destMatch = await tx.accessories.findFirst({
            where: {
              location: to, is_deleted: false, nom: srcAcc.nom, categorie: srcAcc.categorie,
              marque: srcAcc.marque, store_id: destStoreId, acc_id: { not: srcAcc.acc_id },
            },
          })
          if (destMatch) {
            await tx.accessories.update({ where: { acc_id: destMatch.acc_id }, data: { quantite: { increment: movedQty }, updated_by: user.id } })
          } else {
            // barcode is unique: leave it empty so the database assigns the new row's own
            await tx.accessories.create({
              data: {
                nom: srcAcc.nom, categorie: srcAcc.categorie, marque: srcAcc.marque,
                compatible_with: srcAcc.compatible_with, prix_achat: srcAcc.prix_achat,
                prix_vente_recommande: srcAcc.prix_vente_recommande, prix_vente_minimum: srcAcc.prix_vente_minimum,
                seuil_alerte: srcAcc.seuil_alerte, quantite: movedQty, location: to, store_id: destStoreId,
                created_by: user.id, updated_by: user.id,
              } satisfies Prisma.accessoriesUncheckedCreateInput,
            })
          }
        }
      }
      return movement
    })

    await logActivity({
      store_id:    data.store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'modification',
      module:      'mouvements_stock',
      record_id:   data.movement_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `${data.device_id} : ${codeLabel('location_type', from, 'fr')} → ${codeLabel('location_type', to, 'fr')}`,
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/movements')
  }
}

export const POST = withNotify(POST_)
