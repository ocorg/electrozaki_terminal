import { useState, useEffect } from 'react'

// Single type definition used across the entire platform
export interface CategoryItem {
  fr: string  // French label shown in French mode
  ar: string  // Arabic label shown in Arabic mode — also the value stored in DB columns
}

export interface Categories {
  accessories: CategoryItem[]
  expenses:    CategoryItem[]
  suppliers:   CategoryItem[]
}

const EMPTY: Categories = { accessories: [], expenses: [], suppliers: [] }

// Module-level cache: one fetch per page session shared across all components
let _cache:   Categories | null       = null
let _promise: Promise<Categories> | null = null

function parse(raw: unknown): CategoryItem[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  // Handle legacy plain-string format from before bilingual support
  if (typeof raw[0] === 'string') return (raw as string[]).map(s => ({ fr: s, ar: s }))
  return raw as CategoryItem[]
}

async function load(): Promise<Categories> {
  if (_cache)   return _cache
  if (_promise) return _promise
  _promise = fetch('/api/categories')
    .then(r => { if (!r.ok) throw new Error('fetch failed'); return r.json() })
    .then(json => {
      _cache = {
        accessories: parse(json.accessories),
        expenses:    parse(json.expenses),
        suppliers:   parse(json.suppliers),
      }
      return _cache
    })
    .catch(() => EMPTY)
  return _promise
}

export function useCategories() {
  const [cats,   setCats]   = useState<Categories>(_cache ?? EMPTY)
  const [loaded, setLoaded] = useState(!!_cache)

  useEffect(() => {
    if (_cache) { setCats(_cache); setLoaded(true); return }
    load().then(c => { setCats(c); setLoaded(true) })
  }, [])

  function invalidate() { _cache = null; _promise = null }

  return { ...cats, loaded, invalidate }
}