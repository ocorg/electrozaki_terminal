import type { Phone, Prospect } from '@/types/database'

// One rule for "this phone fits this prospect", shared by the Prospects cards
// and the prospect badge in the Phones list so both always agree.
// Since 2026-09-28 a request mixes every criterion (owner's request): brands
// (one or several, stored "Apple, Samsung"), model, minimum storage and a
// budget — each optional, at least one given, all of them must fit.

/** The brands a prospect accepts ("Apple, Samsung" → ['Apple', 'Samsung']). */
export function prospectBrands(p: Pick<Prospect, 'marque'>): string[] {
  return (p.marque ?? '').split(',').map(b => b.trim()).filter(Boolean)
}

/** "128GB" → 128, "1TB" → 1024; null when unknown. */
export function storageGb(v: string | null | undefined): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(TB|TO|GB|GO)?/i.exec(v ?? '')
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  return /^t/i.test(m[2] ?? '') ? n * 1024 : n
}

export function hasCriteria(p: Prospect): boolean {
  return prospectBrands(p).length > 0 || !!p.model || !!p.stockage || p.budget_max != null || p.budget_min != null
}

export function phoneMatchesProspect(p: Prospect, ph: Phone): boolean {
  if (!hasCriteria(p)) return false
  const brands = prospectBrands(p).map(b => b.toLowerCase())
  if (brands.length && !brands.includes((ph.marque ?? '').toLowerCase())) return false
  if (p.model && !(ph.model ?? '').toLowerCase().includes(p.model.toLowerCase())) return false
  if (p.stockage) {
    const want = storageGb(p.stockage), have = storageGb(ph.stockage)
    if (want != null && (have == null || have < want)) return false
  }
  if (p.budget_max != null || p.budget_min != null) {
    const price = Number(ph.prix_vente_recommande ?? 0)
    if (price <= 0) return false
    if (p.budget_max != null && price > Number(p.budget_max)) return false
    if (p.budget_min != null && price < Number(p.budget_min)) return false
  }
  return true
}

/** Damaged or with replaced parts — shown apart from the clean phones. */
export function phoneIssues(ph: Phone): { damaged: boolean; replaced: number } {
  return { damaged: !!ph.is_damaged, replaced: Array.isArray(ph.replaced_components) ? ph.replaced_components.length : 0 }
}

/** Matching phones: clean ones first, then with a budget the closest to its
 *  top, otherwise the cheapest first. */
export function prospectMatches(p: Prospect, phones: Phone[]): Phone[] {
  const price = (ph: Phone) => Number(ph.prix_vente_recommande ?? 0)
  const flawed = (ph: Phone) => { const i = phoneIssues(ph); return i.damaged || i.replaced > 0 ? 1 : 0 }
  const byBudget = p.budget_max != null
  return phones
    .filter(ph => phoneMatchesProspect(p, ph))
    .sort((a, b) => flawed(a) - flawed(b) || (byBudget ? price(b) - price(a) : price(a) - price(b)))
}
