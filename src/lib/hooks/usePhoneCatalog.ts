'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

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
  const supabase = createClient()
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('phone_catalog')
        .select('*')
        .order('marque')
        .order('model')
      if (data) setCatalog(data)
      setLoading(false)
    }
    load()
  }, [supabase])

  const brands = Array.from(new Set(catalog.map(e => e.marque))).sort()

  const seriesFor = useCallback((brand: string) =>
    Array.from(new Set(catalog.filter(e => e.marque === brand).map(e => e.serie))).sort()
  , [catalog])

  const modelsFor = useCallback((brand: string, serie?: string) => {
    let entries = catalog.filter(e => e.marque === brand)
    if (serie) entries = entries.filter(e => e.serie === serie)
    return Array.from(new Set(entries.map(e => e.model))).sort()
  }, [catalog])

  const couleursFor = useCallback((model: string) =>
    Array.from(new Set(catalog.filter(e => e.model === model).map(e => e.couleur))).sort()
  , [catalog])

  // Called when staff types a model/color not in the catalog
  const addEntry = useCallback(async (entry: Omit<CatalogEntry, 'catalog_id'>) => {
    // Only insert if it doesn't already exist
    const exists = catalog.some(
      e => e.model === entry.model && e.couleur === entry.couleur
    )
    if (exists) return

    const { data, error } = await supabase
      .from('phone_catalog')
      .insert(entry as never)
      .select()
      .single()

    if (!error && data) {
      // Optimistically add to local state
      setCatalog(prev => [...prev, data])
    }
  }, [catalog, supabase])

  return { brands, seriesFor, modelsFor, couleursFor, addEntry, loading }
}