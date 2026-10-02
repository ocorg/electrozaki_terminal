'use client'
import { useCallback, useMemo } from 'react'
import { useApi, apiWrite } from '@/lib/data/api'
import { stripBrandPrefix, norm, serieKey, uniqueLabels } from '@/lib/phoneCatalog'

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

export function usePhoneCatalog(): CatalogState {
  // Shared cache: loaded once for every screen that offers catalog suggestions
  const { data, isLoading: loading } = useApi<CatalogEntry[]>('/api/phones/catalog')
  const catalog = useMemo(() => data ?? [], [data])

  const brands = useMemo(() => Array.from(new Set(catalog.map(e => e.marque))).sort(), [catalog])

  const seriesFor = useCallback((brand: string) =>
    uniqueLabels(catalog.filter(e => e.marque === brand).map(e => ({ key: serieKey(brand, e.serie), label: e.serie })))
  , [catalog])

  const modelsFor = useCallback((brand: string, serie?: string) => {
    let entries = catalog.filter(e => e.marque === brand)
    if (serie) {
      const key = serieKey(brand, serie)
      entries = entries.filter(e => serieKey(brand, e.serie) === key)
    }
    // Short names ("iPhone 13 Pro" → "13 Pro" in the "iPhone 13" series),
    // deduplicated AFTER shortening so old and new spellings merge
    return uniqueLabels(entries.map(e => {
      const label = stripBrandPrefix(e.serie, e.model)
      return { key: norm(label), label }
    }))
  }, [catalog])

  const couleursFor = useCallback((model: string) => {
    // Match against both full catalog model (legacy) and stripped model (new entries)
    const m = norm(model)
    return uniqueLabels(catalog
      .filter(e => norm(e.model) === m || norm(stripBrandPrefix(e.serie, e.model)) === m)
      .map(e => ({ key: norm(e.couleur), label: e.couleur })))
  }, [catalog])

  // Called when staff types a model/color not in the catalog
  const addEntry = useCallback(async (entry: Omit<CatalogEntry, 'catalog_id'>) => {
    // Only insert if it doesn't already exist
    const exists = catalog.some(e =>
      (norm(e.model) === norm(entry.model) || norm(stripBrandPrefix(e.serie, e.model)) === norm(entry.model)) &&
      norm(e.couleur) === norm(entry.couleur)
    )
    if (exists) return

    // refreshes the shared catalog on success
    await apiWrite('/api/phones/catalog', { method: 'POST', body: entry }).catch(() => {})
  }, [catalog])

  return { brands, seriesFor, modelsFor, couleursFor, addEntry, loading }
}