import type { Phone } from '@/types/database'
import { computePromoPrice } from '@/lib/utils'

// One rule for "this phone fits what this person asked for", shared by the
// CRM leads (which replaced Prospects, 2026-10-18), the badge in the Phones
// list and the alert when a phone comes in, so all of them always agree.
// A request mixes every criterion (owner's request, 2026-09-28): brands (one
// or several, stored "Apple, Samsung"), model, minimum storage and a budget —
// each optional, at least one given, all of them must fit.

/** What a person asked for (a CRM lead). */
export interface Wish {
  marque?:     string | null
  model?:      string | null
  stockage?:   string | null
  budget_min?: number | string | null
  budget_max?: number | string | null
}
type Priced = Pick<Phone, 'marque' | 'model' | 'stockage' | 'prix_vente_recommande' | 'promo_type' | 'promo_montant'>

/** The brands a request accepts ("Apple, Samsung" → ['Apple', 'Samsung']). */
export function prospectBrands(p: Pick<Wish, 'marque'>): string[] {
  return (p.marque ?? '').split(',').map(b => b.trim()).filter(Boolean)
}

/** "128GB" → 128, "1TB" → 1024; null when unknown. */
export function storageGb(v: string | null | undefined): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(TB|TO|GB|GO)?/i.exec(v ?? '')
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  return /^t/i.test(m[2] ?? '') ? n * 1024 : n
}

export function hasCriteria(p: Wish): boolean {
  return prospectBrands(p).length > 0 || !!p.model || !!p.stockage || p.budget_max != null || p.budget_min != null
}

export function phoneMatchesProspect(p: Wish, ph: Priced): boolean {
  if (!hasCriteria(p)) return false
  const brands = prospectBrands(p).map(b => b.toLowerCase())
  if (brands.length && !brands.includes((ph.marque ?? '').toLowerCase())) return false
  if (p.model && !(ph.model ?? '').toLowerCase().includes(p.model.toLowerCase())) return false
  if (p.stockage) {
    const want = storageGb(p.stockage), have = storageGb(ph.stockage)
    if (want != null && (have == null || have < want)) return false
  }
  if (p.budget_max != null || p.budget_min != null) {
    // the price the customer pays: the promo price when the phone has one
    const listed = Number(ph.prix_vente_recommande ?? 0)
    const price  = computePromoPrice(listed, ph.promo_type, ph.promo_montant) ?? listed
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
export function prospectMatches<P extends Phone>(p: Wish, phones: P[]): P[] {
  const price = (ph: Phone) => {
    const listed = Number(ph.prix_vente_recommande ?? 0)
    return computePromoPrice(listed, ph.promo_type, ph.promo_montant) ?? listed
  }
  const flawed = (ph: Phone) => { const i = phoneIssues(ph); return i.damaged || i.replaced > 0 ? 1 : 0 }
  const byBudget = p.budget_max != null
  return phones
    .filter(ph => phoneMatchesProspect(p, ph))
    .sort((a, b) => flawed(a) - flawed(b) || (byBudget ? price(b) - price(a) : price(a) - price(b)))
}
