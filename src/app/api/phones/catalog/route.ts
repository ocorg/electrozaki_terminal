import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { modelNameProblem, colourLooksEnglish } from '@/lib/phoneNaming'

// The catalogue is the reference the phone form offers (owner, 2026-10-29):
// brand + model ("iPhone …" for Apple), colours in French.
function checkNaming(marque: string, model: string, couleur: string) {
  const problem = modelNameProblem(marque, model)
  if (problem) throw new HttpError(400, problem)
  if (colourLooksEnglish(couleur)) throw new HttpError(400, 'Couleur : tapez-la en français (ex. Noir, Bleu Ciel, Argent)')
}

export async function GET() {
  try {
    await requireUser()
    const data = await prisma.phone_catalog.findMany({ orderBy: [{ marque: 'asc' }, { model: 'asc' }] })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/phones/catalog')
  }
}

async function POST_(request: NextRequest) {
  try {
    await requireActiveUser(MANAGERS)
    const body = await request.json()
    if (!body.marque || !body.model || !body.couleur) throw new HttpError(400, 'marque, model et couleur obligatoires')
    checkNaming(String(body.marque), String(body.model).trim(), String(body.couleur).trim())

    const data = await prisma.phone_catalog.create({
      data: { marque: body.marque, serie: body.serie || '', type: body.type || 'Normal', model: body.model, couleur: body.couleur },
    })
    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/phones/catalog')
  }
}

async function DELETE_(request: NextRequest) {
  try {
    await requireActiveUser(MANAGERS)
    const { catalog_id } = await request.json()
    if (!catalog_id) throw new HttpError(400, 'catalog_id requis')
    await prisma.phone_catalog.delete({ where: { catalog_id } })
    return json({ message: 'deleted' })
  } catch (err) {
    return handleError(err, 'DELETE /api/phones/catalog')
  }
}

async function PATCH_(request: NextRequest) {
  try {
    await requireActiveUser(MANAGERS)
    const { catalog_id, marque, serie, type, model, couleur } = await request.json()
    if (!catalog_id) throw new HttpError(400, 'catalog_id requis')
    if (!marque || !model || !couleur) throw new HttpError(400, 'marque, model, couleur obligatoires')
    checkNaming(String(marque), String(model).trim(), String(couleur).trim())

    await prisma.phone_catalog.update({
      where: { catalog_id },
      data:  { marque, serie: serie || '', type: type || 'Normal', model, couleur },
    })
    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'PATCH /api/phones/catalog')
  }
}

export const POST = withNotify(POST_)
export const DELETE = withNotify(DELETE_)
export const PATCH = withNotify(PATCH_)
