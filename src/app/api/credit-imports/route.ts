import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, dateOnly, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

export async function GET(request: NextRequest) {
  try {
    await requireUser(MANAGERS)
    const store_id = new URL(request.url).searchParams.get('store_id')
    const data = await prisma.credit_imports.findMany({
      where:   { ...(store_id && { store_id }) },
      include: { clients: { select: { nom: true, telephone: true } } },
      orderBy: { date_origine: 'desc' },
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/credit-imports')
  }
}

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const { client_id, client_name_free, client_phone_free, store_id, montant_du, description, date_origine, notes } = await request.json()
    if (!(Number(montant_du) > 0)) throw new HttpError(400, 'Montant invalide')
    if (!date_origine) throw new HttpError(400, 'Date requise')
    if (!client_id && !client_name_free) throw new HttpError(400, 'Client requis')

    const data = await prisma.credit_imports.create({
      data: {
        client_id:         client_id ?? null,
        client_name_free:  client_name_free ?? null,
        client_phone_free: client_phone_free ?? null,
        store_id:          store_id ?? user.store_id ?? null,
        montant_du:        Number(montant_du),
        description:       description ?? null,
        date_origine:      dateOnly(date_origine)!,
        notes:             notes ?? null,
        created_by:        user.id,
      },
    })

    await logActivity({
      store_id:    data.store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'credits_importes',
      record_id:   data.import_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
    })

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/credit-imports')
  }
}

// PATCH: retroactively link a free-text import to a real client
async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const { import_id, client_id } = await request.json()
    if (!import_id || !client_id) throw new HttpError(400, 'import_id et client_id requis')

    const data = await prisma.credit_imports.update({ where: { import_id }, data: { client_id } })

    await logActivity({
      store_id:    data.store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'modification',
      module:      'credits_importes',
      record_id:   import_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `Lié au client ${client_id}`,
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/credit-imports')
  }
}

async function DELETE_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    if (user.role !== 'proprietaire') throw new HttpError(403, 'Réservé au propriétaire')
    const import_id = new URL(request.url).searchParams.get('import_id')
    if (!import_id) throw new HttpError(400, 'import_id requis')

    await prisma.credit_imports.delete({ where: { import_id } })
    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'DELETE /api/credit-imports')
  }
}

export const POST = withNotify(POST_)
export const PATCH = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
