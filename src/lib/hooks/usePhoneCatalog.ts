'use client'
import { useState, useEffect, useCallback } from 'react'

export interface CatalogEntry {
  catalog_id: string
  marque:     string
  serie:      string
  type:       string
  model:      string
  couleur:    string
}

interface CatalogState {
  brands:      string[]
  seriesFor:   (brand: string) => string[]
  modelsFor:   (brand: string, serie?: string) => string[]
  couleursFor: (model: string) => string[]
  addEntry:    (entry: Omit<CatalogEntry, 'catalog_id'>) => Promise<void>
  loading:     boolean
}

// Strip the brand family word(s) from the beginning of a model name.
// "iPhone 13 Pro"  with serie "iPhone 13"  → "13 Pro"
// "Galaxy S24 Ultra" with serie "Galaxy S24" → "S24 Ultra"
// If no prefix is found, returns the model unchanged.
function stripBrandPrefix(serie: string, model: string): string {
  // Capture the leading all-letter word(s) up to the first digit in the serie
  const match  = serie.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]*?)(?=\s*\d|\s*$)/i)
  const prefix = match?.[1]?.trim()
  if (!prefix || prefix.length < 2) return model
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const stripped = model.replace(new RegExp(`^${escaped}\\s+`, 'i'), '').trim()
  return stripped || model
}

export function usePhoneCatalog(): CatalogState {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/phones/catalog')
      .then(r => r.json())
      .then(json => { if (json.data?.length) setCatalog(json.data) })
      .catch(err => console.error('[usePhoneCatalog]', err))
      .finally(() => setLoading(false))
  }, [])

  const brands = Array.from(new Set(catalog.map(e => e.marque))).sort()

  const seriesFor = useCallback((brand: string) =>
    Array.from(new Set(catalog.filter(e => e.marque === brand).map(e => e.serie))).sort()
  , [catalog])

  const modelsFor = useCallback((brand: string, serie?: string) => {
    let entries = catalog.filter(e => e.marque === brand)
    if (serie) entries = entries.filter(e => e.serie === serie)
    const unique = Array.from(new Set(entries.map(e => e.model))).sort()
    // Return stripped versions — "iPhone 13 Pro" → "13 Pro" when serie = "iPhone 13"
    return serie
      ? unique.map(m => stripBrandPrefix(serie, m))
      : unique
  }, [catalog])

  const couleursFor = useCallback((model: string) =>
    // Match against both full catalog model (legacy) and stripped model (new entries)
    Array.from(new Set(
      catalog.filter(e =>
        e.model === model ||
        stripBrandPrefix(e.serie, e.model) === model
      ).map(e => e.couleur)
    )).sort()
  , [catalog])

  // Called when staff types a model/color not in the catalog
  const addEntry = useCallback(async (entry: Omit<CatalogEntry, 'catalog_id'>) => {
    // Only insert if it doesn't already exist
    const exists = catalog.some(
      e => e.model === entry.model && e.couleur === entry.couleur
    )
    if (exists) return

    const res = await fetch('/api/phones/catalog', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(entry),
    })
    if (res.ok) {
      const { data } = await res.json()
      setCatalog(prev => [...prev, data])
    }
  }, [catalog])

  return { brands, seriesFor, modelsFor, couleursFor, addEntry, loading }
}