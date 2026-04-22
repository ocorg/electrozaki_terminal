'use client'
import { useState, useEffect } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { toast } from 'sonner'
import { Clock, LogIn, LogOut, Loader2 } from 'lucide-react'

interface Punch {
  attendance_id: string
  punch_type:    'in' | 'out'
  punched_at:    string
  user_name:     string
}

interface AttendanceWidgetProps {
  storeId: string
}

export default function AttendanceWidget({ storeId }: AttendanceWidgetProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor

  const [punches, setPunches]   = useState<Punch[]>([])
  const [loading, setLoading]   = useState(true)
  const [punching, setPunching] = useState(false)

  const today = new Date().toISOString().split('T')[0]

  async function fetchToday() {
    try {
      const res  = await fetch(`/api/attendance?store_id=${storeId}&date=${today}`)
      const json = await res.json()
      // Only show current user's punches
      const mine = (json.data || []).filter((p: Punch) => p.user_name === user?.display_name)
      setPunches(mine)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (user) fetchToday() }, [user])

  const lastPunch  = punches[0]
  const isCurrentlyIn = lastPunch?.punch_type === 'in'
  const nextAction    = isCurrentlyIn ? 'out' : 'in'

  async function handlePunch() {
    setPunching(true)
    try {
      const res  = await fetch('/api/attendance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ store_id: storeId, punch_type: nextAction }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(
        nextAction === 'in'
          ? (isAr ? 'تم تسجيل الحضور ✓' : 'Pointage entrée enregistré ✓')
          : (isAr ? 'تم تسجيل الخروج ✓' : 'Pointage sortie enregistré ✓')
      )
      await fetchToday()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setPunching(false)
    }
  }

  if (loading) return null

  return (
    <div className="bg-white border border-[#E8E5DE] rounded-2xl p-5"
         style={{ borderLeftColor: isCurrentlyIn ? '#10B981' : '#B0ADA6', borderLeftWidth: '3px' }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-[#6B6860] font-medium uppercase tracking-widest">
            {isAr ? 'الحضور' : 'Pointage'}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-2 h-2 rounded-full ${isCurrentlyIn ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <p className="text-sm font-bold text-[#1A1A1A]">
              {isCurrentlyIn
                ? (isAr ? 'حاضر' : 'En service')
                : (isAr ? 'خارج الخدمة' : 'Hors service')}
            </p>
          </div>
          {lastPunch && (
            <p className="text-xs text-[#B0ADA6] mt-0.5">
              {isAr
                ? (lastPunch.punch_type === 'in' ? 'دخل في' : 'خرج في')
                : (lastPunch.punch_type === 'in' ? 'Entrée à' : 'Sortie à')}
              {' '}
              {new Date(lastPunch.punched_at).toLocaleTimeString('fr-FR', {
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
          )}
        </div>

        <button
          onClick={handlePunch}
          disabled={punching}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all active:scale-[0.97] disabled:opacity-50"
          style={{
            backgroundColor: nextAction === 'in' ? `${primary}15` : '#FEF2F2',
            color:           nextAction === 'in' ? primary : '#EF4444',
            border:          `1px solid ${nextAction === 'in' ? `${primary}30` : '#FECACA'}`,
          }}
        >
          {punching
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : nextAction === 'in'
            ? <LogIn className="w-4 h-4" />
            : <LogOut className="w-4 h-4" />
          }
          {nextAction === 'in'
            ? (isAr ? 'تسجيل الحضور' : 'Pointer entrée')
            : (isAr ? 'تسجيل الخروج' : 'Pointer sortie')}
        </button>
      </div>

      {/* Today's punch history */}
      {punches.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[#F2F0EB]">
          <p className="text-[10px] font-bold text-[#B0ADA6] uppercase tracking-widest mb-2">
            {isAr ? 'سجل اليوم' : "Historique du jour"}
          </p>
          <div className="flex flex-wrap gap-2">
            {[...punches].reverse().map(p => (
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
      )}
    </div>
  )
}