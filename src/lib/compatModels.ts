import { prisma } from '@/lib/db'
import { slugify } from '@/lib/storefront/listing'
import type { PrismaClient } from '@/generated/storefront/client'

// The phone models an accessory fits (owner, 2026-11-06): picked by brand →
// series → model from the ERP's own phone list (phone_catalog, every brand),
// instead of a list typed by hand on the website (25 iPhones, no Samsung).
// On the website they are the options of the fiche group "modele"
// (the "Votre modèle" choice); an option is created the first time a model
// is ticked, so the site only lists models that some accessory fits.

export const MODEL_GROUP = 'modele'

export type CompatModel = { brand: string; serie: string; model: string }

// the shop's main brands first, the others after in alphabetical order
const BRAND_ORDER = ['Apple', 'Samsung', 'Xiaomi', 'Honor', 'Oppo', 'Vivo', 'Realme', 'Infinix', 'Tecno', 'Itel', 'ZTE', 'Nokia', 'Alcatel']
const brandRank = (b: string) => { const i = BRAND_ORDER.indexOf(b); return i < 0 ? BRAND_ORDER.length : i }
// newest first: "iPhone 17 Pro Max" before "iPhone 11", "iPhone 11" before
// "iPhone XS" (X, XS, XR = generation 10): by the model's number, then by name
const generation = (name: string) => {
  const n = name.match(/\d+/)
  if (n) return Number(n[0])
  return /\bX[SR]?\b/i.test(name) ? 10 : 0
}
const newestFirst = (a: string, b: string) =>
  generation(b) - generation(a) || b.localeCompare(a, 'fr', { numeric: true, sensitivity: 'base' })

/** Every model of the ERP phone list, once, in the order the picker shows them. */
export async function listCompatModels(): Promise<CompatModel[]> {
  const rows = await prisma.phone_catalog.findMany({ select: { marque: true, serie: true, model: true } })
  // a model listed under several series (data typed over time): its most frequent series
  const seen = new Map<string, { brand: string; series: Map<string, number> }>()
  for (const r of rows) {
    const key = r.model.trim()
    if (!key) continue
    const e = seen.get(key) ?? { brand: r.marque.trim(), series: new Map() }
    e.series.set(r.serie.trim(), (e.series.get(r.serie.trim()) ?? 0) + 1)
    seen.set(key, e)
  }
  const list: CompatModel[] = [...seen.entries()].map(([model, e]) => ({
    brand: e.brand, model, serie: [...e.series.entries()].sort((a, b) => b[1] - a[1])[0][0],
  }))
  // series by family (Galaxy A, Galaxy M, Galaxy S, Galaxy Z…), newest first within it
  const family = (serie: string) => serie.replace(/\d+.*$/, '').trim().toLowerCase()
  return list.sort((a, b) => brandRank(a.brand) - brandRank(b.brand) || a.brand.localeCompare(b.brand)
    || family(a.serie).localeCompare(family(b.serie)) || newestFirst(a.serie, b.serie) || newestFirst(a.model, b.model))
}

/**
 * The website option ids for these model names (creating the missing ones in
 * the "modele" group, ordered like the picker). Unknown names are refused.
 */
export async function modelOptionIds(db: PrismaClient, names: string[]): Promise<string[]> {
  if (!names.length) return []
  const all = await listCompatModels()
  const rank = new Map(all.map((m, i) => [m.model.toLowerCase(), i]))
  const group = await db.facetGroup.findUnique({ where: { key: MODEL_GROUP }, select: { id: true, options: { select: { id: true, key: true, name: true } } } })
  if (!group) throw new Error('Groupe « Modèle » introuvable sur le site')
  const byName = new Map(group.options.map(o => [o.name.toLowerCase(), o.id]))
  const keys = new Set(group.options.map(o => o.key))
  const ids: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    const known = byName.get(name.toLowerCase())
    if (known) { ids.push(known); continue }
    const r = rank.get(name.toLowerCase())
    if (r === undefined) throw new Error(`« ${name} » n'est pas dans la liste des téléphones`)
    const model = all[r].model
    let key = slugify(model)
    for (let n = 2; keys.has(key); n++) key = `${slugify(model)}-${n}`
    keys.add(key)
    const created = await db.facetOption.create({ data: { groupId: group.id, key, name: model, sortOrder: 100 + r }, select: { id: true } })
    byName.set(model.toLowerCase(), created.id)
    ids.push(created.id)
  }
  return [...new Set(ids)]
}
