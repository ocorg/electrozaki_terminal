'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD, formatDate } from '@/lib/utils'
import { StatusBadge, SkeletonRow, EmptyState } from '@/components/shared'
import {
  TrendingUp, Wrench, AlertTriangle,
  RefreshCw, Clock, ArrowRight, Package
} from 'lucide-react'
import Link from 'next/link'
import AttendanceWidget from '@/components/attendance/AttendanceWidget'

const STORE_ID = 'HP-001'
const PRIMARY  = '#0EA5E9'

interface DashboardData {
  ca_today:        number
  ca_month:        number
  active_repairs:  number
  ready_repairs:   number
  low_stock_count: number
  recent_repairs:  RecentRepair[]
  repair_counts:   Record<string, number>
}

interface RecentRepair {
  rep_id:      string
  model:       string
  statut:      string
  date_depot:  string
  client_nom?: string
}

export default function HPDashboard() {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const supabase     = createClient()
  const isAr         = language === 'ar'

  const [data, setData]         = useState<DashboardData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [lastSync, setLastSync] = useState<Date | null>(null)

  async function fetchDashboard() {
    setLoading(true)
    try {
      const today      = new Date().toISOString().split('T')[0]
      const monthStart = today.slice(0, 7) + '-01'

      const [txnRes, repairRes, stockRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('prix_vente, date_vente, avance, valeur_echange, type_operation')
          .eq('store_id', STORE_ID)
          .eq('voided', false)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('reparations')
          .select('rep_id, model, statut, date_depot, clients(nom)')
          .eq('store_id', STORE_ID)
          .neq('statut', 'تم الاستلام')
          .order('created_at', { ascending: false }),

        supabase
          .from('accessories')
          .select('quantite, seuil_alerte')
          .eq('store_id', STORE_ID),
      ])

      const txns        = (txnRes.data    || []) as Record<string, unknown>[]
      const repairs     = (repairRes.data || []) as Record<string, unknown>[]
      const accessories = (stockRes.data  || []) as Record<string, unknown>[]

      function collectedAmount(t: Record<string, unknown>): number {
        const pv  = (t.prix_vente     as number) || 0
        const av  = (t.avance         as number) || 0
        const ve  = (t.valeur_echange as number) || 0
        const op  =  t.type_operation as string
        if (op === 'إستبدال') return pv - ve
        const fariq = pv - av - ve
        return fariq > 0 ? av : pv
      }

      const ca_today = txns
        .filter(t => t.date_vente === today)
        .reduce((s: number, t) => s + collectedAmount(t), 0)

      const monthTxns = txns.filter(t => (t.date_vente as string) >= monthStart)
      const ca_month  = monthTxns.reduce((s: number, t) => s + collectedAmount(t), 0)

      const repair_counts: Record<string, number> = {}
      for (const r of repairs) {
        const s = r.statut as string
        repair_counts[s] = (repair_counts[s] ?? 0) + 1
      }

      const low_stock_count = accessories.filter(
        a => (a.quantite as number) <= (a.seuil_alerte as number)
      ).length

      const recent_repairs: RecentRepair[] = repairs.slice(0, 8).map(r => ({
        rep_id:     r.rep_id as string,
        model:      r.model as string,
        statut:     r.statut as string,
        date_depot: r.date_depot as string,
        client_nom: (r.clients as Record<string, string> | null)?.nom,
      }))

      setData({
        ca_today,
        ca_month,
        active_repairs:  repairs.length,
        ready_repairs:   repair_counts['جاهز'] || 0,
        low_stock_count,
        recent_repairs,
        repair_counts,
      })
      setLastSync(new Date())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchDashboard() }, [])

  const kpis = data ? [
    {
      label: isAr ? 'رقم الأعمال اليوم' : "CA du jour",
      value: formatMAD(data.ca_today),
      icon:  TrendingUp,
      color: PRIMARY,
      bg:    '#F0F9FF',
    },
    {
      label: isAr ? 'إصلاحات نشطة' : 'Réparations actives',
      value: String(data.active_repairs),
      icon:  Wrench,
      color: '#F59E0B',
      bg:    '#FFFBEB',
    },
    {
      label: isAr ? 'جاهزة للاستلام' : 'Prêtes à récupérer',
      value: String(data.ready_repairs),
      icon:  Wrench,
      color: '#10B981',
      bg:    '#F0FDF4',
    },
    {
      label: isAr ? 'تنبيهات المخزون' : 'Alertes stock',
      value: String(data.low_stock_count),
      icon:  AlertTriangle,
      color: data.low_stock_count > 0 ? '#EF4444' : '#10B981',
      bg:    data.low_stock_count > 0 ? '#FEF2F2' : '#F0FDF4',
    },
  ] : []

  return (
    <div className="p-6 space-y-6 animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* Attendance widget */}
      <AttendanceWidget storeId={STORE_ID} />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-[#1A1A1A] tracking-wide">
            {isAr ? 'لوحة التحكم' : 'Tableau de bord'}
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
        <button
          onClick={fetchDashboard}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border bg-white hover:bg-[#F0F9FF] transition-all disabled:opacity-50"
          style={{ borderColor: '#BAE6FD', color: '#6B6860' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {isAr ? 'تحديث' : 'Actualiser'}
        </button>
      </div>

      {/* KPIs */}
      {loading && !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white border border-[#E8E5DE] rounded-2xl p-5 animate-pulse">
              <div className="h-3 bg-[#F2F0EB] rounded w-2/3 mb-3" />
              <div className="h-7 bg-[#F2F0EB] rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(kpi => {
            const Icon = kpi.icon
            return (
              <div key={kpi.label} className="bg-white border border-[#E8E5DE] rounded-2xl p-5 hover:shadow-md transition-all"
                   style={{ borderLeftColor: kpi.color, borderLeftWidth: '3px' }}>
                <div className="flex items-start justify-between mb-3">
                  <p className="text-[#6B6860] text-xs leading-snug">{kpi.label}</p>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: kpi.bg }}>
                    <Icon className="w-4 h-4" style={{ color: kpi.color }} />
                  </div>
                </div>
                <p className="font-display text-2xl font-bold text-[#1A1A1A]">{kpi.value}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Recent repairs */}
        <div className="lg:col-span-2 bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E5DE]">
            <h2 className="font-display font-bold text-[#1A1A1A] tracking-wide">
              {isAr ? 'آخر الإصلاحات' : 'Réparations récentes'}
            </h2>
            <Link href="/hp/repairs" className="text-xs hover:underline flex items-center gap-1"
                  style={{ color: PRIMARY }}>
              {isAr ? 'عرض الكل' : 'Voir tout'} <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {loading && !data ? (
            <div className="divide-y divide-[#F2F0EB]">
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : !data?.recent_repairs.length ? (
            <EmptyState icon={<Wrench className="w-6 h-6" />}
              title={isAr ? 'لا توجد إصلاحات' : 'Aucune réparation'} />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {data.recent_repairs.map(r => (
                <div key={r.rep_id} className="flex items-center gap-4 px-5 py-3 hover:bg-[#F0F9FF] transition-all">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                       style={{ backgroundColor: '#F0F9FF' }}>
                    <Wrench className="w-4 h-4" style={{ color: PRIMARY }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A] truncate">{r.model}</p>
                    <p className="text-xs text-[#B0ADA6]">
                      {r.client_nom || '—'} · {formatDate(r.date_depot)}
                    </p>
                  </div>
                  <StatusBadge status={r.statut} lang={isAr ? 'ar' : 'fr'} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Repair breakdown */}
        <div className="space-y-4">
          <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E8E5DE]">
              <h2 className="font-display font-bold text-[#1A1A1A] tracking-wide">
                {isAr ? 'حالة الإصلاحات' : 'Statut réparations'}
              </h2>
            </div>
            <div className="p-4 space-y-2">
              {[
                { status: 'معلق',        label: isAr ? 'معلق'        : 'En attente', color: '#F59E0B' },
                { status: 'قيد الإصلاح', label: isAr ? 'قيد الإصلاح' : 'En cours',  color: PRIMARY },
                { status: 'جاهز',        label: isAr ? 'جاهز'        : 'Prêt',       color: '#10B981' },
              ].map(row => (
                <div key={row.status} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: row.color }} />
                    <span className="text-sm text-[#6B6860]">{row.label}</span>
                  </div>
                  <span className="font-bold text-sm text-[#1A1A1A]">
                    {loading ? '—' : (data?.repair_counts[row.status] || 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {data && data.low_stock_count > 0 && (
            <Link href="/hp/stock/accessories"
              className="flex items-center gap-3 p-4 bg-red-50 border border-red-100 rounded-2xl hover:bg-red-100 transition-all">
              <Package className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-700 font-medium">
                {isAr
                  ? `${data.low_stock_count} إكسسوار نفذ`
                  : `${data.low_stock_count} accessoire${data.low_stock_count > 1 ? 's' : ''} en rupture`}
              </p>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}