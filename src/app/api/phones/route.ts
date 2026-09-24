import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, pickInput, todayDate, HttpError, MANAGERS, isManager } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { validateRequired, sanitizeText } from '@/lib/utils/validation'
import { withNotify } from '@/lib/realtime'

// Hidden from staff: purchase price, iCloud password, settlement and audit fields
const STAFF_OMIT = {
  icloud_mdp: true, prix_achat: true, created_by: true, updated_by: true,
  is_deleted: true, settled_at: true, settled_by: true,
} as const

const EDITABLE = [
  'imei', 'source', 'fournisseur_id', 'txn_ref_id', 'condition',
  'marque', 'serie', 'type', 'couleur', 'model', 'stockage',
  'battery_level', 'ram', 'description', 'icloud_compte', 'icloud_mdp',
  'prix_achat', 'prix_vente_recommande', 'prix_vente_minimum',
  'warranty_months', 'status', 'location', 'date_entree', 'image_url',
  'replaced_components', 'is_damaged', 'damage_notes',
  'promo_type', 'promo_montant',
] as const

const clean = (v: unknown) => (typeof v === 'string' ? sanitizeText(v) : v)

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()
    const { searchParams } = new URL(request.url)
    const status         = searchParams.get('status') as Prisma.phonesWhereInput['status']
    const marque         = searchParams.get('marque')
    const location       = searchParams.get('location') as Prisma.phonesWhereInput['location']
    const stockage       = searchParams.get('stockage')
    const promo          = searchParams.get('promo')
    const search         = searchParams.get('search')?.trim()
    const store_id       = searchParams.get('store_id')
    const fournisseur_id = searchParams.get('fournisseur_id')
    const limit          = Math.min(parseInt(searchParams.get('limit') || '200', 10), 5000)

    const where: Prisma.phonesWhereInput = {
      is_deleted: false,
      ...(store_id       && { store_id }),
      ...(status         && { status }),
      ...(marque         && { marque: { contains: marque, mode: 'insensitive' } }),
      ...(location       && { location }),
      ...(stockage       && { stockage }),
      ...(fournisseur_id && { fournisseur_id }),
      ...(promo === '1'  && { promo_type: { not: null } }),
    }
    if (search) {
      where.OR = /^\d{6,}$/.test(search)
        ? [{ imei: { contains: search } }]
        : [{ model: { contains: search, mode: 'insensitive' } }, { marque: { contains: search, mode: 'insensitive' } }]
    }

    const data = await prisma.phones.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take:    limit,
      ...(!MANAGERS.includes(user.role) && { omit: STAFF_OMIT }),
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/phones')
  }
}

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json() as Record<string, unknown>
    // Staff may only add the phone a customer traded in at the POS (its
    // value was part of the sale they just made); any other stock entry is
    // a manager's job.
    if (!isManager(user.role) && body.source !== 'echange') {
      throw new HttpError(403, "Réservé aux gérants : l'ajout de téléphones au stock")
    }
    validateRequired(body, ['marque', 'model', 'status'])

    const input = pickInput('phones', body, EDITABLE)
    const data = await prisma.phones.create({
      data: {
        ...(input as Prisma.phonesUncheckedCreateInput),
        marque:      clean(input.marque) as string,
        model:       clean(input.model) as string,
        description: clean(input.description) as string | null | undefined,
        date_entree: (input.date_entree as Date | null | undefined) ?? todayDate(),
        store_id:    (body.store_id as string | undefined) ?? user.store_id ?? null,
        created_by:  user.id,
        updated_by:  user.id,
      },
    })

    await logActivity({
      store_id:    data.store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'telephones',
      record_id:   data.phone_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/phones')
  }
}

async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json() as Record<string, unknown>
    const phone_id = body.phone_id as string | undefined
    if (!phone_id) throw new HttpError(400, 'phone_id requis')

    const before = await prisma.phones.findUniqueOrThrow({ where: { phone_id } })
    const data = await prisma.phones.update({
      where: { phone_id },
      data:  { ...pickInput('phones', body, [...EDITABLE, 'store_id']), updated_by: user.id },
    })

    await logActivity({
      store_id:     data.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'modification',
      module:       'telephones',
      record_id:    phone_id,
      before_state: before,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/phones')
  }
}

async function DELETE_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const phone_id = new URL(request.url).searchParams.get('phone_id')
    if (!phone_id) throw new HttpError(400, 'phone_id requis')

    const before = await prisma.phones.findUnique({ where: { phone_id } })
    if (!before) throw new HttpError(404, 'Téléphone introuvable')

    await prisma.phones.update({ where: { phone_id }, data: { is_deleted: true, updated_by: user.id } })

    await logActivity({
      store_id:     before.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'suppression',
      module:       'telephones',
      record_id:    phone_id,
      before_state: before,
      ip_address:   getIpFromRequest(request),
    })

    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'DELETE /api/phones')
  }
}

export const POST = withNotify(POST_)
export const PATCH = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
