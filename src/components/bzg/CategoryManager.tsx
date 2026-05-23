'use client'
import { useState, useEffect } from 'react'
import { useLanguageStore } from '@/lib/stores/language'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { Tag, Plus, X, Save, Loader2 } from 'lucide-react'

type CatType = 'accessories' | 'expenses' | 'suppliers'

interface SectionState {
  categories: string[]
  input:      string
  saving:     boolean
  dirty:      boolean
}

const SECTION_META: { key: CatType; labelFr: string; labelAr: string; color: string }[] = [
  { key: 'accessories', labelFr: 'Accessoires',  labelAr: 'الإكسسوارات', color: '#8B5CF6' },
  { key: 'expenses',    labelFr: 'Dépenses',     labelAr: 'المصاريف',    color: '#EF4444' },
  { key: 'suppliers',   labelFr: 'Fournisseurs', labelAr: 'الموردون',    color: '#10B981' },
]

export default function CategoryManager() {
  const { language } = useLanguageStore()
  const isAr         = language === 'ar'

  const [loading,  setLoading]  = useState(true)
  const [sections, setSections] = useState<Record<CatType, SectionState>>({
    accessories: { categories: [], input: '', saving: false, dirty: false },
    expenses:    { categories: [], input: '', saving: false, dirty: false },
    suppliers:   { categories: [], input: '', saving: false, dirty: false },
  })

  useEffect(() => {
    fetch('/api/categories')
      .then(r => r.json())
      .then(json => {
        setSections(prev => ({
          accessories: { ...prev.accessories, categories: json.accessories ?? [] },
          expenses:    { ...prev.expenses,    categories: json.expenses    ?? [] },
          suppliers:   { ...prev.suppliers,   categories: json.suppliers   ?? [] },
        }))
      })
      .catch(() => showError('Erreur chargement catégories'))
      .finally(() => setLoading(false))
  }, [])

  function setSection(type: CatType, patch: Partial<SectionState>) {
    setSections(prev => ({ ...prev, [type]: { ...prev[type], ...patch } }))
  }

  function addCategory(type: CatType) {
    const val = sections[type].input.trim()
    if (!val) return
    if (sections[type].categories.includes(val)) {
      showError(isAr ? 'الفئة موجودة مسبقاً' : 'Cette catégorie existe déjà')
      return
    }
    setSection(type, {
      categories: [...sections[type].categories, val],
      input:      '',
      dirty:      true,
    })
  }

  function removeCategory(type: CatType, cat: string) {
    setSection(type, {
      categories: sections[type].categories.filter(c => c !== cat),
      dirty:      true,
    })
  }

  async function saveSection(type: CatType) {
    const cats = sections[type].categories
    if (cats.length === 0) {
      showError(isAr ? 'يجب أن تكون هناك فئة واحدة على الأقل' : 'Au moins une catégorie requise')
      return
    }
    setSection(type, { saving: true })
    try {
      const res  = await fetch('/api/categories', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type, categories: cats }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      // Bust the useCategories module cache so other components pick up changes
      ;(window as any).__bzgCatVersion = Date.now()
      showSuccess(isAr ? 'تم الحفظ ✓' : 'Catégories sauvegardées ✓')
      setSection(type, { dirty: false })
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSection(type, { saving: false })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-[#B0ADA6]" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {SECTION_META.map(({ key, labelFr, labelAr, color }) => {
        const s = sections[key]
        return (
          <div key={key} className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
            {/* Section header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#F2F0EB]"
              style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4" style={{ color }} />
                <p className="text-sm font-bold text-[#1A1A1A]">
                  {isAr ? labelAr : labelFr}
                </p>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F2F0EB] text-[#6B6860]">
                  {s.categories.length}
                </span>
              </div>
              {s.dirty && (
                <button
                  onClick={() => saveSection(key)}
                  disabled={s.saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#1A1A1A] text-white hover:bg-[#333] transition-all disabled:opacity-50">
                  {s.saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  {isAr ? 'حفظ' : 'Enregistrer'}
                </button>
              )}
            </div>

            {/* Category chips */}
            <div className="p-4 flex flex-wrap gap-2">
              {s.categories.map(cat => (
                <div key={cat}
                  className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full text-xs font-bold border border-[#E8E5DE] bg-[#F8F7F4] text-[#1A1A1A] group">
                  {cat}
                  <button
                    onClick={() => removeCategory(key, cat)}
                    className="w-4 h-4 rounded-full bg-[#E8E5DE] text-[#6B6860] hover:bg-red-100 hover:text-red-600 transition-all flex items-center justify-center">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}

              {/* Add input */}
              <div className="flex items-center gap-1.5 border border-dashed border-[#C9A440] rounded-full px-2 py-1">
                <input
                  type="text"
                  className="w-24 text-xs bg-transparent outline-none text-[#1A1A1A] placeholder:text-[#B0ADA6]"
                  placeholder={isAr ? 'فئة جديدة...' : 'Nouvelle...'}
                  value={s.input}
                  onChange={e => setSection(key, { input: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory(key) } }}
                  dir="rtl"
                />
                <button
                  onClick={() => addCategory(key)}
                  disabled={!s.input.trim()}
                  className="w-5 h-5 rounded-full bg-[#C9A440] text-white flex items-center justify-center disabled:opacity-30 hover:bg-[#b8922d] transition-all flex-shrink-0">
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            <p className="px-5 pb-3 text-[10px] text-[#B0ADA6]">
              {isAr
                ? 'اضغط Enter أو + لإضافة • اضغط × لحذف • لا تنسَ الحفظ'
                : 'Appuyez Entrée ou + pour ajouter · × pour supprimer · N\'oubliez pas d\'enregistrer'}
            </p>
          </div>
        )
      })}
    </div>
  )
}