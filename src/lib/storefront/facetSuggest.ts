import { prisma } from '@/lib/db'
import { refOf } from '@/lib/storefront/listing'
import { listCompatModels, MODEL_GROUP } from '@/lib/compatModels'
import type { PrismaClient } from '@/generated/storefront/client'

// Fiche ticks guessed from the article names (owner, 2026-11-06): "Cable U-C
// 20W 1M" → USB → USB-C, Rapide, 1 m. Only obvious words count; staff see
// every suggestion and untick what is wrong before anything is saved.
// Existing ticks are never removed, and a one-choice group that already has a
// tick on a product gets no suggestion.

type Db = Pick<PrismaClient, 'product' | 'facetGroup' | 'productFacet'>

export type Suggestion = {
  productId: string; name: string; erpName: string | null; category: string
  options: { id: string; group: string; name: string }[]
}

const has = (text: string, re: RegExp) => re.test(text)

/** option keys of one group, guessed from one article's text */
function guess(group: string, text: string, typeCode: string | null): string[] {
  // "22,5W" keeps its comma (a decimal), slashes and bars split words
  const t = ` ${text.toLowerCase().replace(/[|/_]+/g, ' ')} `
  switch (group) {
    case 'cable': {
      const out: string[] = []
      // words, or Oraimo's codes (OCD-114CC = C-C, 114CL = C-L, 114C = U-C, 114L = U-L)
      if (has(t, /\b(c-c|c to c|usb-c to usb-c|type-c to type-c|ocd-\d+cc)\b/)) out.push('c-c')
      if (has(t, /\b(u-c|a-c|usb to c|usb-a to usb-c|usb to type-c|ocd-\d+c)\b/)) out.push('usb-c')
      if (has(t, /\b(c-l|c to l|c-lightning|usb-c to lightning|ocd-\d+cl|c-iph)\b/)) out.push('c-lightning')
      if (has(t, /\b(u-l|a-l|usb-l|usb-iph|usb to l|usb to lightning|ocd-\d+l)\b/)) out.push('usb-lightning')
      if (has(t, /\b(u-m|usb-m|micro[- ]?usb|micro)\b/)) out.push('micro-usb')
      if (has(t, /\b(aux|jack)\b/)) out.push('aux')
      if (has(t, /\b(3 ?en ?1|3 ?in ?1|3-in-1)\b/)) out.push('3-en-1')
      return out
    }
    case 'puissance': {
      const w = t.match(/\b(\d{1,3}(?:[.,]\d)?) ?w\b/)
      if (!w) return []
      const watts = Number(w[1].replace(',', '.'))
      return watts <= 15 ? ['normale'] : watts < 45 ? ['rapide'] : ['tres-rapide']
    }
    case 'longueur': {
      const m = t.match(/\b(\d(?:[.,]\d)?) ?m\b/)
      if (!m) return []
      const len = Number(m[1].replace(',', '.'))
      return len === 1 ? ['1m'] : len === 1.5 ? ['1-5m'] : len === 2 ? ['2m'] : len === 3 ? ['3m'] : []
    }
    case 'capacite': {
      const m = t.match(/\b(\d{1,2})[ .]?000 ?mah\b/) ?? t.match(/\b(\d{1,2})k ?mah\b/)
      // "20 000 mAh", "20000mAh", or the shop's PowerBank names: "22,5W 20K"
      const k = t.match(/\b(\d{1,2})k\b/)
      const mah = m ? Number(m[1]) * 1000 : k ? Number(k[1]) * 1000 : Number(t.match(/\b(\d{4,5}) ?mah\b/)?.[1] ?? 0)
      if (!mah) return []
      return mah <= 7000 ? ['5000'] : mah <= 15000 ? ['10000'] : mah <= 25000 ? ['20000'] : ['30000']
    }
    case 'format': {
      if (typeCode === 'casque' || has(t, /\b(ohp|casque|headphone)/)) return ['casque']
      if (typeCode === 'airpods' || has(t, /\b(otw|tws|buds|pods|airpods|freepods|spacebuds)/)) return ['sans-fil']
      if (has(t, /\b(oeb|neckband|tour de cou)\b/)) return ['tour-de-cou']
      if (has(t, /\blightning\b/)) return ['filaire-lightning']
      if (has(t, /\b(type-c|usb-c|oep-\d+c)\b/)) return ['filaire-usb-c']
      if (has(t, /\b(jack|oep)/)) return ['filaire-jack']
      return []
    }
    case 'fonctions':
      return has(t, /\b(anc|enc|réduction de bruit|noise)\b/) ? ['anc'] : []
    case 'powerbank': {
      const out: string[] = []
      if (has(t, /\b(magsafe|magnetic|magnétique|wireless|sans fil)\b/)) out.push('magsafe')
      if (has(t, /\b(lampe|lamp|led)\b/)) out.push('lampe')
      return out
    }
    case 'operateur':
      return has(t, /\b(iam|maroc telecom|itissalat)\b/) ? ['maroc-telecom'] : has(t, /\borange\b/) ? ['orange'] : has(t, /\binwi\b/) ? ['inwi'] : []
    case 'verre':
      return has(t, /\b(privacy|anti[- ]?espion|espion)\b/) ? ['anti-espion'] : has(t, /\b(mat|matte)\b/) ? ['mat']
        : has(t, /\b(cam[ée]ra|lens)\b/) ? ['camera'] : []
    default:
      return []
  }
}

/** Every product's suggested ticks (nothing is written). */
export async function suggestFacetTicks(db: Db): Promise<Suggestion[]> {
  const [products, groups, accessories, models] = await Promise.all([
    db.product.findMany({
      where: { isPhone: false, availability: { not: 'DISCONTINUED' } },
      select: { id: true, name: true, erpKey: true, categoryId: true, category: { select: { name: true, erpCode: true, parentId: true } }, facets: { select: { optionId: true } } },
      orderBy: { name: 'asc' },
    }),
    db.facetGroup.findMany({ where: { active: true }, select: { key: true, name: true, multi: true, categories: { select: { categoryId: true } }, options: { where: { active: true }, select: { id: true, key: true, name: true } } } }),
    prisma.accessories.findMany({ select: { acc_id: true, nom: true, marque: true, categorie: true } }),
    listCompatModels(),
  ])
  const accOf = new Map(accessories.map(a => [refOf('acc', a.acc_id), a]))
  // the phone models, longest name first ("iPhone 15 Pro Max" before "iPhone 15")
  const modelNames = models.map(m => m.model).sort((a, b) => b.length - a.length)

  const out: Suggestion[] = []
  for (const p of products) {
    const acc = p.erpKey ? accOf.get(p.erpKey) : undefined
    const text = [p.name, acc?.nom, acc?.marque].filter(Boolean).join(' ')
    const typeCode = acc?.categorie ?? p.category.erpCode
    const ticked = new Set(p.facets.map(f => f.optionId))
    const options: Suggestion['options'] = []
    for (const g of groups) {
      if (!g.categories.some(c => c.categoryId === p.categoryId || c.categoryId === p.category.parentId)) continue
      if (!g.multi && g.options.some(o => ticked.has(o.id))) continue
      let keys: string[]
      if (g.key === MODEL_GROUP) {
        // only models that already exist as choices (created when ticked in the picker)
        const lower = ` ${text.toLowerCase()} `
        const hit = modelNames.find(m => lower.includes(` ${m.toLowerCase()} `))
        const opt = hit && g.options.find(o => o.name.toLowerCase() === hit.toLowerCase())
        if (opt && !ticked.has(opt.id)) options.push({ id: opt.id, group: g.name, name: opt.name })
        continue
      } else keys = guess(g.key, text, typeCode)
      for (const k of (g.multi ? keys : keys.slice(0, 1))) {
        const opt = g.options.find(o => o.key === k)
        if (opt && !ticked.has(opt.id)) options.push({ id: opt.id, group: g.name, name: opt.name })
      }
    }
    if (options.length) out.push({ productId: p.id, name: p.name, erpName: acc ? [acc.marque, acc.nom].filter(Boolean).join(' ') : null, category: p.category.name, options })
  }
  return out
}

/** Adds the chosen ticks (only to active choices; a one-choice group keeps one). */
export async function applyFacetTicks(db: Db, items: { productId: string; optionIds: string[] }[]): Promise<number> {
  const groups = await db.facetGroup.findMany({ where: { active: true }, select: { multi: true, options: { where: { active: true }, select: { id: true } } } })
  const groupOf = new Map(groups.flatMap(g => g.options.map(o => [o.id, g] as const)))
  const rows: { productId: string; optionId: string }[] = []
  // every existing tick of these products, in one read
  const all = await db.productFacet.findMany({ where: { productId: { in: items.map(i => i.productId) } }, select: { productId: true, optionId: true } })
  for (const it of items) {
    const existing = new Set(all.filter(f => f.productId === it.productId).map(f => f.optionId))
    const usedSingle = new Set(groups.filter(g => !g.multi && g.options.some(o => existing.has(o.id))))
    for (const id of new Set(it.optionIds)) {
      const g = groupOf.get(id)
      if (!g || existing.has(id)) continue
      if (!g.multi) { if (usedSingle.has(g)) continue; usedSingle.add(g) }
      rows.push({ productId: it.productId, optionId: id })
    }
  }
  if (rows.length) await db.productFacet.createMany({ data: rows, skipDuplicates: true })
  return rows.length
}
