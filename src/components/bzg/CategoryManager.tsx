'use client'
import { useState, useEffect } from 'react'
import { useLanguageStore } from '@/lib/stores/language'
import { useCategories, type CategoryItem } from '@/lib/hooks/useCategories'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { Tag, Plus, X, Save, Loader2, AlertCircle } from 'lucide-react'

type CatType = 'accessories' | 'expenses' | 'suppliers'

const SECTIONS: { key: CatType; fr: string; ar: string; color: string }[] = [
  { key: 'accessories', fr: 'Accessoires',  ar: 'الإكسسوارات', color: '#8B5CF6' },
  { key: 'expenses',    fr: 'Dépenses',     ar: 'المصاريف',    color: '#EF4444' },
  { key: 'suppliers',   fr: 'Fournisseurs', ar: 'الموردون',    color: '#10B981' },
]

interface SectionState {
  categories: CategoryItem[]
  inputFr:    string
  inputAr:    string
  saving:     boolean
  dirty:      boolean
}

const emptySection = (): SectionState =>
  ({ categories: [], inputFr: '', inputAr: '', saving: false, dirty: false })

export default function CategoryManager() {
  const { language }   = useLanguageStore()
  const { invalidate } = useCategories()
  const isAr           = language === 'ar'

  const [loading, setLoading]   = useState(true)
  const [sections, setSections] = useState<Record<CatType, SectionState>>({
    accessories: emptySection(),
    expenses:    emptySection(),
    suppliers:   emptySection(),
  })

  useEffect(() => {
    fetch('/api/categories')
      .then(r => r.json())
      .then(json => setSections({
        accessories: { ...emptySection(), categories: json.accessories ?? [] },
        expenses:    { ...emptySection(), categories: json.expenses    ?? [] },
        suppliers:   { ...emptySection(), categories: json.suppliers   ?? [] },
      }))
      .catch(() => showError('Erreur chargement catégories'))
      .finally(() => setLoading(false))
  }, [])

  function patch(type: CatType, p: Partial<SectionState>) {
    setSections(prev => ({ ...prev, [type]: { ...prev[type], ...p } }))
  }

  function add(type: CatType) {
    const fr = sections[type].inputFr.trim()
    const ar = sections[type].inputAr.trim()
    if (!fr || !ar) {
      showError(isAr ? 'أدخل الاسم بالفرنسية والعربية' : 'Entrez le nom en français ET en arabe')
      return
    }
    if (sections[type].categories.some(c => c.ar === ar || c.fr === fr)) {
      showError(isAr ? 'الفئة موجودة' : 'Catégorie déjà existante')
      return
    }
    patch(type, {
      categories: [...sections[type].categories, { fr, ar }],
      inputFr: '', inputAr: '', dirty: true,
    })
  }

  function remove(type: CatType, ar: string) {
    patch(type, {
      categories: sections[type].categories.filter(c => c.ar !== ar),
      dirty: true,
    })
  }

  async function save(type: CatType) {
    const cats = sections[type].categories
    if (!cats.length) { showError(isAr ? 'فئة واحدة على الأقل' : 'Au moins une catégorie'); return }
    patch(type, { saving: true })
    try {
      const res  = await fetch('/api/categories', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type, categories: cats }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      invalidate()
      showSuccess(isAr ? 'تم الحفظ ✓' : 'Enregistré ✓')
      patch(type, { dirty: false })
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      patch(type, { saving: false })
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-10">
      <Loader2 className="w-5 h-5 animate-spin text-[#B0ADA6]" />
    </div>
  )

  return (
    <div className="space-y-4">
      {SECTIONS.map(({ key, fr, ar, color }) => {
        const s = sections[key]
        return (
          <div key={key} className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">

            {/* Section header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#F2F0EB]"
              style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4" style={{ color }} />
                <span className="text-sm font-bold text-[#1A1A1A]">{isAr ? ar : fr}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F2F0EB] text-[#6B6860]">
                  {s.categories.length}
                </span>
              </div>
              {s.dirty && (
                <button onClick={() => save(key)} disabled={s.saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#1A1A1A] text-white hover:bg-[#333] transition-all disabled:opacity-50">
                  {s.saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  {isAr ? 'حفظ' : 'Enregistrer'}
                </button>
              )}
            </div>

            {/* Chips */}
            <div className="px-4 pt-4 pb-2 flex flex-wrap gap-2">
              {s.categories.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-[#B0ADA6] py-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {isAr ? 'لا توجد فئات — أضف أدناه' : 'Aucune catégorie — ajoutez ci-dessous'}
                </div>
              ) : s.categories.map(cat => (
                <div key={cat.ar}
                  className="flex items-center gap-1 pl-3 pr-1.5 py-1.5 rounded-full text-xs font-semibold border border-[#E8E5DE] bg-[#F8F7F4]">
                  <span className="text-[#1A1A1A]">{isAr ? cat.ar : cat.fr}</span>
                  <span className="text-[9px] text-[#B0ADA6]">
                    {isAr ? `(${cat.fr})` : `(${cat.ar})`}
                  </span>
                  <button onClick={() => remove(key, cat.ar)}
                    className="ml-1 w-4 h-4 rounded-full bg-[#E8E5DE] text-[#6B6860] hover:bg-red-100 hover:text-red-500 transition-all flex items-center justify-center">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add inputs */}
            <div className="px-4 pb-4 flex gap-2 items-center flex-wrap">
              <input
                type="text"
                className="flex-1 min-w-[130px] border border-[#E8E5DE] rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#C9A440] transition-all"
                placeholder="Français — ex: Pochette"
                value={s.inputFr}
                onChange={e => patch(key, { inputFr: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') add(key) }}
              />
              <input
                type="text"
                className="flex-1 min-w-[130px] border border-[#E8E5DE] rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#C9A440] transition-all"
                placeholder="عربي — مثال: جيب"
                dir="rtl"
                value={s.inputAr}
                onChange={e => patch(key, { inputAr: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') add(key) }}
              />
              <button onClick={() => add(key)}
                disabled={!s.inputFr.trim() || !s.inputAr.trim()}
                className="p-2 rounded-xl bg-[#C9A440] text-white hover:bg-[#b8922d] disabled:opacity-30 transition-all flex-shrink-0">
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <p className="px-5 pb-3 text-[10px] text-[#B0ADA6]">
              {isAr
                ? 'أدخل الاسم بالفرنسية والعربية ← يُعرض الصحيح حسب اللغة في كل مكان ← لا تنسَ الحفظ'
                : 'Saisissez FR + AR → le bon label s\'affiche selon la langue partout → pensez à enregistrer'}
            </p>
          </div>
        )
      })}
    </div>
  )
}