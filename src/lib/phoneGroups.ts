// A group of phone models sharing one stock (owner, 2026-11-07: a glass or a
// pochette fits iPhone 13 / 14 / 15). Client-safe: used by screens and APIs.

const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

/** Models cleaned, without duplicates, in a stable order (the stored form). */
export function cleanModels(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const seen = new Map<string, string>()
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const m = norm(raw).slice(0, 40)
    if (m && !seen.has(m.toLowerCase())) seen.set(m.toLowerCase(), m)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }))
}

/** "iPhone 13 · 14 · 15 Pro" for iPhone 13, iPhone 14, iPhone 15 Pro. */
export function modelsLabel(models: string[]): string {
  if (!models.length) return ''
  if (models.length === 1) return models[0]
  const first = (m: string) => m.split(' ')[0]
  const head = first(models[0])
  if (models.every(m => first(m) === head && m.includes(' '))) {
    return `${head} ${models.map(m => m.slice(head.length + 1)).join(' · ')}`
  }
  return models.join(' · ')
}

export const hasModel = (models: string[], model: string | null | undefined) =>
  !!model && models.some(m => m.toLowerCase() === norm(model).toLowerCase())
