'use client'
import { useState, useEffect } from 'react'
import { useLanguageStore } from '@/lib/stores/language'
import { PageHeader, SkeletonRow, EmptyState } from '@/components/shared'
import { Users, RefreshCw, LogIn, LogOut, Calendar } from 'lucide-react'

interface Punch {
  attendance_id: string
  store_id:      string
  user_id:       string
  user_name:     string
  punch_type:    'in' | 'out'
  punched_at:    string
  date:          string
}

const STORES = [
  { id: 'EZ-001', name: 'Electro Zaki', color: '#C9A440' },
  { id: 'HP-001', name: 'Hamid Phone',  color: '#0EA5E9' },
]

export default function BZGStaffPage() {
  const { language } = useLanguageStore()
  const isAr = language === 'ar'

  const [punches, setPunches]       = useState<Punch[]>([])
  const [loading, setLoading]       = useState(true)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  async function fetchAll() {
    setLoading(true)
    try {
      const res  = await fetch(`/api/attendance?all=true&date=${selectedDate}`)
      const json = await res.json()
      setPunches(json.data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [selectedDate])

  // Get latest punch per user
  const latestPerUser = Object.values(
    punches.reduce((acc, p) => {
      if (!acc[p.user_id] || p.punched_at > acc[p.user_id].punched_at) {
        acc[p.user_id] = p
      }
      return acc
    }, {} as Record<string, Punch>)
  )

  const presentCount = latestPerUser.filter(p => p.punch_type === 'in').length
  const absentCount  = latestPerUser.filter(p => p.punch_type === 'out').length

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'حضور الفريق' : 'Présence équipe'}
          subtitle={isAr
            ? `${presentCount} حاضر · ${absentCount} غادر`
            : `${presentCount} présent${presentCount !== 1 ? 's' : ''} · ${absentCount} sorti${absentCount !== 1 ? 's' : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 bg-white border border-[#E8E5DE] rounded-xl px-3 py-2">
                <Calendar className="w-4 h-4 text-[#B0ADA6]" />
                <input type="date" value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="text-sm text-[#1A1A1A] focus:outline-none bg-transparent" />
              </div>
              <button onClick={fetchAll} disabled={loading}
                className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F5F3FF] transition-all">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          }
        />

        {/* Summary per store */}
        <div className="grid grid-cols-2 gap-4">
          {STORES.map(store => {
            const storeUsers = latestPerUser.filter(p => p.store_id === store.id)
            const present    = storeUsers.filter(p => p.punch_type === 'in').length
            return (
              <div key={store.id}
                className="bg-white border border-[#E8E5DE] rounded-2xl p-4"
                style={{ borderLeftColor: store.color, borderLeftWidth: '3px' }}>
                <p className="text-xs font-bold tracking-wide" style={{ color: store.color }}>
                  {store.name}
                </p>
                <p className="font-display font-bold text-2xl text-[#1A1A1A] mt-1">
                  {present}
                  <span className="text-sm font-normal text-[#B0ADA6] ml-1">
                    / {storeUsers.length} {isAr ? 'موظف' : 'employé(s)'}
                  </span>
                </p>
                <p className="text-xs text-emerald-600 mt-0.5">
                  {present > 0
                    ? (isAr ? 'حاضرون الآن' : 'Présent(s) maintenant')
                    : (isAr ? 'لا أحد حاضر' : 'Aucun présent')}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Full punch log */}
      <div className="flex-1 overflow-auto px-6 pb-6 space-y-6">
        {STORES.map(store => {
          const storePunches = punches.filter(p => p.store_id === store.id)
          const storeLatest  = latestPerUser.filter(p => p.store_id === store.id)
          if (storePunches.length === 0) return null

          return (
            <div key={store.id}>
              <h3 className="font-display font-bold text-[#1A1A1A] tracking-wide mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: store.color }} />
                {store.name}
              </h3>

              <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
                {loading ? (
                  <div className="divide-y divide-[#F2F0EB]">
                    {[...Array(2)].map((_, i) => <SkeletonRow key={i} />)}
                  </div>
                ) : (
                  <div className="divide-y divide-[#F2F0EB]">
                    {storeLatest.map(latest => {
                      const userPunches = [...punches]
                        .filter(p => p.user_id === latest.user_id)
                        .reverse()
                      const isIn = latest.punch_type === 'in'

                      return (
                        <div key={latest.user_id} className="px-5 py-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className={`w-2.5 h-2.5 rounded-full ${isIn ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              <div>
                                <p className="text-sm font-bold text-[#1A1A1A]">{latest.user_name}</p>
                                <p className={`text-xs font-medium ${isIn ? 'text-emerald-600' : 'text-slate-500'}`}>
                                  {isIn
                                    ? (isAr ? 'حاضر' : 'Présent')
                                    : (isAr ? 'غادر' : 'Sorti')}
                                  {' · '}
                                  {new Date(latest.punched_at).toLocaleTimeString('fr-FR', {
                                    hour: '2-digit', minute: '2-digit',
                                  })}
                                </p>
                              </div>
                            </div>

                            {/* Punch count */}
                            <span className="text-xs text-[#B0ADA6]">
                              {userPunches.length} {isAr ? 'بصمة' : 'pointage(s)'}
                            </span>
                          </div>

                          {/* Full timeline */}
                          <div className="flex flex-wrap gap-2">
                            {userPunches.map(p => (
                              <div key={p.attendance_id}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                                  p.punch_type === 'in'
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                    : 'bg-slate-50 border-slate-200 text-slate-600'
                                }`}>
                                {p.punch_type === 'in'
                                  ? <LogIn className="w-3 h-3" />
                                  : <LogOut className="w-3 h-3" />
                                }
                                {new Date(p.punched_at).toLocaleTimeString('fr-FR', {
                                  hour: '2-digit', minute: '2-digit',
                                })}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {!loading && punches.length === 0 && (
          <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
            <EmptyState
              icon={<Users className="w-7 h-7" />}
              title={isAr ? 'لا يوجد تسجيل حضور' : 'Aucun pointage'}
              description={isAr
                ? 'لم يتم تسجيل أي حضور لهذا اليوم'
                : 'Aucun pointage enregistré pour cette date'}
            />
          </div>
        )}
      </div>
    </div>
  )
}