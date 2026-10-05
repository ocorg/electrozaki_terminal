// One rule for finding a phone by typing (Téléphones and the POS), owner's
// request 2026-10-05: a search looks at what the phone IS — brand, series,
// model, colour — never at storage or battery (those have their own filter).
// A number must match a whole number: "12" finds the iPhone 12 and the A12,
// not every 128 GB or 512 GB phone. A long number is an IMEI.

interface Searchable {
  marque?: string | null
  serie?: string | null
  model?: string | null
  couleur?: string | null
  imei?: string | null
  imei_2?: string | null
}

const IMEI_MIN = 4   // digits typed before a number is read as (part of) an IMEI

const textOf = (p: Searchable) =>
  `${p.marque ?? ''} ${p.marque === 'Apple' ? 'iphone' : ''} ${p.serie ?? ''} ${p.model ?? ''} ${p.couleur ?? ''}`.toLowerCase()

function tokenHits(p: Searchable, text: string, tok: string) {
  if (!/^\d+$/.test(tok)) return text.includes(tok)
  if (tok.length >= IMEI_MIN) return [p.imei, p.imei_2].some(v => v?.includes(tok))
  return new RegExp(`(?<!\\d)${tok}(?!\\d)`).test(text)
}

/** True when the phone answers every word of the search. */
export function phoneMatches(p: Searchable, query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const text = textOf(p)
  return tokens.every(tok => tokenHits(p, text, tok))
}
