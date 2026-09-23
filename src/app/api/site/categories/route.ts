import { NextRequest } from 'next/server'
import { json, handleError, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite, text } from '@/lib/storefront/access'
import { slugify } from '@/lib/storefront/listing'

// The website's menu categories (listed by GET /api/site/catalog). Synced
// products are filed automatically by their ERP category; staff can rename,
// reorder and nest them here. Managers only.

async function freeSlug(name: string, exceptId?: string) {
  const base = slugify(name)
  for (let n = 1; ; n++) {
    const slug  = n === 1 ? base : `${base}-${n}`
    const taken = await site().category.findUnique({ where: { slug }, select: { id: true } })
    if (!taken || taken.id === exceptId) return slug
  }
}

async function parentFor(value: unknown, selfId?: string) {
  if (value === null || value === undefined || value === '') return null
  const parent = await site().category.findUnique({ where: { id: String(value) }, select: { id: true, parentId: true } })
  if (!parent || parent.id === selfId) throw new HttpError(400, 'Catégorie parente invalide')
  if (parent.parentId) throw new HttpError(400, 'Un seul niveau de sous-catégories')
  return parent.id
}

// POST { name, parentId?, sortOrder? }
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const name = text(body.name, 60)
    if (!name) throw new HttpError(400, 'Le nom est obligatoire')
    const created = await site().category.create({
      data: { name, slug: await freeSlug(name), parentId: await parentFor(body.parentId), sortOrder: Number(body.sortOrder) || 0 },
    })
    await logSite(user, 'creation', `Catégorie du site « ${name} » créée`, { record_id: created.id })
    refreshSite()
    return json({ ok: true, data: created }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/site/categories')
  }
}

// PATCH { id, name?, parentId?, sortOrder? }
async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const id   = String(body.id ?? '')
    const before = await site().category.findUnique({ where: { id }, include: { _count: { select: { children: true } } } })
    if (!before) throw new HttpError(404, 'Catégorie introuvable')

    const data: { name?: string; slug?: string; parentId?: string | null; sortOrder?: number } = {}
    if ('name' in body) {
      const name = text(body.name, 60)
      if (!name) throw new HttpError(400, 'Le nom est obligatoire')
      data.name = name
    }
    if ('parentId' in body) {
      data.parentId = await parentFor(body.parentId, id)
      if (data.parentId && before._count.children) throw new HttpError(400, 'Cette catégorie a déjà des sous-catégories')
    }
    if ('sortOrder' in body) data.sortOrder = Number(body.sortOrder) || 0
    // The URL (slug) is kept as is: links already shared keep working.

    const after = await site().category.update({ where: { id }, data })
    await logSite(user, 'modification', `Catégorie du site « ${after.name} » modifiée`, { record_id: id, before_state: before, after_state: after })
    refreshSite()
    return json({ ok: true, data: after })
  } catch (err) {
    return handleError(err, 'PATCH /api/site/categories')
  }
}

// DELETE { id } — only an empty category.
async function DELETE_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const { id } = await request.json()
    const category = await site().category.findUnique({
      where: { id: String(id) }, include: { _count: { select: { products: true, children: true } } },
    })
    if (!category) throw new HttpError(404, 'Catégorie introuvable')
    if (category._count.products || category._count.children) {
      throw new HttpError(409, 'Catégorie non vide : déplacez ses produits et sous-catégories avant de la supprimer')
    }
    if (category.erpCode) throw new HttpError(409, 'Catégorie liée au stock ERP : elle serait recréée à la prochaine synchronisation')
    await site().category.delete({ where: { id: category.id } })
    await logSite(user, 'suppression', `Catégorie du site « ${category.name} » supprimée`, { record_id: category.id })
    refreshSite()
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'DELETE /api/site/categories')
  }
}

export const POST   = withNotify(POST_)
export const PATCH  = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
