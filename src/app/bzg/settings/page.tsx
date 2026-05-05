'use client'
import { useState, useEffect } from 'react'
import { useLanguageStore } from '@/lib/stores/language'
import { PageHeader, Field, inputClass, Btn } from '@/components/shared'
import { toast } from 'sonner'
import { Settings, Save, Store, Palette } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface StoreSetting {
  store_id:    string
  name:        string
  theme_color: string
  address:     string
  phone:       string
}

export default function BZGSettingsPage() {
  const { language } = useLanguageStore()
  const isAr   = language === 'ar'
  const supabase = createClient()

  const [stores, setStores]       = useState<StoreSetting[]>([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState<string | null>(null)
  const [edits, setEdits]         = useState<Record<string, Partial<StoreSetting>>>({})

  const [kvSettings, setKvSettings] = useState<{ key: string; value: string; store_id: string; notes?: string }[]>([])
  const [kvEdits, setKvEdits] = useState<Record<string, string>>({})

  async function fetchSettings() {
    const { data } = await (supabase as any).from('settings').select('*').order('key')
    if (data) {
      setKvSettings(data)
      const edits: Record<string, string> = {}
      data.forEach((s: { key: string; value: string; store_id: string }) => {
        edits[`${s.store_id}__${s.key}`] = s.value ?? ''
        edits[s.key] = s.value ?? ''   // fallback for single-store reads
      })
      setKvEdits(edits)
    }
  }

  async function saveKvSetting(key: string, storeId: string) {
    const { error } = await (supabase as any).from('settings').upsert({
      key,
      store_id:   storeId,
      value:      kvEdits[`${storeId}__${key}`] ?? kvEdits[key],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key,store_id' })
    if (error) toast.error(error.message)
    else toast.success(`${key} sauvegardé ✓`)
  }

  async function fetchStores() {
    setLoading(true)
    try {
      const { data } = await supabase.from('stores').select('*').order('created_at')
      setStores((data || []) as StoreSetting[])
      // Init edits
      const init: Record<string, Partial<StoreSetting>> = {}
      ;(data || []).forEach((s: StoreSetting) => { init[s.store_id] = { ...s } })
      setEdits(init)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStores(); fetchSettings() }, [])

  function setEdit(storeId: string, field: keyof StoreSetting, value: string) {
    setEdits(prev => ({
      ...prev,
      [storeId]: { ...prev[storeId], [field]: value },
    }))
  }

  async function saveStore(storeId: string) {
    setSaving(storeId)
    try {
      const updates = edits[storeId]
      const { error } = await (supabase as any)
        .from('stores')
        .update({
          name:        updates.name,
          theme_color: updates.theme_color,
          address:     updates.address,
          phone:       updates.phone,
        })
        .eq('store_id', storeId)
      if (error) throw error
      toast.success(isAr ? 'تم الحفظ ✓' : 'Enregistré ✓')
      await fetchStores()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-auto animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="px-6 pt-6 pb-4">
        <PageHeader
          title={isAr ? 'الإعدادات' : 'Paramètres'}
          subtitle={isAr ? 'إعدادات المتاجر والمنصة' : 'Configuration des magasins et de la plateforme'}
        />
      </div>

      <div className="flex-1 px-6 pb-6 space-y-6">
        {/* ── Key-Value Settings ── */}
      <div className="mt-8">
        <h2 className="font-display text-xl font-bold text-[#1A1A1A] tracking-wide mb-4">
          {isAr ? 'إعدادات متقدمة (مفتاح / قيمة)' : 'Paramètres avancés (clé / valeur)'}
        </h2>
        {kvSettings.length === 0 ? (
          <p className="text-sm text-[#B0ADA6]">
            {isAr ? 'لا توجد إعدادات بعد' : 'Aucun paramètre configuré.'}
          </p>
        ) : (
          <div className="space-y-3">
            {kvSettings.map(s => (
              <div key={s.key} className="bg-white border border-[#E8E5DE] rounded-xl p-4 flex items-center gap-4">
                <div className="flex-shrink-0 w-48">
                  <p className="text-xs font-mono text-[#6B6860]">{s.key}</p>
                  {s.notes && <p className="text-[10px] text-[#B0ADA6] mt-0.5">{s.notes}</p>}
                </div>
                <input className="flex-1 border border-[#E8E5DE] rounded-xl px-3 py-2 text-sm"
                  value={kvEdits[s.key] ?? ''}
                  onChange={e => setKvEdits(p => ({ ...p, [s.key]: e.target.value }))} />
                <button onClick={() => saveKvSetting(s.key, s.store_id)}
                  className="px-4 py-2 rounded-xl bg-[#C9A440] text-white text-sm font-bold hover:opacity-90 transition-all">
                  {isAr ? 'حفظ' : 'Sauver'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
        {loading ? (
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-64 bg-white border border-[#E8E5DE] rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          stores.map(store => {
            const edit = edits[store.store_id] ?? store
            return (
              <div key={store.store_id} className="bg-white border-2 border-[#E8E5DE] rounded-2xl overflow-hidden"
                   style={{ borderTopColor: edit.theme_color ?? store.theme_color, borderTopWidth: '3px' }}>

                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-[#E8E5DE]">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                       style={{ backgroundColor: `${edit.theme_color ?? store.theme_color}20` }}>
                    <Store className="w-4 h-4" style={{ color: edit.theme_color ?? store.theme_color }} />
                  </div>
                  <div>
                    <p className="font-display font-bold text-[#1A1A1A] tracking-wide">{store.name}</p>
                    <p className="text-xs text-[#B0ADA6]">{store.store_id}</p>
                  </div>
                </div>

                {/* Fields */}
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label={isAr ? 'اسم المتجر' : 'Nom du magasin'}>
                      <input type="text" className={inputClass}
                        value={edit.name ?? ''}
                        onChange={e => setEdit(store.store_id, 'name', e.target.value)} />
                    </Field>
                    <Field label={isAr ? 'رقم الهاتف' : 'Téléphone'}>
                      <input type="tel" className={inputClass}
                        placeholder="05XXXXXXXX"
                        value={edit.phone ?? ''}
                        onChange={e => setEdit(store.store_id, 'phone', e.target.value)} />
                    </Field>
                  </div>

                  <Field label={isAr ? 'العنوان' : 'Adresse'}>
                    <input type="text" className={inputClass}
                      placeholder={isAr ? 'مكناس، المغرب' : 'Meknès, Maroc'}
                      value={edit.address ?? ''}
                      onChange={e => setEdit(store.store_id, 'address', e.target.value)} />
                  </Field>

                  <Field label={isAr ? 'لون العلامة التجارية' : 'Couleur de la marque'}>
                    <div className="flex items-center gap-3">
                      <input type="color" className="w-10 h-10 rounded-xl cursor-pointer border border-[#E8E5DE]"
                        value={edit.theme_color ?? store.theme_color}
                        onChange={e => setEdit(store.store_id, 'theme_color', e.target.value)} />
                      <input type="text" className={inputClass}
                        value={edit.theme_color ?? store.theme_color}
                        onChange={e => setEdit(store.store_id, 'theme_color', e.target.value)}
                        placeholder="#C9A440" />
                      <Palette className="w-4 h-4 text-[#B0ADA6]" />
                    </div>
                  </Field>

                  <div className="flex justify-end pt-2">
                    <Btn
                      variant="primary"
                      onClick={() => saveStore(store.store_id)}
                      loading={saving === store.store_id}
                      style={{ backgroundColor: edit.theme_color ?? store.theme_color } as React.CSSProperties}
                    >
                      <Save className="w-4 h-4" />
                      {isAr ? 'حفظ التغييرات' : 'Enregistrer'}
                    </Btn>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}