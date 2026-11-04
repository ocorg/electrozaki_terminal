import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api'
import { colourLooksEnglish } from '@/lib/phoneNaming'
import { storefrontDb, storefrontConfigured } from '@/lib/storefront/db'

// One colour list for every accessory (owner, 2026-11-04): the owner's 72
// colours (from the iPhone Gomme range) plus the plain ones the pochettes
// needed. An accessory (Stock → Accessoires) and each website photo
// (Site web → Catalogue) pick their colour from it; owner and managers add or
// rename colours in Site web → Catalogue → Couleurs. The French name is what
// the data stores; English and Arabic names and the dot colour go to the
// website, which keeps a copy (its "Color" table) refreshed from here.

export type Couleur = {
  nom: string; nom_en: string | null; nom_ar: string | null
  hex: string; motif: string | null; ordre: number; actif: boolean
}
export const MOTIFS = ['transparent', 'multicolore', 'ecossais'] as const

const SELECT = { nom: true, nom_en: true, nom_ar: true, hex: true, motif: true, ordre: true, actif: true } as const

export function listCouleurs(all = false): Promise<Couleur[]> {
  return prisma.couleurs.findMany({ where: all ? {} : { actif: true }, select: SELECT, orderBy: [{ ordre: 'asc' }, { nom: 'asc' }] })
}

/** A colour given by a form: empty = none, otherwise it must be in the list (any spelling of case). */
export async function couleurFromList(value: unknown): Promise<string | null> {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new HttpError(400, 'Couleur invalide')
  const typed = value.trim()
  if (!typed) return null
  const found = await prisma.couleurs.findFirst({ where: { nom: { equals: typed, mode: 'insensitive' } }, select: { nom: true, actif: true } })
  if (!found) throw new HttpError(400, `« ${typed} » n'est pas dans la liste des couleurs (Site web → Catalogue → Couleurs)`)
  return found.nom
}

/** Checks for a new or edited colour. */
export function cleanCouleurInput(body: Record<string, unknown>, partial: boolean) {
  const out: Partial<Couleur> = {}
  const text = (v: unknown, max: number, label: string) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'string') throw new HttpError(400, `${label} invalide`)
    const t = v.trim().replace(/\s+/g, ' ')
    if (t.length > max) throw new HttpError(400, `${label} : ${max} caractères maximum`)
    return t || null
  }
  if (!partial || 'nom' in body) {
    const nom = text(body.nom, 30, 'Nom')
    if (!nom) throw new HttpError(400, 'Nom de la couleur obligatoire (en français)')
    if (colourLooksEnglish(nom)) throw new HttpError(400, `« ${nom} » : écrivez le nom en français (le nom anglais va dans sa case)`)
    out.nom = nom[0].toUpperCase() + nom.slice(1)
  }
  if (!partial || 'hex' in body) {
    const hex = String(body.hex ?? '').trim().toUpperCase()
    if (!/^#[0-9A-F]{6}$/.test(hex)) throw new HttpError(400, 'Code couleur invalide (ex. #254472)')
    out.hex = hex
  }
  if ('nom_en' in body) out.nom_en = text(body.nom_en, 40, 'Nom anglais')
  if ('nom_ar' in body) out.nom_ar = text(body.nom_ar, 40, 'Nom arabe')
  if ('motif' in body) {
    const m = body.motif === '' || body.motif === null ? null : String(body.motif)
    if (m !== null && !(MOTIFS as readonly string[]).includes(m)) throw new HttpError(400, 'Motif inconnu')
    out.motif = m
  }
  if ('actif' in body) out.actif = body.actif !== false
  return out
}

/**
 * The website's copy of the list: every colour added or updated (a rename is
 * done by the caller first, so photos follow it). Colours are never deleted
 * there: photos may still use them.
 */
export async function copyCouleursToSite(only?: string): Promise<number> {
  if (!storefrontConfigured()) return 0
  const list = only
    ? await prisma.couleurs.findMany({ where: { nom: only }, select: SELECT })
    : await listCouleurs(true)
  const db = storefrontDb()
  const there = new Map((await db.color.findMany({ where: only ? { name: only } : {} })).map(c => [c.name, c]))
  let n = 0
  for (const c of list) {
    const data = { nameEn: c.nom_en, nameAr: c.nom_ar, hex: c.hex, motif: c.motif, sortOrder: c.ordre }
    const t = there.get(c.nom)
    if (t && t.nameEn === data.nameEn && t.nameAr === data.nameAr && t.hex === data.hex && t.motif === data.motif && t.sortOrder === data.sortOrder) continue
    await db.color.upsert({ where: { name: c.nom }, create: { name: c.nom, ...data }, update: data })
    n++
  }
  return n
}
