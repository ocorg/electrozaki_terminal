'use client'
import { useApi } from '@/lib/data/api'

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

export function categoryLabel(list: CategoryItem[], code: string | null | undefined, isAr: boolean): string {
  if (!code) return ''
  const c = list.find(x => x.code === code)
  return c ? (isAr ? c.ar : c.fr) : code
}

// Shared cache: one request for every screen, refreshed when categories change
export function useCategories() {
  const { data, error, refresh } = useApi<Categories, Partial<Categories>>('/api/categories', {
    select: json => ({ accessories: json.accessories ?? [], expenses: json.expenses ?? [], suppliers: json.suppliers ?? [] }),
  })
  return { ...(data ?? EMPTY), loaded: data !== undefined || !!error, invalidate: refresh }
}
