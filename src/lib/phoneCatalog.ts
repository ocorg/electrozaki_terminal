// Pure helpers behind the phone catalog lists (brand → series → model → colour).

// Strip the brand family word(s) from the beginning of a model name.
// "iPhone 13 Pro"  with serie "iPhone 13"  → "13 Pro"
// "Galaxy S24 Ultra" with serie "Galaxy S24" → "S24 Ultra"
// If no prefix is found, returns the model unchanged.
export function stripBrandPrefix(serie: string, model: string): string {
  // Capture the leading all-letter word(s) up to the first digit in the serie
  const match  = serie.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]*?)(?=\s*\d|\s*$)/i)
  const prefix = match?.[1]?.trim()
  if (!prefix || prefix.length < 2) return model
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const stripped = model.replace(new RegExp(`^${escaped}\\s+`, 'i'), '').trim()
  return stripped || model
}

// The catalog holds old and new spellings of the same thing ("iPhone 13 Pro"
// and "13 Pro", "Realme C75" and "C75"). Lists show each one once.
export const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim()

/** Series key without the brand word: "Realme C75" and "C75" are one series. */
export function serieKey(brand: string, serie: string): string {
  const n = norm(serie), b = norm(brand)
  return n.startsWith(b + ' ') ? n.slice(b.length + 1) : n
}

/** One label per key: the most used spelling (then the longest). */
export function uniqueLabels(values: { key: string; label: string }[]): string[] {
  const byKey = new Map<string, Map<string, number>>()
  for (const { key, label } of values) {
    const m = byKey.get(key) ?? new Map<string, number>()
    m.set(label, (m.get(label) ?? 0) + 1)
    byKey.set(key, m)
  }
  return Array.from(byKey.values())
    .map(m => Array.from(m.entries()).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0])
    .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
}
