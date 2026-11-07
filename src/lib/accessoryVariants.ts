import type { Prisma } from '@prisma/client'
import { HttpError } from '@/lib/api'

// Stock per variant (owner, 2026-11-06, step 4 of the accessories redesign).
// A variant = design × colour × phone model of one article (a pochette family,
// SpaceBuds 2…), each part optional. The article's quantite stays its whole
// stock; what is not counted per variant is "non réparti" (owner's choice: the
// shop starts with everything non réparti and assigns pieces little by little).
//  - a sale / delivery with a chosen variant takes from that variant, the rest
//    (or a sale without a variant) from the non réparti pieces;
//  - a return, a cancelled sale or an undone delivery puts the piece back on
//    its variant when it still exists, else it is non réparti again;
//  - the fiche (Variantes & photos) sets the counts; more than the stock adds
//    the new pieces to it.
// Shared by the sale (api/transactions), cancel (transactions/void), returns
// (api/retours), deliveries (lib/deliveryOrders), the article's quantity
// (api/accessories), transfers (api/movements) and the fiche.

type Tx = Prisma.TransactionClient

export type VariantKey = { design: string | null; couleur: string | null; modele: string | null }
export type VariantLine = VariantKey & { quantite: number }

const clean = (v: unknown, max = 40): string | null => {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') throw new HttpError(400, 'Variante invalide')
  return v.trim().replace(/\s+/g, ' ').slice(0, max) || null
}
const same = (a: string | null, b: string | null) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()
export const sameVariant = (a: VariantKey, b: VariantKey) => same(a.design, b.design) && same(a.couleur, b.couleur) && same(a.modele, b.modele)
export const variantLabel = (v: VariantKey) => [v.design, v.couleur, v.modele].filter(Boolean).join(' · ')

/** design / modele from a request body (the colour is checked against the list by the caller) */
export function variantText(design: unknown, modele: unknown) {
  return { design: clean(design), modele: clean(modele) }
}

/** The article's stock: its variants, their sum, and the non réparti pieces. */
export async function stockOf(tx: Tx, accId: string) {
  const [acc, variants] = await Promise.all([
    tx.accessories.findUnique({ where: { acc_id: accId }, select: { quantite: true } }),
    tx.accessory_variants.findMany({ where: { acc_id: accId }, orderBy: [{ design: 'asc' }, { couleur: 'asc' }, { modele: 'asc' }] }),
  ])
  const counted = variants.reduce((n, v) => n + v.quantite, 0)
  return { total: acc?.quantite ?? 0, variants, counted, unassigned: Math.max(0, (acc?.quantite ?? 0) - counted) }
}

/**
 * Before the article's quantite goes down by `qty` for a sale or a delivery:
 * takes them from the chosen variant (as far as it has), the rest from the
 * non réparti pieces. Refused when neither has enough, so the counts stay right.
 */
export async function takeFromVariant(tx: Tx, accId: string, key: VariantKey, qty: number) {
  const { variants, unassigned } = await stockOf(tx, accId)
  if (!variants.length) return
  const v = variants.find(x => sameVariant(x, key))
  const fromVariant = Math.min(v?.quantite ?? 0, qty)
  if (qty - fromVariant > unassigned) {
    const what = variantLabel(key)
    throw new HttpError(400, what
      ? `Plus de « ${what} » en stock (${v?.quantite ?? 0}) et pas assez de pièces non réparties (${unassigned}). Choisissez une autre variante ou corrigez le stock dans la fiche.`
      : `Cet article est compté par variante : choisissez la variante (design, couleur, iPhone).`)
  }
  if (v && fromVariant > 0) {
    await tx.accessory_variants.update({ where: { variant_id: v.variant_id }, data: { quantite: { decrement: fromVariant }, updated_at: new Date() } })
  }
}

/** After the article's quantite went back up: the piece returns to its variant when it still exists. */
export async function putBackOnVariant(tx: Tx, accId: string, key: VariantKey, qty: number) {
  if (!key.design && !key.couleur && !key.modele) return
  const v = (await tx.accessory_variants.findMany({ where: { acc_id: accId } })).find(x => sameVariant(x, key))
  if (v) await tx.accessory_variants.update({ where: { variant_id: v.variant_id }, data: { quantite: { increment: qty }, updated_at: new Date() } })
}

/**
 * The article's quantite is about to become `next` without a variant (manual
 * −/+, a transfer): it can't go below the pieces counted per variant.
 */
export async function checkTotalAgainstVariants(tx: Tx, accId: string, next: number) {
  const { counted } = await stockOf(tx, accId)
  if (next < counted) throw new HttpError(400,
    `${counted} pièce(s) de cet article sont comptées par variante : retirez-les depuis sa fiche (onglet Variantes & photos), le stock ne peut pas descendre sous ${counted}.`)
}

/** The fiche's variant lines, checked: colour from the list, no duplicates, counts ≥ 0. */
export function cleanLines(raw: unknown, colours: Set<string>): VariantLine[] {
  if (!Array.isArray(raw) || raw.length > 300) throw new HttpError(400, 'Liste de variantes invalide')
  const lines: VariantLine[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const couleur = clean(r.couleur)
    if (couleur && !colours.has(couleur)) throw new HttpError(400, `Couleur inconnue : ${couleur}`)
    const line = { design: clean(r.design), couleur, modele: clean(r.modele), quantite: Number(r.quantite) }
    if (!line.design && !line.couleur && !line.modele) throw new HttpError(400, 'Une variante a besoin d’un design, d’une couleur ou d’un modèle')
    if (!Number.isInteger(line.quantite) || line.quantite < 0 || line.quantite > 100000) throw new HttpError(400, `Quantité invalide pour « ${variantLabel(line)} »`)
    if (lines.some(l => sameVariant(l, line))) throw new HttpError(400, `« ${variantLabel(line)} » apparaît deux fois`)
    lines.push(line)
  }
  return lines
}

/**
 * Replaces the article's variants by `lines`. The stock stays the same while
 * the variants fit in it (pieces move between variants and non réparti);
 * beyond it the new pieces are added to the stock. Returns before / after.
 */
export async function setVariants(tx: Tx, accId: string, lines: VariantLine[], userId: string) {
  const before = await stockOf(tx, accId)
  const counted = lines.reduce((n, l) => n + l.quantite, 0)
  const total = Math.max(before.total, counted)
  await tx.accessory_variants.deleteMany({ where: { acc_id: accId } })
  if (lines.length) await tx.accessory_variants.createMany({ data: lines.map(l => ({ acc_id: accId, ...l })) })
  if (total !== before.total) await tx.accessories.update({ where: { acc_id: accId }, data: { quantite: total, updated_by: userId, updated_at: new Date() } })
  return { before: { total: before.total, variants: before.variants.map(v => ({ design: v.design, couleur: v.couleur, modele: v.modele, quantite: v.quantite })) }, after: { total, variants: lines }, added: total - before.total }
}
