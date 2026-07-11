'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD, formatDate } from '@/lib/utils'
import { EmptyState, SkeletonRow } from '@/components/shared'
import {
  TrendingUp, Wrench, Vault, Users,
  RefreshCw, Clock, CheckCircle, XCircle, AlertTriangle
} from 'lucide-react'

const STORES = [
  { id: 'EZ-001', name: 'Electro Zaki', color: '#C9A440', bg: '#FAF5E8' },
]

interface StoreSnapshot {
  store_id:       string
  ca_today:       number
  ca_month:       number
  nb_ventes:      number
  active_repairs: number
  caisse_status:  'open' | 'pending_eod' | 'closed' | 'none'
  caisse_id?:     string
}

interface PendingEOD {
  caisse_id:    string
  store_id:     string
  store_name:   string
  date:         string
  solde_reel:   number | null
  solde_theorique: number | null
  ecart:        number | null
  submitted_by: string
}

interface StaffPunch {
  user_name:  string
  store_id:   string
  punch_type: 'in' | 'out'
  punched_at: string
}

export default function BZGDashboard() {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const supabase     = createClient()
  const isAr         = language === 'ar'

  const [snapshots, setSnapshots]     = useState<StoreSnapshot[]>([])
  const [pendingEOD, setPendingEOD]   = useState<PendingEOD[]>([])
  const [staffToday, setStaffToday]   = useState<StaffPunch[]>([])
  const [loading, setLoading]         = useState(true)
  const [lastSync, setLastSync]       = useState<Date | null>(null)
  const [approving, setApproving]     = useState<string | null>(null)

  async function fetchAll() {
    setLoading(true)
    try {
      const today      = new Date().toISOString().split('T')[0]
      const monthStart = today.slice(0, 7) + '-01'

      const [txnRes, repairRes, caisseRes, staffRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('store_id, prix_vente, date_vente')
          .eq('voided', false)
          .gte('date_vente', monthStart),

        supabase
          .from('reparations')
          .select('store_id, statut')
          .neq('statut', 'تم الاستلام'),

        supabase
          .from('caisse')
          .select('caisse_id, store_id, date, status, solde_reel, solde_theorique, ecart, eod_submitted_at, created_by')
          .gte('date', monthStart)
          .order('date', { ascending: false }),

        supabase
          .from('staff_attendance')
          .select('user_name, store_id, punch_type, punched_at')
          .eq('date', today)
          .order('punched_at', { ascending: false }),
      ])

      const txns    = (txnRes.data    || []) as Record<string, unknown>[]
      const repairs = (repairRes.data || []) as Record<string, unknown>[]
      const caisses = (caisseRes.data || []) as Record<string, unknown>[]
      const staff   = (staffRes.data  || []) as StaffPunch[]

      // Build per-store snapshot
      const snaps: StoreSnapshot[] = STORES.map(store => {
        const storeTxns   = txns.filter(t => t.store_id === store.id)
        const todayTxns   = storeTxns.filter(t => t.date_vente === today)
        const monthTxns   = storeTxns
        const storeRepairs = repairs.filter(r => r.store_id === store.id)

        const todayCaisse = caisses.find(c => c.store_id === store.id && c.date === today)

        return {
          store_id:       store.id,
          ca_today:       todayTxns.reduce((s, t) => s + ((t.prix_vente as number) || 0), 0),
          ca_month:       monthTxns.reduce((s, t) => s + ((t.prix_vente as number) || 0), 0),
          nb_ventes:      monthTxns.length,
          active_repairs: storeRepairs.length,
          caisse_status:  todayCaisse ? (todayCaisse.status as StoreSnapshot['caisse_status']) : 'none',
          caisse_id:      todayCaisse?.caisse_id as string | undefined,
        }
      })

      // Pending EOD approvals
      const pending: PendingEOD[] = caisses
        .filter(c => c.status === 'pending_eod')
        .map(c => ({
          caisse_id:       c.caisse_id as string,
          store_id:        c.store_id as string,
          store_name:      STORES.find(s => s.id === c.store_id)?.name ?? c.store_id as string,
          date:            c.date as string,
          solde_reel:      c.solde_reel as number | null,
          solde_theorique: c.solde_theorique as number | null,
          ecart:           c.ecart as number | null,
          submitted_by:    c.created_by as string ?? '—',
        }))

      setSnapshots(snaps)
      setPendingEOD(pending)
      setStaffToday(staff)
      setLastSync(new Date())
    } finally {
      setLoading(false)
    }
  }

  async function approveEOD(caisseId: string) {
    setApproving(caisseId)
    try {
      await (supabase as any)
        .from('caisse')
        .update({
          status:      'closed',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('caisse_id', caisseId)
      await fetchAll()
    } finally {
      setApproving(null)
    }
  }

  async function rejectEOD(caisseId: string) {
    const note = prompt(isAr ? 'سبب الرفض:' : 'Motif du rejet :')
    if (!note) return
    setApproving(caisseId)
    try {
      await (supabase as any)
        .from('caisse')
        .update({
          status:         'open',
          rejection_note: note,
        })
        .eq('caisse_id', caisseId)
      await fetchAll()
    } finally {
      setApproving(null)
    }
  }

  useEffect(() => { fetchAll() }, [])

  const totalCaToday  = snapshots.reduce((s, snap) => s + snap.ca_today,  0)
  const totalCaMonth  = snapshots.reduce((s, snap) => s + snap.ca_month,  0)
  const totalRepairs  = snapshots.reduce((s, snap) => s + snap.active_repairs, 0)

  // Latest punch per person today
  const staffLatest = Object.values(
    staffToday.reduce((acc, p) => {
      if (!acc[p.user_name]) acc[p.user_name] = p
      return acc
    }, {} as Record<string, StaffPunch>)
  )

  return (
    <div className="p-6 space-y-6 animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-[#1A1A1A] tracking-wide">
            {isAr ? 'لوحة BZG' : 'Tableau de bord BZG'}
          </h1>
          <p className="text-[#6B6860] text-sm mt-1">
            {isAr ? `مرحباً، ${user?.display_name}` : `Bonjour, ${user?.display_name}`}
            {lastSync && (
              <span className="ml-3 text-[#B0ADA6] text-xs">
                <Clock className="w-3 h-3 inline mb-0.5" />
                {' '}{lastSync.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <button onClick={fetchAll} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border bg-white hover:bg-[#F5F3FF] transition-all disabled:opacity-50"
          style={{ borderColor: '#C4B5FD', color: '#6B6860' }}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {isAr ? 'تحديث' : 'Actualiser'}
        </button>
      </div>

      {/* Global KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: isAr ? 'إجمالي اليوم' : 'Total du jour', value: formatMAD(totalCaToday), icon: TrendingUp, color: '#6366F1' },
          { label: isAr ? 'إجمالي الشهر' : 'Total du mois', value: formatMAD(totalCaMonth),  icon: TrendingUp, color: '#6366F1' },
          { label: isAr ? 'إصلاحات نشطة' : 'Réparations actives', value: String(totalRepairs), icon: Wrench, color: '#F59E0B' },
        ].map(kpi => {
          const Icon = kpi.icon
          return (
            <div key={kpi.label} className="bg-white border border-[#E8E5DE] rounded-2xl p-5"
                 style={{ borderLeftColor: kpi.color, borderLeftWidth: '3px' }}>
              <div className="flex items-start justify-between mb-2">
                <p className="text-[#6B6860] text-xs">{kpi.label}</p>
                <Icon className="w-4 h-4" style={{ color: kpi.color }} />
              </div>
              {loading ? <div className="h-7 bg-[#F2F0EB] rounded w-1/2 animate-pulse" />
                       : <p className="font-display text-2xl font-bold text-[#1A1A1A]">{kpi.value}</p>}
            </div>
          )
        })}
      </div>

      {/* Per-store comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {STORES.map(store => {
          const snap = snapshots.find(s => s.store_id === store.id)
          const caisseLabel = !snap ? '—'
            : snap.caisse_status === 'none'        ? (isAr ? 'لم تفتح' : 'Non ouverte')
            : snap.caisse_status === 'open'        ? (isAr ? 'مفتوحة' : 'Ouverte')
            : snap.caisse_status === 'pending_eod' ? (isAr ? 'في انتظار الموافقة' : 'En attente')
            : (isAr ? 'مغلقة' : 'Clôturée')
          const caisseColor = !snap ? '#B0ADA6'
            : snap.caisse_status === 'open'        ? '#10B981'
            : snap.caisse_status === 'pending_eod' ? '#F59E0B'
            : snap.caisse_status === 'closed'      ? '#6B6860'
            : '#B0ADA6'

          return (
            <div key={store.id} className="bg-white border-2 border-[#E8E5DE] rounded-2xl overflow-hidden"
                 style={{ borderTopColor: store.color, borderTopWidth: '3px' }}>
              <div className="flex items-center gap-3 px-5 py-4 border-b border-[#E8E5DE]">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                     style={{ backgroundColor: store.bg }}>
                  <span className="text-xs font-bold" style={{ color: store.color }}>
                    {store.id.split('-')[0]}
                  </span>
                </div>
                <h3 className="font-display font-bold text-[#1A1A1A] tracking-wide">{store.name}</h3>
              </div>
              <div className="grid grid-cols-2 gap-px bg-[#F2F0EB]">
                {[
                  { label: isAr ? 'اليوم' : "Aujourd'hui", value: snap ? formatMAD(snap.ca_today) : '—' },
                  { label: isAr ? 'الشهر' : 'Ce mois',     value: snap ? formatMAD(snap.ca_month) : '—' },
                  { label: isAr ? 'الإصلاحات' : 'Réparations', value: snap ? String(snap.active_repairs) : '—' },
                  { label: isAr ? 'صندوق الدفع' : 'Caisse', value: caisseLabel, valueColor: caisseColor },
                ].map(cell => (
                  <div key={cell.label} className="bg-white px-4 py-3">
                    <p className="text-xs text-[#B0ADA6] mb-1">{cell.label}</p>
                    {loading
                      ? <div className="h-5 bg-[#F2F0EB] rounded w-2/3 animate-pulse" />
                      : <p className="font-bold text-sm" style={{ color: cell.valueColor || '#1A1A1A' }}>
                          {cell.value}
                        </p>
                    }
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Pending EOD approvals */}
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-[#E8E5DE]">
            <Vault className="w-4 h-4 text-[#F59E0B]" />
            <h2 className="font-display font-bold text-[#1A1A1A] tracking-wide">
              {isAr ? 'موافقات الإغلاق المعلقة' : 'Clôtures en attente'}
            </h2>
            {pendingEOD.length > 0 && (
              <span className="ml-auto text-xs font-bold text-white bg-amber-500 rounded-full w-5 h-5 flex items-center justify-center">
                {pendingEOD.length}
              </span>
            )}
          </div>
          {loading ? (
            <div className="divide-y divide-[#F2F0EB]"><SkeletonRow /><SkeletonRow /></div>
          ) : pendingEOD.length === 0 ? (
            <EmptyState
              icon={<CheckCircle className="w-6 h-6 text-emerald-400" />}
              title={isAr ? 'لا يوجد شيء معلق' : 'Aucune clôture en attente'}
            />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {pendingEOD.map(eod => {
                const store = STORES.find(s => s.id === eod.store_id)
                return (
                  <div key={eod.caisse_id} className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-medium text-sm text-[#1A1A1A]">{eod.store_name}</p>
                        <p className="text-xs text-[#B0ADA6]">{formatDate(eod.date)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-[#6B6860]">
                          {isAr ? 'الفرق' : 'Écart'}
                        </p>
                        <p className={`font-bold text-sm ${!eod.ecart || eod.ecart === 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {eod.ecart != null ? formatMAD(eod.ecart) : '—'}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                      <div className="bg-[#F8F7F4] rounded-lg px-3 py-2">
                        <p className="text-[#B0ADA6]">{isAr ? 'متوقع' : 'Théorique'}</p>
                        <p className="font-bold text-[#1A1A1A]">{eod.solde_theorique != null ? formatMAD(eod.solde_theorique) : '—'}</p>
                      </div>
                      <div className="bg-[#F8F7F4] rounded-lg px-3 py-2">
                        <p className="text-[#B0ADA6]">{isAr ? 'فعلي' : 'Réel'}</p>
                        <p className="font-bold text-[#1A1A1A]">{eod.solde_reel != null ? formatMAD(eod.solde_reel) : '—'}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => approveEOD(eod.caisse_id)}
                        disabled={approving === eod.caisse_id}
                        className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all disabled:opacity-50"
                      >
                        <CheckCircle className="w-4 h-4" />
                        {isAr ? 'موافقة' : 'Approuver'}
                      </button>
                      <button
                        onClick={() => rejectEOD(eod.caisse_id)}
                        disabled={approving === eod.caisse_id}
                        className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-all disabled:opacity-50"
                      >
                        <XCircle className="w-4 h-4" />
                        {isAr ? 'رفض' : 'Rejeter'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Staff presence today */}
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-[#E8E5DE]">
            <Users className="w-4 h-4 text-[#6366F1]" />
            <h2 className="font-display font-bold text-[#1A1A1A] tracking-wide">
              {isAr ? 'حضور الفريق اليوم' : "Présence équipe aujourd'hui"}
            </h2>
          </div>
          {loading ? (
            <div className="divide-y divide-[#F2F0EB]"><SkeletonRow /><SkeletonRow /></div>
          ) : staffLatest.length === 0 ? (
            <EmptyState
              icon={<Users className="w-6 h-6" />}
              title={isAr ? 'لا يوجد حضور مسجل' : 'Aucune présence enregistrée'}
            />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {staffLatest.map(p => {
                const store = STORES.find(s => s.id === p.store_id)
                const isIn  = p.punch_type === 'in'
                return (
                  <div key={p.user_name} className="flex items-center gap-4 px-5 py-3">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isIn ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A]">{p.user_name}</p>
                      <p className="text-xs text-[#B0ADA6]" style={{ color: store?.color }}>
                        {store?.name ?? p.store_id}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-xs font-bold ${isIn ? 'text-emerald-600' : 'text-slate-500'}`}>
                        {isIn ? (isAr ? 'حاضر' : 'Présent') : (isAr ? 'غادر' : 'Sorti')}
                      </p>
                      <p className="text-xs text-[#B0ADA6]">
                        {new Date(p.punched_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}