import type { Phone, Prospect } from '@/types/database'

// One rule for "this phone fits this prospect", shared by the Prospects cards
// and the prospect badge in the Phones list so both always agree.
//  - modèle : same brand, model contains the request, same storage (each optional)
//  - budget : sale price between budget_min (optional) and budget_max
export function phoneMatchesProspect(p: Prospect, ph: Phone): boolean {
  if (p.demand_type === 'modele') {
    const marqueOk   = !p.marque   || p.marque.toLowerCase() === ph.marque.toLowerCase()
    const modelOk    = !p.model    || ph.model.toLowerCase().includes(p.model.toLowerCase())
    const stockageOk = !p.stockage || p.stockage === ph.stockage
    return marqueOk && modelOk && stockageOk
  }
  if (p.demand_type === 'budget') {
    const price = Number(ph.prix_vente_recommande ?? 0)
    const max   = Number(p.budget_max ?? 0)
    const min   = Number(p.budget_min ?? 0)
    return price > 0 && max > 0 && price <= max && price >= min
  }
  return false
}

/** Matching phones, most relevant first: budget → closest to the top of the
 *  budget; modèle → cheapest first. */
export function prospectMatches(p: Prospect, phones: Phone[]): Phone[] {
  const price = (ph: Phone) => Number(ph.prix_vente_recommande ?? 0)
  return phones
    .filter(ph => phoneMatchesProspect(p, ph))
    .sort((a, b) => p.demand_type === 'budget' ? price(b) - price(a) : price(a) - price(b))
}
