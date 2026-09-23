import { NextRequest } from 'next/server'
import type { category_type, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { toCode } from '@/lib/codes'
import { withNotify } from '@/lib/realtime'

export interface CategoryItem { code: string; fr: string; ar: string }
type CatGroup = 'accessories' | 'expenses' | 'suppliers'

const GROUP_TYPE: Record<CatGroup, category_type> = {
  accessories: 'accessoire',
  expenses:    'depense',
  suppliers:   'fournisseur',
}

export async function GET() {
  try {
    await requireUser()
    const rows = await prisma.categories.findMany({ orderBy: [{ type: 'asc' }, { sort_order: 'asc' }] })
    const group = (type: category_type): CategoryItem[] =>
      rows.filter(r => r.type === type).map(r => ({ code: r.code, fr: r.label_fr, ar: r.label_ar }))
    return json({
      accessories: group('accessoire'),
      expenses:    group('depense'),
      suppliers:   group('fournisseur'),
    })
  } catch (err) {
    return handleError(err, 'GET /api/categories')
  }
}

async function freeCode(tx: Prisma.TransactionClient, label: string) {
  const base = toCode(label) || 'categorie'
  for (let n = 1; ; n++) {
    const code = n === 1 ? base : `${base}_${n}`
    if (!(await tx.categories.findUnique({ where: { code } }))) return code
  }
}

// POST { type, categories: [{ code?, fr, ar }] } — saves the full ordered list for one group.
async function POST_(request: NextRequest) {
  try {
    await requireActiveUser(MANAGERS)
    const body: { type: CatGroup; categories: Partial<CategoryItem>[] } = await request.json()

    const type = GROUP_TYPE[body.type]
    if (!type) throw new HttpError(400, 'Type invalide')
    if (!Array.isArray(body.categories) || body.categories.length === 0) {
      throw new HttpError(400, 'Au moins une catégorie requise')
    }
    if (body.categories.some(c => !c.fr?.trim() || !c.ar?.trim())) {
      throw new HttpError(400, 'Chaque catégorie doit avoir un nom FR et AR')
    }

    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.categories.findMany({ where: { type } })
      const kept = new Set<string>()

      for (let i = 0; i < body.categories.length; i++) {
        const c = body.categories[i]
        const labels = { label_fr: c.fr!.trim(), label_ar: c.ar!.trim(), sort_order: i }
        if (c.code && existing.some(e => e.code === c.code)) {
          await tx.categories.update({ where: { code: c.code }, data: labels })
          kept.add(c.code)
        } else {
          const code = await freeCode(tx, labels.label_fr)
          await tx.categories.create({ data: { code, type, ...labels } })
          kept.add(code)
        }
      }

      const removed = existing.filter(e => !kept.has(e.code))
      if (removed.length) {
        const codes = removed.map(r => r.code)
        const where = { categorie: { in: codes } }
        const [acc, exp, sup] = await Promise.all([
          tx.accessories.findMany({ where, select: { categorie: true }, distinct: ['categorie'] }),
          tx.expenses.findMany({ where, select: { categorie: true }, distinct: ['categorie'] }),
          tx.suppliers.findMany({ where, select: { categorie: true }, distinct: ['categorie'] }),
        ])
        const inUse = new Set([...acc, ...exp, ...sup].map(r => r.categorie))
        if (inUse.size) {
          const names = removed.filter(r => inUse.has(r.code)).map(r => r.label_fr).join(', ')
          throw new HttpError(409, `Catégorie encore utilisée, impossible de la supprimer : ${names}`)
        }
        await tx.categories.deleteMany({ where: { code: { in: codes } } })
      }

      return tx.categories.findMany({ where: { type }, orderBy: { sort_order: 'asc' } })
    })

    return json({
      status: 'success',
      categories: saved.map(r => ({ code: r.code, fr: r.label_fr, ar: r.label_ar })),
    })
  } catch (err) {
    return handleError(err, 'POST /api/categories')
  }
}

export const POST = withNotify(POST_)
