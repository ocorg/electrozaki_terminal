import { createHmac } from 'node:crypto'

// ─────────────────────────────────────────────────────────────────────────
// ERP stock → website listings. Pure functions: no database access here.
//
// SECURITY: these selects are the ONLY columns the sync ever reads from the
// ERP. IMEI, iCloud account/password, purchase price, minimum price,
// supplier, staff description and damage notes are never selected, so they
// cannot reach the website even by mistake. scripts/e2e-site-sync.mjs fails
// if a forbidden column name appears in what the sync writes.
// ─────────────────────────────────────────────────────────────────────────

export const PHONE_SAFE_SELECT = {
  phone_id:              true, // only ever used through refOf() — never sent
  marque:                true,
  serie:                 true,
  model:                 true,
  stockage:              true,
  couleur:               true,
  ram:                   true,
  condition:             true,
  battery_level:         true,
  replaced_components:   true,
  prix_vente_recommande: true,
  promo_type:            true,
  promo_montant:         true,
} as const

export const ACCESSORY_SAFE_SELECT = {
  acc_id:                true, // only ever used through refOf() — never sent
  nom:                   true,
  categorie:             true,
  marque:                true,
  prix_vente_recommande: true,
  quantite:              true,
} as const

export const FORBIDDEN_FIELDS = [
  'imei', 'icloud_compte', 'icloud_mdp', 'prix_achat', 'prix_vente_minimum',
  'fournisseur_id', 'description', 'damage_notes', 'notes', 'phone_id', 'acc_id',
] as const

type Num = { toString(): string } | number | null

export interface ErpPhone {
  phone_id: string
  marque: string
  serie: string | null
  model: string
  stockage: string | null
  couleur: string | null
  ram: string | null
  condition: 'neuf' | 'occasion' | 'defectueux'
  battery_level: number | null
  replaced_components: unknown
  prix_vente_recommande: Num
  promo_type: 'valeur' | 'pourcentage' | null
  promo_montant: Num
}

export interface ErpAccessory {
  acc_id: string
  nom: string
  categorie: string
  marque: string | null
  prix_vente_recommande: Num
  quantite: number
}

export type Grade = 'NEUF' | 'TRES_BON' | 'BON' | 'PIECES_REMPLACEES'

export const GRADE_LABEL: Record<Grade, string> = {
  NEUF:              'Neuf',
  TRES_BON:          'Très bon état',
  BON:               'Bon état',
  PIECES_REMPLACEES: 'Pièces remplacées',
}

// ── Opaque references ────────────────────────────────────────────────────

/**
 * Stable, non-reversible reference for an ERP record or group. The website
 * only ever sees these, never PHO-/EZ-ACC- ids (which would reveal stock
 * volumes) — and without STOREFRONT_REF_SECRET they can't be mapped back.
 */
export function refOf(kind: string, value: string): string {
  const secret = process.env.STOREFRONT_REF_SECRET
  if (!secret) throw new Error('STOREFRONT_REF_SECRET is not set')
  return createHmac('sha256', secret).update(`${kind}:${value}`).digest('base64url').slice(0, 22)
}

// ── Text helpers ─────────────────────────────────────────────────────────

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const norm  = (s: string | null | undefined) =>
  clean(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function slugify(text: string): string {
  return norm(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'produit'
}

/**
 * Customer-facing model name. The ERP stores Apple models as series + short
 * model ("iPhone 13" + "13 Pro Max"), Samsung with the full name in `model`.
 */
export function phoneName(p: Pick<ErpPhone, 'marque' | 'serie' | 'model'>): string {
  const model  = clean(p.model)
  const family = clean(p.serie).split(' ')[0] ?? ''
  const lower  = norm(model)
  if (lower.startsWith(norm(p.marque)) || !family || lower.startsWith(norm(family))) return model
  return `${family} ${model}`
}

export function modelKey(p: Pick<ErpPhone, 'marque' | 'serie' | 'model'>): string {
  return `${norm(p.marque)}|${norm(phoneName(p))}`
}

export function storageLabel(stockage: string | null): string | null {
  const s = clean(stockage).toUpperCase().replace(/\s+/g, '')
  return s || null
}

// ── Condition ────────────────────────────────────────────────────────────

interface ReplacedPart { name: string; condition?: string }

export function replacedParts(value: unknown): ReplacedPart[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is ReplacedPart => !!v && typeof v === 'object' && typeof (v as ReplacedPart).name === 'string')
    .map(v => ({ name: clean(v.name), condition: typeof v.condition === 'string' ? v.condition : undefined }))
    .filter(v => v.name)
}

/** The user's rule (2026-09-23): replaced part → PIECES_REMPLACEES, battery ≥ 85 % → TRES_BON, else BON. */
export function gradeOf(p: Pick<ErpPhone, 'condition' | 'battery_level' | 'replaced_components'>): Grade {
  if (p.condition === 'neuf') return 'NEUF'
  if (replacedParts(p.replaced_components).length) return 'PIECES_REMPLACEES'
  if (p.battery_level !== null && p.battery_level >= 85) return 'TRES_BON'
  return 'BON'
}

// ERP part names (PhoneForm's fixed list) → the website's "genuine" tiles.
const PART_FLAG: Record<string, 'screenGenuine' | 'batteryGenuine' | 'cameraGenuine' | 'chargingPortGenuine' | 'speakerGenuine'> = {
  'ecran':                'screenGenuine',
  'batterie':             'batteryGenuine',
  'camera arriere':       'cameraGenuine',
  'camera avant':         'cameraGenuine',
  'connecteur de charge': 'chargingPortGenuine',
  'haut-parleur':         'speakerGenuine',
}

const PART_QUALITY: Record<string, string> = {
  original: "pièce d'origine constructeur",
  standard: 'pièce compatible',
}

/** Condition tiles + an honest note, generated only from the fixed part list. */
export function conditionOf(p: Pick<ErpPhone, 'condition' | 'battery_level' | 'replaced_components' | 'marque'>) {
  const parts = replacedParts(p.replaced_components)
  const used  = p.condition !== 'neuf'
  const flags = {
    screenGenuine:       used ? true : null as boolean | null,
    batteryGenuine:      used && p.battery_level !== null ? true : null as boolean | null,
    cameraGenuine:       null as boolean | null,
    chargingPortGenuine: null as boolean | null,
    speakerGenuine:      null as boolean | null,
  }
  for (const part of parts) {
    const flag = PART_FLAG[norm(part.name)]
    if (flag) flags[flag] = false
  }
  const note = parts.length
    ? `Pièces remplacées : ${parts
        .map(part => {
          const quality = part.condition ? PART_QUALITY[part.condition] : undefined
          return quality ? `${part.name} (${quality})` : part.name
        })
        .join(', ')}.`
    : null
  return {
    ...flags,
    batteryHealthPercent: used ? p.battery_level : null,
    hasDefects:           parts.length > 0,
    transparencyNotes:    note,
  }
}

// ── Price ────────────────────────────────────────────────────────────────

/** The shop's sale price, with the phone's own promo applied. */
export function unitPrice(p: Pick<ErpPhone, 'prix_vente_recommande' | 'promo_type' | 'promo_montant'>): number | null {
  if (p.prix_vente_recommande === null) return null
  const base  = Number(p.prix_vente_recommande)
  const promo = p.promo_montant === null ? 0 : Number(p.promo_montant)
  if (!Number.isFinite(base) || base <= 0) return null
  let price = base
  if (p.promo_type === 'valeur' && promo > 0) price = base - promo
  if (p.promo_type === 'pourcentage' && promo > 0 && promo < 100) price = Math.round(base * (1 - promo / 100))
  return price > 0 ? price : base
}

// ── Listings ─────────────────────────────────────────────────────────────

export interface VariantListing {
  erpRef: string
  name: string
  color: string | null
  storageLabel: string | null
  price: number
  stockQuantity: number
  photoColor: string | null
  batteryHealthPercent: number | null
  screenGenuine: boolean | null
  batteryGenuine: boolean | null
  cameraGenuine: boolean | null
  chargingPortGenuine: boolean | null
  speakerGenuine: boolean | null
  hasDefects: boolean
  transparencyNotes: string | null
  /** ERP ids behind this variant — kept in the ERP process, never written. */
  unitIds: string[]
}

export interface PhoneListing {
  erpKey: string
  modelKey: string
  modelName: string
  name: string
  slugBase: string
  brand: string
  grade: Grade
  storage: string | null
  tags: string[]
  specs: Record<string, string>
  price: number
  colors: string[]
  variants: VariantListing[]
}

/** Groups sellable phones into one listing per model + storage + grade. */
export function buildPhoneListings(phones: ErpPhone[]): PhoneListing[] {
  const groups = new Map<string, { phones: (ErpPhone & { price: number })[]; grade: Grade; storage: string | null }>()
  for (const phone of phones) {
    const price = unitPrice(phone)
    if (price === null) continue
    const grade   = gradeOf(phone)
    const storage = storageLabel(phone.stockage)
    const key     = `${modelKey(phone)}|${storage ?? ''}|${grade}`
    const group   = groups.get(key) ?? { phones: [], grade, storage }
    group.phones.push({ ...phone, price })
    groups.set(key, group)
  }

  const listings: PhoneListing[] = []
  for (const [key, { phones: units, grade, storage }] of groups) {
    const first = units[0]
    const name  = phoneName(first)
    const variants: VariantListing[] = []

    if (grade === 'NEUF') {
      // New phones of one colour and price are interchangeable: one swatch.
      const byColor = new Map<string, typeof units>()
      for (const u of units) {
        const k = `${clean(u.couleur)}|${u.price}`
        byColor.set(k, [...(byColor.get(k) ?? []), u])
      }
      const colorsWithSeveralPrices = new Set(
        Array.from(byColor.keys()).map(k => k.split('|')[0])
          .filter((c, i, all) => all.indexOf(c) !== i),
      )
      for (const [k, same] of byColor) {
        const color = clean(same[0].couleur) || null
        variants.push({
          erpRef:               refOf('tel-lot', `${key}|${k}`),
          name:                 color && colorsWithSeveralPrices.has(color) ? `${color} — ${same[0].price} DH` : (color ?? 'Standard'),
          color:                color && colorsWithSeveralPrices.has(color) ? `${color} (${same[0].price} DH)` : color,
          storageLabel:         null,
          price:                same[0].price,
          stockQuantity:        same.length,
          photoColor:           color,
          batteryHealthPercent: null,
          screenGenuine:        null,
          batteryGenuine:       null,
          cameraGenuine:        null,
          chargingPortGenuine:  null,
          speakerGenuine:       null,
          hasDefects:           false,
          transparencyNotes:    null,
          unitIds:              same.map(u => u.phone_id),
        })
      }
    } else {
      // Used phones are each unique (battery, parts, price): one choice per phone.
      for (const u of units.sort((a, b) => a.price - b.price)) {
        const color = clean(u.couleur) || null
        const cond  = conditionOf(u)
        const bits  = [color, u.battery_level !== null ? `Batterie ${u.battery_level}%` : null, `${u.price} DH`]
        variants.push({
          erpRef:        refOf('tel-unit', u.phone_id),
          name:          bits.filter(Boolean).join(' · '),
          color,         // the website filters units by colour, then battery (unit picker)
          storageLabel:  null,
          price:         u.price,
          stockQuantity: 1,
          photoColor:    color,
          ...cond,
          unitIds:       [u.phone_id],
        })
      }
    }

    const brand = clean(first.marque)
    const rams  = units.map(u => clean(u.ram)).filter(Boolean)
    const ram   = rams.sort((a, b) => rams.filter(r => r === b).length - rams.filter(r => r === a).length)[0]
    const specs: Record<string, string> = {}
    if (storage) specs['Stockage'] = storage
    if (ram)     specs['RAM'] = ram
    specs['État'] = GRADE_LABEL[grade]

    listings.push({
      erpKey:   refOf('tel-group', key),
      modelKey:  modelKey(first),
      modelName: name,
      name:      storage ? `${name} ${storage}` : name,
      slugBase: slugify(`${name} ${storage ?? ''} ${GRADE_LABEL[grade]}`),
      brand,
      grade,
      storage,
      tags:     Array.from(new Set([norm(brand), norm(first.serie), norm(name), (storage ?? '').toLowerCase()].filter(Boolean))),
      specs,
      price:    Math.min(...variants.map(v => v.price)),
      colors:   Array.from(new Set(units.map(u => clean(u.couleur)).filter(Boolean))),
      variants,
    })
  }
  return listings
}

export interface AccessoryListing {
  erpKey: string
  name: string
  slugBase: string
  brand: string | null
  categoryCode: string
  price: number | null
  stock: number
}

export function buildAccessoryListings(accessories: ErpAccessory[]): AccessoryListing[] {
  return accessories.map(a => {
    const price = a.prix_vente_recommande === null ? null : Number(a.prix_vente_recommande)
    return {
      erpKey:       refOf('acc', a.acc_id),
      name:         clean(a.nom),
      slugBase:     slugify(`${clean(a.marque)} ${clean(a.nom)}`),
      brand:        clean(a.marque) || null,
      categoryCode: a.categorie,
      price:        price !== null && Number.isFinite(price) && price > 0 ? price : null,
      stock:        Math.max(0, a.quantite),
    }
  })
}
