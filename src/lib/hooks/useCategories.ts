import { useState, useEffect } from 'react'

// `code` is what's stored in accessories/expenses/suppliers.categorie;
// fr/ar are the labels shown depending on the interface language.
export interface CategoryItem {
  code: string
  fr:   string
  ar:   string
}

export interface Categories {
  accessories: CategoryItem[]
  expenses:    CategoryItem[]
  suppliers:   CategoryItem[]
}

const EMPTY: Categories = { accessories: [], expenses: [], suppliers: [] }

// Module-level cache: one fetch per page session shared across all components
let _cache:   Categories | null          = null
let _promise: Promise<Categories> | null = null

async function load(): Promise<Categories> {
  if (_cache)   return _cache
  if (_promise) return _promise
  _promise = fetch('/api/categories')
    .then(r => { if (!r.ok) throw new Error('fetch failed'); return r.json() })
    .then((json: Categories) => {
      _cache = { accessories: json.accessories ?? [], expenses: json.expenses ?? [], suppliers: json.suppliers ?? [] }
      return _cache
    })
    .catch(() => EMPTY)
  return _promise
}

export function categoryLabel(list: CategoryItem[], code: string | null | undefined, isAr: boolean): string {
  if (!code) return ''
  const c = list.find(x => x.code === code)
  return c ? (isAr ? c.ar : c.fr) : code
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
