import type { Prisma } from '@prisma/client'
import { HttpError } from '@/lib/api'
import { cleanModels, hasModel, modelsLabel } from '@/lib/phoneGroups'

// Stock per variant (owner, 2026-11-06, step 4 of the accessories redesign).
// A variant = design × colour × phone models of one article (a pochette family,
// a glass, SpaceBuds 2…), each part optional. Since 2026-11-07 a variant can
// cover a GROUP of phones sharing one stock (glass for iPhone 13 / 14 / 15).
// The article's quantite stays its whole stock; what is not counted per
// variant is "non réparti" (the shop assigns pieces little by little).
//  - a sale / delivery takes from its variant (the one picked at the till, or
//    the one whose design, colour and phones match), the rest from the non
//    réparti pieces;
//  - a return, a cancelled sale or an undone delivery puts the piece back on
//    that variant when it still exists, else it is non réparti again;
//  - the fiche (Variantes & photos) sets the counts; more than the stock adds
//    the new pieces to it. Saving keeps each variant's id (its printed code).
// Shared by the sale (api/transactions), cancel (transactions/void), returns
// (api/retours), deliveries (lib/deliveryOrders), the article's quantity
// (api/accessories), transfers (api/movements) and the fiche.

type Tx = Prisma.TransactionClient

/** What a sale line says: design, colour, the customer's phone, and the variant when picked. */
export type VariantKey = { design: string | null; couleur: string | null; modele: string | null; variant_id?: string | null }
export type VariantLine = { design: string | null; couleur: string | null; modeles: string[]; quantite: number }
type Row = { variant_id: string; design: string | null; couleur: string | null; modeles: string[]; quantite: number }

const clean = (v: unknown, max = 40): string | null => {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') throw new HttpError(400, 'Variante invalide')
  return v.trim().replace(/\s+/g, ' ').slice(0, max) || null
}
const same = (a: string | null, b: string | null) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()
const sameModels = (a: string[], b: string[]) => a.length === b.length && a.every((m, i) => same(m, b[i]))
/** the same line of the fiche: same design, colour and phones */
export const sameLine = (a: Omit<VariantLine, 'quantite'>, b: Omit<VariantLine, 'quantite'>) =>
  same(a.design, b.design) && same(a.couleur, b.couleur) && sameModels(cleanModels(a.modeles), cleanModels(b.modeles))
export const lineLabel = (v: Omit<VariantLine, 'quantite'>) => [v.design, v.couleur, modelsLabel(v.modeles)].filter(Boolean).join(' · ')
export const variantLabel = (v: VariantKey) => [v.design, v.couleur, v.modele].filter(Boolean).join(' · ')

/** The variant a sale line belongs to: the one picked, else design + colour + the phone in its group. */
function matchOf(rows: Row[], key: VariantKey): Row | undefined {
  if (key.variant_id) { const v = rows.find(r => r.variant_id === key.variant_id); if (v) return v }
  return rows.find(r => same(r.design, key.design) && same(r.couleur, key.couleur)
    && (r.modeles.length ? hasModel(r.modeles, key.modele) : !key.modele))
}

/** design / modele from a request body (the colour is checked against the list by the caller) */
export function variantText(design: unknown, modele: unknown) {
  return { design: clean(design), modele: clean(modele) }
}

/** The article's stock: its variants, their sum, and the non réparti pieces. */
export async function stockOf(tx: Tx, accId: string) {
  const [acc, variants] = await Promise.all([
    tx.accessories.findUnique({ where: { acc_id: accId }, select: { quantite: true } }),
    tx.accessory_variants.findMany({ where: { acc_id: accId }, orderBy: [{ design: 'asc' }, { couleur: 'asc' }, { variant_id: 'asc' }] }),
  ])
  const counted = variants.reduce((n, v) => n + v.quantite, 0)
  return { total: acc?.quantite ?? 0, variants, counted, unassigned: Math.max(0, (acc?.quantite ?? 0) - counted) }
}

/**
 * Before the article's quantite goes down by `qty` for a sale or a delivery:
 * takes them from the matching variant (as far as it has), the rest from the
 * non réparti pieces. Refused when neither has enough, so the counts stay
 * right. Returns the variant used (kept on the sale for a later return).
 */
export async function takeFromVariant(tx: Tx, accId: string, key: VariantKey, qty: number): Promise<string | null> {
  const { variants, unassigned } = await stockOf(tx, accId)
  if (!variants.length) return null
  const v = matchOf(variants, key)
  const fromVariant = Math.min(v?.quantite ?? 0, qty)
  if (qty - fromVariant > unassigned) {
    const what = v ? lineLabel(v) : variantLabel(key)
    throw new HttpError(400, what
      ? `Plus de « ${what} » en stock (${v?.quantite ?? 0}) et pas assez de pièces non réparties (${unassigned}). Choisissez une autre variante ou corrigez le stock dans la fiche.`
      : `Cet article est compté par variante : choisissez la variante (design, couleur, téléphone).`)
  }
  if (v && fromVariant > 0) {
    await tx.accessory_variants.update({ where: { variant_id: v.variant_id }, data: { quantite: { decrement: fromVariant }, updated_at: new Date() } })
  }
  return v?.variant_id ?? null
}

/** After the article's quantite went back up: the piece returns to its variant when it still exists. */
export async function putBackOnVariant(tx: Tx, accId: string, key: VariantKey, qty: number) {
  if (!key.variant_id && !key.design && !key.couleur && !key.modele) return
  const v = matchOf(await tx.accessory_variants.findMany({ where: { acc_id: accId } }), key)
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

/**
 * The fiche's variant lines, checked: colour from the list, no duplicates,
 * a phone in only one line per design × colour (else the till can't choose),
 * counts ≥ 0.
 */
export function cleanLines(raw: unknown, colours: Set<string>): VariantLine[] {
  if (!Array.isArray(raw) || raw.length > 300) throw new HttpError(400, 'Liste de variantes invalide')
  const lines: VariantLine[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const couleur = clean(r.couleur)
    if (couleur && !colours.has(couleur)) throw new HttpError(400, `Couleur inconnue : ${couleur}`)
    const line = { design: clean(r.design), couleur, modeles: cleanModels(r.modeles), quantite: Number(r.quantite) }
    if (line.modeles.length > 40) throw new HttpError(400, 'Trop de téléphones dans une ligne (40 maximum)')
    if (!line.design && !line.couleur && !line.modeles.length) throw new HttpError(400, 'Une variante a besoin d’un design, d’une couleur ou d’un téléphone')
    if (!Number.isInteger(line.quantite) || line.quantite < 0 || line.quantite > 100000) throw new HttpError(400, `Quantité invalide pour « ${lineLabel(line)} »`)
    if (lines.some(l => sameLine(l, line))) throw new HttpError(400, `« ${lineLabel(line)} » apparaît deux fois`)
    const clash = lines.find(l => same(l.design, line.design) && same(l.couleur, line.couleur) && l.modeles.some(m => hasModel(line.modeles, m)))
    if (clash) {
      const phone = clash.modeles.find(m => hasModel(line.modeles, m))
      throw new HttpError(400, `${phone} est dans deux lignes (« ${lineLabel(clash)} » et « ${lineLabel(line)} ») : gardez-le dans une seule.`)
    }
    lines.push(line)
  }
  return lines
}

/**
 * Replaces the article's variants by `lines`, keeping the id (and so the
 * printed code) of each line that stays. The stock stays the same while the
 * variants fit in it (pieces move between variants and non réparti); beyond
 * it the new pieces are added to the stock. Returns before / after.
 */
export async function setVariants(tx: Tx, accId: string, lines: VariantLine[], userId: string) {
  const before = await stockOf(tx, accId)
  const counted = lines.reduce((n, l) => n + l.quantite, 0)
  const total = Math.max(before.total, counted)
  const kept = new Set<string>()
  for (const l of lines) {
    const old = before.variants.find(v => !kept.has(v.variant_id) && sameLine(v, l))
    if (old) {
      kept.add(old.variant_id)
      if (old.quantite !== l.quantite) await tx.accessory_variants.update({ where: { variant_id: old.variant_id }, data: { quantite: l.quantite, updated_at: new Date() } })
    } else {
      const created = await tx.accessory_variants.create({ data: { acc_id: accId, design: l.design, couleur: l.couleur, modeles: l.modeles, quantite: l.quantite }, select: { variant_id: true } })
      kept.add(created.variant_id)
    }
  }
  const gone = before.variants.filter(v => !kept.has(v.variant_id)).map(v => v.variant_id)
  if (gone.length) await tx.accessory_variants.deleteMany({ where: { variant_id: { in: gone } } })
  if (total !== before.total) await tx.accessories.update({ where: { acc_id: accId }, data: { quantite: total, updated_by: userId, updated_at: new Date() } })
  return {
    before: { total: before.total, variants: before.variants.map(v => ({ design: v.design, couleur: v.couleur, modeles: v.modeles, quantite: v.quantite })) },
    after: { total, variants: lines },
    added: total - before.total,
  }
}
