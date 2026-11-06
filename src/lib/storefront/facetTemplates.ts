import type { PrismaClient } from '@/generated/storefront/client'

// A fiche for each accessory type (owner, 2026-11-06, step 3 of the
// accessories redesign): the choices a customer filters by in each aisle and
// staff tick in the fiche (Stock → Accessoires → Modèles & fiche). Pochettes
// already had theirs; the other types get the groups below.
// Installing only ADDS what is missing (a group, a choice, an aisle link):
// names, questions and choices changed by hand in Fiches & filtres are kept.

export type TemplateOption = { key: string; name: string; level?: number }
export type TemplateGroup = {
  key: string; name: string; question: string | null; multi: boolean
  display: 'CHIPS' | 'TILES' | 'METER'; sortOrder: number
  /** ERP accessory types (categories.code) whose aisle this group describes */
  types: string[]
  options: TemplateOption[]
}

export const FACET_TEMPLATES: TemplateGroup[] = [
  // the phone it fits: brand → series → model picker (lib/compatModels),
  // its choices are created when a model is ticked
  { key: 'modele', name: 'Modèle', question: 'Votre téléphone ?', multi: true, display: 'CHIPS', sortOrder: 0,
    types: ['pochette', 'glass', 'protection'], options: [] },
  { key: 'verre', name: 'Type de verre', question: 'Quel verre ?', multi: false, display: 'CHIPS', sortOrder: 20,
    types: ['glass'], options: [
      { key: 'clair', name: 'Clair' }, { key: 'anti-espion', name: 'Anti-espion' },
      { key: 'mat', name: 'Mat (anti-traces)' }, { key: 'camera', name: 'Protège-caméra' },
    ] },
  { key: 'cable', name: 'Câble', question: 'Quel câble ?', multi: true, display: 'CHIPS', sortOrder: 20,
    types: ['cable', 'chargeurs'], options: [
      { key: 'c-c', name: 'USB-C ↔ USB-C' }, { key: 'usb-c', name: 'USB → USB-C' },
      { key: 'c-lightning', name: 'USB-C → iPhone (Lightning)' }, { key: 'usb-lightning', name: 'USB → iPhone (Lightning)' },
      { key: 'micro-usb', name: 'USB → Micro-USB' }, { key: 'aux', name: 'Audio (jack / AUX)' }, { key: '3-en-1', name: '3 en 1' },
    ] },
  { key: 'puissance', name: 'Vitesse de charge', question: 'Quelle vitesse de charge ?', multi: false, display: 'METER', sortOrder: 30,
    types: ['cable', 'chargeurs', 'tete_de_chargeur', 'powerbank'], options: [
      { key: 'normale', name: 'Normale (jusqu’à 12 W)', level: 1 },
      { key: 'rapide', name: 'Rapide (20 à 30 W)', level: 2 },
      { key: 'tres-rapide', name: 'Très rapide (45 W et plus)', level: 3 },
    ] },
  { key: 'prises', name: 'Prises', question: null, multi: true, display: 'CHIPS', sortOrder: 40,
    types: ['chargeurs', 'tete_de_chargeur', 'powerbank'], options: [
      { key: 'usb-c', name: 'USB-C' }, { key: 'usb-a', name: 'USB' }, { key: 'plusieurs', name: '2 prises ou plus' },
    ] },
  { key: 'longueur', name: 'Longueur', question: null, multi: false, display: 'CHIPS', sortOrder: 50,
    types: ['cable'], options: [
      { key: '1m', name: '1 m' }, { key: '1-5m', name: '1,5 m' }, { key: '2m', name: '2 m' }, { key: '3m', name: '3 m' },
    ] },
  { key: 'format', name: 'Format', question: 'Quel format ?', multi: false, display: 'CHIPS', sortOrder: 20,
    types: ['ecouteurs', 'airpods', 'casque'], options: [
      { key: 'sans-fil', name: 'Sans fil (boîtier)' }, { key: 'tour-de-cou', name: 'Tour de cou' },
      { key: 'casque', name: 'Casque' }, { key: 'filaire-jack', name: 'Filaire jack' },
      { key: 'filaire-usb-c', name: 'Filaire USB-C' }, { key: 'filaire-lightning', name: 'Filaire iPhone (Lightning)' },
    ] },
  { key: 'fonctions', name: 'Fonctions', question: null, multi: true, display: 'CHIPS', sortOrder: 60,
    types: ['ecouteurs', 'airpods', 'casque'], options: [
      { key: 'anc', name: 'Réduction de bruit' }, { key: 'micro', name: 'Micro pour les appels' },
      { key: 'eau', name: 'Résiste à l’eau / sport' }, { key: 'jeu', name: 'Mode jeu' },
    ] },
  { key: 'capacite', name: 'Capacité', question: 'Combien de recharges ?', multi: false, display: 'METER', sortOrder: 20,
    types: ['powerbank'], options: [
      { key: '5000', name: '5 000 mAh (≈ 1 recharge)', level: 1 },
      { key: '10000', name: '10 000 mAh (≈ 2 recharges)', level: 2 },
      { key: '20000', name: '20 000 mAh (≈ 4 recharges)', level: 3 },
      { key: '30000', name: '30 000 mAh et plus', level: 4 },
    ] },
  { key: 'powerbank', name: 'Atouts', question: null, multi: true, display: 'CHIPS', sortOrder: 60,
    types: ['powerbank'], options: [
      { key: 'magsafe', name: 'MagSafe / sans fil' }, { key: 'cable-integre', name: 'Câble intégré' },
      { key: 'ecran', name: 'Écran du niveau' }, { key: 'lampe', name: 'Lampe' },
    ] },
  { key: 'operateur', name: 'Opérateur', question: 'Quel opérateur ?', multi: false, display: 'CHIPS', sortOrder: 20,
    types: ['carte_sim'], options: [
      { key: 'maroc-telecom', name: 'Maroc Telecom' }, { key: 'orange', name: 'Orange' }, { key: 'inwi', name: 'inwi' },
    ] },
  { key: 'fixation', name: 'Fixation', question: 'Où le fixer ?', multi: true, display: 'CHIPS', sortOrder: 20,
    types: ['support_magnetique'], options: [
      { key: 'grille', name: 'Grille d’aération' }, { key: 'tableau-de-bord', name: 'Tableau de bord / pare-brise' },
      { key: 'bureau', name: 'Bureau' }, { key: 'moto-velo', name: 'Moto / vélo' },
    ] },
]

export type TemplatePlan = {
  newGroups: { key: string; name: string; options: number; aisles: string[] }[]
  newOptions: { group: string; names: string[] }[]
  newLinks: { group: string; aisles: string[] }[]
  /** ERP types that have no aisle on the website yet (they get one at the next sync) */
  missingAisles: string[]
}

/** What installing would add (nothing is written when `apply` is false). */
export async function installFacetTemplates(db: Pick<PrismaClient, 'facetGroup' | 'facetOption' | 'facetGroupCategory' | 'category'>, apply: boolean): Promise<TemplatePlan> {
  const [groups, categories] = await Promise.all([
    db.facetGroup.findMany({ select: { id: true, key: true, name: true, options: { select: { key: true, name: true, sortOrder: true } }, categories: { select: { categoryId: true } } } }),
    db.category.findMany({ where: { erpCode: { not: null } }, select: { id: true, name: true, erpCode: true } }),
  ])
  const aisleOf = new Map(categories.map(c => [c.erpCode!, c]))
  const plan: TemplatePlan = { newGroups: [], newOptions: [], newLinks: [], missingAisles: [] }
  const missing = new Set<string>()

  for (const t of FACET_TEMPLATES) {
    const aisles = t.types.map(code => { const a = aisleOf.get(code); if (!a) missing.add(code); return a }).filter((a): a is NonNullable<typeof a> => !!a)
    const existing = groups.find(g => g.key === t.key)
    if (!existing) {
      plan.newGroups.push({ key: t.key, name: t.name, options: t.options.length, aisles: aisles.map(a => a.name) })
      if (apply) await db.facetGroup.create({
        data: {
          key: t.key, name: t.name, question: t.question, multi: t.multi, display: t.display, sortOrder: t.sortOrder,
          options: { create: t.options.map((o, i) => ({ key: o.key, name: o.name, level: o.level ?? null, sortOrder: i + 1 })) },
          categories: { create: aisles.map(a => ({ categoryId: a.id })) },
        },
      })
      continue
    }
    const haveKeys = new Set(existing.options.map(o => o.key))
    const haveNames = new Set(existing.options.map(o => o.name.toLowerCase()))
    const addOptions = t.options.filter(o => !haveKeys.has(o.key) && !haveNames.has(o.name.toLowerCase()))
    if (addOptions.length) {
      plan.newOptions.push({ group: existing.name, names: addOptions.map(o => o.name) })
      const last = Math.max(0, ...existing.options.map(o => o.sortOrder))
      if (apply) await db.facetOption.createMany({
        data: addOptions.map((o, i) => ({ groupId: existing.id, key: o.key, name: o.name, level: o.level ?? null, sortOrder: last + i + 1 })),
      })
    }
    const linked = new Set(existing.categories.map(c => c.categoryId))
    const addLinks = aisles.filter(a => !linked.has(a.id))
    if (addLinks.length) {
      plan.newLinks.push({ group: existing.name, aisles: addLinks.map(a => a.name) })
      if (apply) await db.facetGroupCategory.createMany({ data: addLinks.map(a => ({ groupId: existing.id, categoryId: a.id })) })
    }
  }
  plan.missingAisles = [...missing]
  return plan
}
