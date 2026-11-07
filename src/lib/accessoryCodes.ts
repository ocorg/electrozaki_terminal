import type { Prisma } from '@prisma/client'
import { HttpError } from '@/lib/api'

// The codes that find an accessory (owner, 2026-11-07). One rule for every
// case: scan a code → the ERP finds the article (and the variant when the code
// says it) → the till's window asks the rest.
//  - the manufacturer's codes on boxes and sachets: several per article,
//    learned the first time they are scanned (« C'est quel article ? »);
//  - the article's own code (accessories.barcode, EZ-ACC-…) and its id;
//  - our printed codes, short so the QR stays small: « EZ42 » = article
//    EZ-ACC-000042, « EV123 » = variant VAR-000123.
// Shared by the scan API, the fiche (Codes) and the label printing.

type Db = Prisma.TransactionClient

const pad6 = (n: string) => n.padStart(6, '0')
/** EZ-ACC-000042 → EZ42 */
export const articleShortCode = (accId: string) => `EZ${Number(accId.replace(/\D/g, ''))}`
/** VAR-000123 → EV123 */
export const variantShortCode = (variantId: string) => `EV${Number(variantId.replace(/\D/g, ''))}`

/** A scanned code, cleaned: no spaces around, at most 64 characters. */
export function cleanCode(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'Code invalide')
  const code = raw.trim().replace(/\s+/g, '')
  if (code.length < 3 || code.length > 64) throw new HttpError(400, 'Code invalide (3 à 64 caractères)')
  return code
}

export type Found = { acc_id: string; variant_id: string | null; via: 'code' | 'article' | 'ez' }

/** What a scanned code designates, or null when it is unknown. */
export async function resolveCode(db: Db, raw: string): Promise<Found | null> {
  const code = raw.trim().replace(/\s+/g, '')
  if (!code) return null
  const known = await db.accessory_codes.findUnique({ where: { code }, select: { acc_id: true, variant_id: true, accessory: { select: { is_deleted: true } } } })
  if (known && !known.accessory.is_deleted) return { acc_id: known.acc_id, variant_id: known.variant_id, via: 'code' }
  const short = code.toUpperCase().match(/^(EZ|EV)(\d{1,9})$/)
  if (short) {
    if (short[1] === 'EZ') {
      const acc = await db.accessories.findFirst({ where: { acc_id: `EZ-ACC-${pad6(short[2])}`, is_deleted: false }, select: { acc_id: true } })
      if (acc) return { acc_id: acc.acc_id, variant_id: null, via: 'ez' }
    } else {
      const v = await db.accessory_variants.findUnique({ where: { variant_id: `VAR-${pad6(short[2])}` }, select: { acc_id: true, variant_id: true, accessory: { select: { is_deleted: true } } } })
      if (v && !v.accessory.is_deleted) return { acc_id: v.acc_id, variant_id: v.variant_id, via: 'ez' }
    }
  }
  const acc = await db.accessories.findFirst({ where: { is_deleted: false, OR: [{ barcode: code }, { acc_id: code.toUpperCase() }] }, select: { acc_id: true } })
  return acc ? { acc_id: acc.acc_id, variant_id: null, via: 'article' } : null
}

/**
 * Links a code to an article (or one of its variants). A code already on this
 * article is moved to the variant given; a code on another article is refused
 * with that article's name, so nothing is linked twice by mistake.
 */
export async function addCode(db: Db, accId: string, raw: unknown, variantId: string | null, userId: string) {
  const code = cleanCode(raw)
  if (/^(EZ|EV)\d{1,9}$/i.test(code) || /^EZ-ACC-\d+$/i.test(code)) throw new HttpError(400, 'Ce code est un code Electro Zaki : il est déjà reconnu')
  if (variantId) {
    const v = await db.accessory_variants.findUnique({ where: { variant_id: variantId }, select: { acc_id: true } })
    if (!v || v.acc_id !== accId) throw new HttpError(400, 'Variante introuvable pour cet article')
  }
  const owner = await resolveCode(db, code)
  if (owner && owner.acc_id !== accId) {
    const other = await db.accessories.findUnique({ where: { acc_id: owner.acc_id }, select: { nom: true, marque: true } })
    throw new HttpError(409, `Ce code est déjà celui de « ${[other?.marque, other?.nom].filter(Boolean).join(' ')} » (${owner.acc_id})`)
  }
  if (owner && owner.via === 'article') return { code, added: false }   // already the article's own code
  const existing = await db.accessory_codes.findUnique({ where: { code } })
  if (existing) {
    if (existing.variant_id === variantId) return { code, added: false }
    await db.accessory_codes.update({ where: { code }, data: { variant_id: variantId } })
    return { code, added: false, moved: true }
  }
  await db.accessory_codes.create({ data: { code, acc_id: accId, variant_id: variantId, created_by: userId } })
  return { code, added: true }
}
