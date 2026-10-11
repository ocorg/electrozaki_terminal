import { NextRequest } from 'next/server'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { withNotify } from '@/lib/realtime'
import { site, logSite, refreshSite, text } from '@/lib/storefront/access'
import { slugify } from '@/lib/storefront/listing'

// The website's product checklist ("fiches"): groups such as Style or
// Protection, their options, and the aisles each group describes. Staff tick
// the options per product (PUT /api/site/catalog/[id]/facets); the website
// builds an aisle's guided choice and filters from them. Managers only.

const DISPLAYS = ['CHIPS', 'TILES', 'METER'] as const
type Display = typeof DISPLAYS[number]

// Names the website's catalogue already uses in its page addresses: a group
// can't take one of them as its key (lib/facets.ts on the website).
const RESERVED = new Set(['brand', 'condition', 'minbattery', 'maxprice', 'storage', 'type', 'fits', 'q', 'promo', 'sort', 'page', 'budget'])

async function freeGroupKey(name: string) {
  const base = slugify(name)
  for (let n = 1; ; n++) {
    const key = n === 1 ? base : `${base}-${n}`
    if (RESERVED.has(key)) continue
    if (!(await site().facetGroup.findUnique({ where: { key }, select: { id: true } }))) return key
  }
}

async function freeOptionKey(groupId: string, name: string) {
  const base = slugify(name)
  for (let n = 1; ; n++) {
    const key = n === 1 ? base : `${base}-${n}`
    if (!(await site().facetOption.findUnique({ where: { groupId_key: { groupId, key } }, select: { id: true } }))) return key
  }
}

function displayOf(value: unknown): Display {
  if (!DISPLAYS.includes(value as Display)) throw new HttpError(400, 'Affichage invalide')
  return value as Display
}

function levelOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new HttpError(400, 'Niveau invalide (1 à 5)')
  return n
}

async function categoryIdsOf(value: unknown): Promise<string[]> {
  if (!Array.isArray(value) || value.length > 40) throw new HttpError(400, 'Rayons invalides')
  const ids = Array.from(new Set(value.map(String)))
  const found = await site().category.count({ where: { id: { in: ids } } })
  if (found !== ids.length) throw new HttpError(400, 'Un des rayons est introuvable')
  return ids
}

// GET — every group with its options (and how many products carry each).
export async function GET() {
  try {
    await requireUser(MANAGERS)
    const groups = await site().facetGroup.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true, key: true, name: true, question: true, multi: true, display: true, sortOrder: true, active: true,
        categories: { select: { categoryId: true } },
        options: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, key: true, name: true, level: true, sortOrder: true, active: true, _count: { select: { products: true } } },
        },
      },
    })
    return json({
      data: groups.map(({ categories, options, ...g }) => ({
        ...g,
        categoryIds: categories.map(c => c.categoryId),
        options: options.map(({ _count, ...o }) => ({ ...o, products: _count.products })),
      })),
    })
  } catch (err) {
    return handleError(err, 'GET /api/site/facets')
  }
}

// POST { kind: 'group', name, question?, multi?, display?, sortOrder?, categoryIds }
//      { kind: 'option', groupId, name, level?, sortOrder? }
async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const name = text(body.name, 40)
    if (!name) throw new HttpError(400, 'Le nom est obligatoire')
    const db = site()

    if (body.kind === 'group') {
      const categoryIds = await categoryIdsOf(body.categoryIds ?? [])
      const created = await db.facetGroup.create({
        data: {
          name, key: await freeGroupKey(name), question: text(body.question, 60),
          multi: body.multi !== false, display: displayOf(body.display ?? 'CHIPS'), sortOrder: Number(body.sortOrder) || 0,
          categories: { create: categoryIds.map(categoryId => ({ categoryId })) },
        },
      })
      await logSite(user, 'creation', `Fiche du site : groupe « ${name} » créé`, { record_id: created.id })
      refreshSite()
      return json({ ok: true, data: created }, { status: 201 })
    }

    if (body.kind === 'option') {
      const group = await db.facetGroup.findUnique({ where: { id: String(body.groupId ?? '') }, select: { id: true, name: true, _count: { select: { options: true } } } })
      if (!group) throw new HttpError(404, 'Groupe introuvable')
      if (group._count.options >= 80) throw new HttpError(400, 'Trop de choix dans ce groupe (80 maximum)')
      const created = await db.facetOption.create({
        data: {
          groupId: group.id, name, key: await freeOptionKey(group.id, name), level: levelOf(body.level),
          sortOrder: 'sortOrder' in body ? Number(body.sortOrder) || 0 : group._count.options + 1,
        },
      })
      await logSite(user, 'creation', `Fiche du site : choix « ${name} » ajouté à « ${group.name} »`, { record_id: created.id })
      refreshSite()
      return json({ ok: true, data: created }, { status: 201 })
    }
    throw new HttpError(400, 'Type invalide')
  } catch (err) {
    return handleError(err, 'POST /api/site/facets')
  }
}

// PATCH { kind: 'group', id, name?, question?, multi?, display?, sortOrder?, active?, categoryIds? }
//       { kind: 'option', id, name?, level?, sortOrder?, active? }
// The key (the word used in the website's addresses) never changes: links
// already shared keep working after a rename.
async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const id   = String(body.id ?? '')
    const db   = site()
    const data: Record<string, unknown> = {}
    if ('name' in body) {
      const name = text(body.name, 40)
      if (!name) throw new HttpError(400, 'Le nom est obligatoire')
      data.name = name
    }
    if ('sortOrder' in body) data.sortOrder = Number(body.sortOrder) || 0
    if ('active' in body)    data.active    = body.active === true

    if (body.kind === 'group') {
      const before = await db.facetGroup.findUnique({ where: { id } })
      if (!before) throw new HttpError(404, 'Groupe introuvable')
      if ('question' in body) data.question = text(body.question, 60)
      if ('multi' in body)    data.multi    = body.multi === true
      if ('display' in body)  data.display  = displayOf(body.display)
      const categoryIds = 'categoryIds' in body ? await categoryIdsOf(body.categoryIds) : null
      const after = await db.$transaction(async tx => {
        if (categoryIds) {
          await tx.facetGroupCategory.deleteMany({ where: { groupId: id } })
          await tx.facetGroupCategory.createMany({ data: categoryIds.map(categoryId => ({ groupId: id, categoryId })) })
        }
        return tx.facetGroup.update({ where: { id }, data })
      })
      await logSite(user, 'modification', `Fiche du site : groupe « ${after.name} » modifié`, { record_id: id, before_state: before, after_state: after })
      refreshSite()
      return json({ ok: true, data: after })
    }

    if (body.kind === 'option') {
      const before = await db.facetOption.findUnique({ where: { id } })
      if (!before) throw new HttpError(404, 'Choix introuvable')
      if ('level' in body) data.level = levelOf(body.level)
      const after = await db.facetOption.update({ where: { id }, data })
      await logSite(user, 'modification', `Fiche du site : choix « ${after.name} » modifié`, { record_id: id, before_state: before, after_state: after })
      refreshSite()
      return json({ ok: true, data: after })
    }
    throw new HttpError(400, 'Type invalide')
  } catch (err) {
    return handleError(err, 'PATCH /api/site/facets')
  }
}

// DELETE { kind, id } — only what no product carries. A choice that is in
// use is retired instead (PATCH active: false): products keep their ticks.
async function DELETE_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const id   = String(body.id ?? '')
    const db   = site()

    if (body.kind === 'option') {
      const option = await db.facetOption.findUnique({ where: { id }, include: { _count: { select: { products: true } } } })
      if (!option) throw new HttpError(404, 'Choix introuvable')
      if (option._count.products) throw new HttpError(409, `${option._count.products} produit(s) portent ce choix : désactivez-le plutôt`)
      await db.facetOption.delete({ where: { id } })
      await logSite(user, 'suppression', `Fiche du site : choix « ${option.name} » supprimé`, { record_id: id })
    } else if (body.kind === 'group') {
      const group = await db.facetGroup.findUnique({ where: { id }, select: { name: true } })
      if (!group) throw new HttpError(404, 'Groupe introuvable')
      const used = await db.productFacet.count({ where: { option: { groupId: id } } })
      if (used) throw new HttpError(409, 'Des produits portent des choix de ce groupe : désactivez-le plutôt')
      await db.facetGroup.delete({ where: { id } })
      await logSite(user, 'suppression', `Fiche du site : groupe « ${group.name} » supprimé`, { record_id: id })
    } else {
      throw new HttpError(400, 'Type invalide')
    }
    refreshSite()
    return json({ ok: true })
  } catch (err) {
    return handleError(err, 'DELETE /api/site/facets')
  }
}

export const POST   = withNotify(POST_)
export const PATCH  = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
