import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Language } from '@/lib/i18n/translations'
import { translations } from '@/lib/i18n/translations'

interface LanguageStore {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string) => string
}

export const useLanguageStore = create<LanguageStore>()(
  persist(
    (set, get) => ({
      language: 'fr',
      setLanguage: (language) => set({ language }),
      t: (key: string) => {
        const lang = get().language
        const keys = key.split('.')
        let value: unknown = translations[lang]
        for (const k of keys) {
          if (value && typeof value === 'object') {
            value = (value as Record<string, unknown>)[k]
          } else {
            return key
          }
        }
        return typeof value === 'string' ? value : key
      },
    }),
    { name: 'ez-language' }
  )
)

// Convenience hook
export function useTranslation() {
  return useLanguageStore((s) => s.t)
}

// Translate a stored Arabic value (status, payment method, etc.)
export function useTranslateValue() {
  const lang = useLanguageStore((s) => s.language)
  return (key: string, category: keyof typeof translations['fr']): string => {
    const map = (translations[lang] as Record<string, Record<string, string>>)[category]
    return map?.[key] ?? key
  }
}
