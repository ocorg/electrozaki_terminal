import { useState, useEffect } from 'react'

export interface Categories {
  accessories: string[]
  expenses:    string[]
  suppliers:   string[]
}

const DEFAULTS: Categories = {
  accessories: ['كفر', 'شاحن', 'سماعة', 'واقي', 'سيم', 'أخرى'],
  expenses:    ['إيجار', 'فاتورة', 'نقل', 'صيانة', 'أجور', 'تسويق', 'معدات', 'أخرى'],
  suppliers:   ['هواتف', 'لابتوبات', 'إكسسوارات', 'كل شيء'],
}

// Module-level cache so all components share one fetch per page load
let _cache: Categories | null = null
let _promise: Promise<Categories> | null = null

async function fetchCategories(): Promise<Categories> {
  if (_cache) return _cache
  if (_promise) return _promise
  _promise = fetch('/api/categories')
    .then(r => r.json())
    .then(json => {
      _cache = {
        accessories: json.accessories ?? DEFAULTS.accessories,
        expenses:    json.expenses    ?? DEFAULTS.expenses,
        suppliers:   json.suppliers   ?? DEFAULTS.suppliers,
      }
      return _cache!
    })
    .catch(() => DEFAULTS)
  return _promise
}

export function useCategories() {
  const [categories, setCategories] = useState<Categories>(_cache ?? DEFAULTS)
  const [loaded, setLoaded]         = useState(!!_cache)

  useEffect(() => {
    if (_cache) { setCategories(_cache); setLoaded(true); return }
    fetchCategories().then(cats => { setCategories(cats); setLoaded(true) })
  }, [])

  // Call this after saving changes to force a re-fetch next time
  function invalidate() { _cache = null; _promise = null }

  return { ...categories, loaded, invalidate }
}