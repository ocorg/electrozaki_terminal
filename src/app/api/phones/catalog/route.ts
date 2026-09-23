import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError } from '@/lib/api'

export async function GET() {
  try {
    await requireUser()
    const data = await prisma.phone_catalog.findMany({ orderBy: [{ marque: 'asc' }, { model: 'asc' }] })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/phones/catalog')
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireActiveUser()
    const body = await request.json()
    if (!body.marque || !body.model || !body.couleur) throw new HttpError(400, 'marque, model et couleur obligatoires')

    const data = await prisma.phone_catalog.create({
      data: { marque: body.marque, serie: body.serie || '', type: body.type || 'Normal', model: body.model, couleur: body.couleur },
    })
    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/phones/catalog')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireActiveUser()
    const { catalog_id } = await request.json()
    if (!catalog_id) throw new HttpError(400, 'catalog_id requis')
    await prisma.phone_catalog.delete({ where: { catalog_id } })
    return json({ message: 'deleted' })
  } catch (err) {
    return handleError(err, 'DELETE /api/phones/catalog')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireActiveUser()
    const { catalog_id, marque, serie, type, model, couleur } = await request.json()
    if (!catalog_id) throw new HttpError(400, 'catalog_id requis')
    if (!marque || !model || !couleur) throw new HttpError(400, 'marque, model, couleur obligatoires')

    await prisma.phone_catalog.update({
      where: { catalog_id },
      data:  { marque, serie: serie || '', type: type || 'Normal', model, couleur },
    })
    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'PATCH /api/phones/catalog')
  }
}
