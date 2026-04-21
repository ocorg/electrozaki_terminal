import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Language = 'fr' | 'ar'

interface LanguageStore {
  language:    Language
  setLanguage: (lang: Language) => void
}

export const useLanguageStore = create<LanguageStore>()(
  persist(
    (set) => ({
      language:    'fr',
      setLanguage: (lang) => set({ language: lang }),
    }),
    { name: 'bzg-language' }
  )
)