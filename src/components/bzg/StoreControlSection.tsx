'use client'
import { useState, useEffect } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { toast } from 'sonner'
import { Store, Loader2 } from 'lucide-react'

interface StoreRecord {
  store_id:    string
  name:        string
  theme_color: string
  is_active:   boolean
}

export default function StoreControlSection() {
  const { user }   = useUser()
  const [stores,   setStores]   = useState<StoreRecord[]>([])
  const [loading,  setLoading]  = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/stores')
      .then(r => r.json())
      .then(j => setStores(j.data || []))
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Only owner sees this section
  if (user?.role !== 'owner') return null

  async function toggleStore(store_id: string, current: boolean) {
    setToggling(store_id)
    try {
      const res = await fetch('/api/stores', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ store_id, is_active: !current }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setStores(prev =>
        prev.map(s => s.store_id === store_id ? { ...s, is_active: !current } : s)
      )
      toast.success(`${store_id} — ${!current ? 'activée ✓' : 'désactivée'}`)
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setToggling(null)
    }
  }

  return (
    <div className="mb-8 bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">

      {/* Header */}
      <div className="px-6 py-4 border-b border-[#E8E5DE] flex items-center gap-2">
        <Store className="w-4 h-4 text-[#6B6860]" />
        <p className="font-bold text-sm text-[#1A1A1A]">
          Gestion des boutiques
        </p>
        <span className="text-[10px] text-[#B0ADA6] ml-auto">
          Propriétaire uniquement
        </span>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2
            className="w-5 h-5 text-[#B0ADA6]"
            style={{ animation: 'spin 1s linear infinite' }}
          />
        </div>
      ) : (
        <div className="divide-y divide-[#F2F0EB]">
          {stores.map(store => (
            <div
              key={store.store_id}
              className="flex items-center justify-between px-6 py-4"
            >
              {/* Store info */}
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: store.theme_color }}
                >
                  {store.store_id.replace(/[^A-Z]/g, '').slice(0, 2)}
                </div>
                <div>
                  <p className="text-sm font-bold text-[#1A1A1A]">{store.name}</p>
                  <p className="text-xs text-[#B0ADA6]">{store.store_id}</p>
                </div>
              </div>

              {/* Toggle */}
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold ${
                  store.is_active ? 'text-emerald-600' : 'text-red-500'
                }`}>
                  {store.is_active ? 'Active' : 'Inactive'}
                </span>
                <button
                  onClick={() => toggleStore(store.store_id, store.is_active)}
                  disabled={toggling === store.store_id}
                  className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
                    store.is_active ? 'bg-emerald-500' : 'bg-red-300'
                  }`}
                >
                  {toggling === store.store_id ? (
                    <Loader2
                      className="absolute inset-0 m-auto w-3.5 h-3.5 text-white"
                      style={{ animation: 'spin 1s linear infinite' }}
                    />
                  ) : (
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      store.is_active ? 'left-7' : 'left-1'
                    }`} />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}