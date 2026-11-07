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

/**
 * Every article (or variant) a scanned code designates: usually one, several
 * when a supplier prints the same code on different products (2026-11-07).
 */
export async function resolveCodeAll(db: Db, raw: string): Promise<Found[]> {
  const code = raw.trim().replace(/\s+/g, '')
  if (!code) return []
  const short = code.toUpperCase().match(/^(EZ|EV)(\d{1,9})$/)
  if (short) {
    if (short[1] === 'EZ') {
      const acc = await db.accessories.findFirst({ where: { acc_id: `EZ-ACC-${pad6(short[2])}`, is_deleted: false }, select: { acc_id: true } })
      if (acc) return [{ acc_id: acc.acc_id, variant_id: null, via: 'ez' }]
    } else {
      const v = await db.accessory_variants.findUnique({ where: { variant_id: `VAR-${pad6(short[2])}` }, select: { acc_id: true, variant_id: true, accessory: { select: { is_deleted: true } } } })
      if (v && !v.accessory.is_deleted) return [{ acc_id: v.acc_id, variant_id: v.variant_id, via: 'ez' }]
    }
  }
  const out: Found[] = []
  const known = await db.accessory_codes.findMany({ where: { code, accessory: { is_deleted: false } }, select: { acc_id: true, variant_id: true }, orderBy: { created_at: 'asc' } })
  for (const k of known) out.push({ acc_id: k.acc_id, variant_id: k.variant_id, via: 'code' })
  const own = await db.accessories.findMany({ where: { is_deleted: false, OR: [{ barcode: code }, { acc_id: code.toUpperCase() }] }, select: { acc_id: true } })
  for (const a of own) if (!out.some(o => o.acc_id === a.acc_id)) out.push({ acc_id: a.acc_id, variant_id: null, via: 'article' })
  return out
}

/** What a scanned code designates (the first when shared), or null when it is unknown. */
export async function resolveCode(db: Db, raw: string): Promise<Found | null> {
  return (await resolveCodeAll(db, raw))[0] ?? null
}

/**
 * Links a code to an article (or one of its variants). A code already on this
 * article is moved to the variant given. A code that is another article's is
 * refused with that article's name, unless `share` says the same code really
 * is printed on both products (then the scan asks which one).
 */
export async function addCode(db: Db, accId: string, raw: unknown, variantId: string | null, userId: string, share = false) {
  const code = cleanCode(raw)
  if (/^(EZ|EV)\d{1,9}$/i.test(code) || /^EZ-ACC-\d+$/i.test(code)) throw new HttpError(400, 'Ce code est un code Electro Zaki : il est déjà reconnu')
  if (variantId) {
    const v = await db.accessory_variants.findUnique({ where: { variant_id: variantId }, select: { acc_id: true } })
    if (!v || v.acc_id !== accId) throw new HttpError(400, 'Variante introuvable pour cet article')
  }
  const owners = await resolveCodeAll(db, code)
  const others = owners.filter(o => o.acc_id !== accId)
  if (others.length && !share) {
    const names = await db.accessories.findMany({ where: { acc_id: { in: others.map(o => o.acc_id) } }, select: { acc_id: true, nom: true, marque: true } })
    throw new HttpError(409, `Ce code est déjà celui de ${names.map(n => `« ${[n.marque, n.nom].filter(Boolean).join(' ')} » (${n.acc_id})`).join(', ')}. S’il est vraiment imprimé sur les deux produits, partagez-le : au scan, l’ERP demandera lequel.`)
  }
  const mine = owners.find(o => o.acc_id === accId)
  if (mine?.via === 'article') return { code, added: false }   // already the article's own code
  const existing = await db.accessory_codes.findUnique({ where: { code_acc_id: { code, acc_id: accId } } })
  if (existing) {
    if (existing.variant_id === variantId) return { code, added: false }
    await db.accessory_codes.update({ where: { code_acc_id: { code, acc_id: accId } }, data: { variant_id: variantId } })
    return { code, added: false, moved: true }
  }
  await db.accessory_codes.create({ data: { code, acc_id: accId, variant_id: variantId, created_by: userId } })
  return { code, added: true, shared: others.length > 0 }
}
