'use client'
import { useEffect } from 'react'
import { useLanguageStore } from '@/lib/stores/language'

/**
 * Keeps <html lang> and <html dir> in sync with the language store, once, for the whole app.
 * Previously `lang="fr"` was hardcoded in the root layout and never updated for Arabic, while
 * every page/component set `dir="rtl"|"ltr"` on its own root div instead — screen readers and
 * any future portal-rendered element (outside those per-component divs) would get the wrong
 * language/direction. This is the single source of truth; per-component `dir=` can stay as a
 * belt-and-suspenders layout hint but is no longer the only thing setting it.
 */
export default function HtmlLangSync() {
  const language = useLanguageStore(state => state.language)

  useEffect(() => {
    document.documentElement.lang = language === 'ar' ? 'ar' : 'fr'
    document.documentElement.dir  = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  return null
}
