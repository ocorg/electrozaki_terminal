import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, requireFields, dateOnly, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { notifyCaisseChange } from '@/lib/realtime'

export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const store_id  = searchParams.get('store_id')
    const date_from = searchParams.get('date_from')
    const date_to   = searchParams.get('date_to')
    const categorie = searchParams.get('categorie')
    if (!store_id) throw new HttpError(400, 'store_id requis')

    const data = await prisma.expenses.findMany({
      where: {
        store_id,
        is_deleted: false,
        ...(categorie && { categorie }),
        ...((date_from || date_to) && { date: { gte: dateOnly(date_from), lte: dateOnly(date_to) } }),
      },
      orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/expenses')
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    requireFields(body, ['montant', 'categorie'])
    const montant = Number(body.montant)
    if (!(montant > 0)) throw new HttpError(400, 'Montant invalide')

    const { category, ...data } = await prisma.expenses.create({
      data: {
        categorie:         body.categorie,
        montant,
        date:              dateOnly(body.date),
        fournisseur_id:    body.fournisseur_id    || null,
        facture_ref:       body.facture_ref       || null,
        notes:             body.notes             || null,
        receipt_photo_url: body.receipt_photo_url || null,
        store_id:          body.store_id ?? user.store_id ?? null,
        created_by:        user.id,
        updated_by:        user.id,
      },
      include: { category: { select: { label_fr: true } } },
    })

    await logActivity({
      store_id:    data.store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'depenses',
      record_id:   data.exp_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `${category.label_fr} — ${montant} MAD`,
    })
    await notifyCaisseChange(data.store_id)

    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/expenses')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const exp_id = new URL(request.url).searchParams.get('exp_id')
    if (!exp_id) throw new HttpError(400, 'exp_id requis')

    const before = await prisma.expenses.findUniqueOrThrow({ where: { exp_id } })
    await prisma.expenses.update({
      where: { exp_id },
      data:  { is_deleted: true, updated_by: user.id },
    })

    await logActivity({
      store_id:     before.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'suppression',
      module:       'depenses',
      record_id:    exp_id,
      before_state: before,
      ip_address:   getIpFromRequest(request),
    })
    await notifyCaisseChange(before.store_id)

    return json({ success: true })
  } catch (err) {
    return handleError(err, 'DELETE /api/expenses')
  }
}
