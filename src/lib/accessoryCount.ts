import type { Prisma } from '@prisma/client'
import { HttpError } from '@/lib/api'

// Accessory stock count (owner, 2026-11-07, step 4 of the codes plan).
//  - one count open at a time per store, for some or all accessory types;
//  - a scan adds 1 to its line (the article, or the variant its code
//    designates); a naked product gets its number typed;
//  - only the lines counted ("touched") are corrected; the others keep their
//    stock and are listed as not counted;
//  - the gaps are worked out against the stock at that moment (a sale during
//    the count is already out of it), and a manager applies them in one go.
// Line key: '-' = the article itself (its pieces without a variant), else the variant_id.

type Tx = Prisma.TransactionClient

export const ARTICLE_LINE = '-'

export type GapLine = { acc_id: string; nom: string; categorie: string; line_key: string; label: string; expected: number; counted: number | null }

export async function openCount(db: Tx, storeId: string) {
  return db.acc_counts.findFirst({ where: { store_id: storeId, statut: 'en_cours' }, include: { lines: { select: { acc_id: true, line_key: true, counted: true } } } })
}

/** Checks a line belongs to the article (a variant of it, or the article itself). */
async function checkLine(db: Tx, accId: string, lineKey: string) {
  const acc = await db.accessories.findUnique({ where: { acc_id: accId }, select: { is_deleted: true, categorie: true } })
  if (!acc || acc.is_deleted) throw new HttpError(404, 'Accessoire introuvable')
  if (lineKey !== ARTICLE_LINE) {
    const v = await db.accessory_variants.findUnique({ where: { variant_id: lineKey }, select: { acc_id: true } })
    if (!v || v.acc_id !== accId) throw new HttpError(400, 'Variante introuvable pour cet article')
  }
  return acc
}

/** Adds (scan: +1) or sets (typed number) the count of one line. */
export async function countLine(db: Tx, countId: string, accId: string, lineKey: string, op: { add?: number; set?: number }, userId: string) {
  const count = await db.acc_counts.findUnique({ where: { count_id: countId }, select: { statut: true, categories: true } })
  if (!count || count.statut !== 'en_cours') throw new HttpError(409, 'Ce comptage est terminé')
  const acc = await checkLine(db, accId, lineKey)
  if (count.categories.length && !count.categories.includes(acc.categorie)) throw new HttpError(400, 'Ce type ne fait pas partie de ce comptage')
  const where = { count_id_acc_id_line_key: { count_id: countId, acc_id: accId, line_key: lineKey } }
  if (op.set !== undefined) {
    if (!Number.isInteger(op.set) || op.set < 0 || op.set > 100000) throw new HttpError(400, 'Nombre invalide')
    return db.acc_count_lines.upsert({ where, create: { count_id: countId, acc_id: accId, line_key: lineKey, counted: op.set, updated_by: userId }, update: { counted: op.set, updated_by: userId, updated_at: new Date() } })
  }
  const add = op.add ?? 1
  if (!Number.isInteger(add) || add < -1000 || add > 1000) throw new HttpError(400, 'Nombre invalide')
  const line = await db.acc_count_lines.upsert({ where, create: { count_id: countId, acc_id: accId, line_key: lineKey, counted: Math.max(0, add), updated_by: userId }, update: { counted: { increment: add }, updated_by: userId, updated_at: new Date() } })
  if (line.counted < 0) return db.acc_count_lines.update({ where, data: { counted: 0 } })
  return line
}

/** Every line of the count's articles: what the stock says now and what was counted (null = not counted). */
export async function gapsOf(db: Tx, countId: string): Promise<GapLine[]> {
  const count = await db.acc_counts.findUnique({ where: { count_id: countId }, include: { lines: true } })
  if (!count) throw new HttpError(404, 'Comptage introuvable')
  const accs = await db.accessories.findMany({
    where: { store_id: count.store_id, is_deleted: false, ...(count.categories.length && { categorie: { in: count.categories } }), category: { type: 'accessoire' } },
    select: { acc_id: true, nom: true, categorie: true, quantite: true, variants: { select: { variant_id: true, design: true, couleur: true, modeles: true, quantite: true }, orderBy: { variant_id: 'asc' } } },
    orderBy: [{ categorie: 'asc' }, { nom: 'asc' }],
  })
  const counted = new Map(count.lines.map(l => [`${l.acc_id}|${l.line_key}`, l.counted]))
  const out: GapLine[] = []
  for (const a of accs) {
    const inVariants = a.variants.reduce((n, v) => n + v.quantite, 0)
    for (const v of a.variants) {
      out.push({ acc_id: a.acc_id, nom: a.nom, categorie: a.categorie, line_key: v.variant_id, label: [v.design, v.couleur, v.modeles.join(' · ')].filter(Boolean).join(' · '), expected: v.quantite, counted: counted.get(`${a.acc_id}|${v.variant_id}`) ?? null })
    }
    out.push({ acc_id: a.acc_id, nom: a.nom, categorie: a.categorie, line_key: ARTICLE_LINE, label: a.variants.length ? 'sans variante (non réparti)' : '', expected: Math.max(0, a.quantite - inVariants), counted: counted.get(`${a.acc_id}|${ARTICLE_LINE}`) ?? null })
  }
  return out
}

/**
 * Applies the counted lines to the stock: each counted variant takes its
 * count, the article's total becomes its variants + its counted (or kept)
 * pieces without a variant. Lines not counted keep their stock.
 */
export async function applyCount(db: Tx, countId: string, userId: string) {
  const count = await db.acc_counts.findUnique({ where: { count_id: countId }, select: { statut: true } })
  if (!count || count.statut !== 'en_cours') throw new HttpError(409, 'Ce comptage est déjà terminé')
  const lines = await gapsOf(db, countId)
  const changes: { acc_id: string; nom: string; label: string; before: number; after: number }[] = []
  const byAcc = new Map<string, GapLine[]>()
  for (const l of lines) byAcc.set(l.acc_id, [...(byAcc.get(l.acc_id) ?? []), l])
  for (const [accId, ls] of byAcc) {
    if (!ls.some(l => l.counted !== null && l.counted !== l.expected)) continue
    let total = 0
    for (const l of ls) {
      const now = l.counted ?? l.expected
      total += now
      if (l.counted !== null && l.counted !== l.expected) {
        changes.push({ acc_id: accId, nom: l.nom, label: l.label, before: l.expected, after: l.counted })
        if (l.line_key !== ARTICLE_LINE) await db.accessory_variants.update({ where: { variant_id: l.line_key }, data: { quantite: l.counted, updated_at: new Date() } })
      }
    }
    await db.accessories.update({ where: { acc_id: accId }, data: { quantite: total, updated_by: userId, updated_at: new Date() } })
  }
  await db.acc_counts.update({ where: { count_id: countId }, data: { statut: 'appliquee', closed_at: new Date(), closed_by: userId } })
  return { changes, notCounted: lines.filter(l => l.counted === null).length }
}
