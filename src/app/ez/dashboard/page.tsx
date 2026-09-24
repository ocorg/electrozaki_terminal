'use client'
import { useEffect, useMemo, useState } from 'react'
import { useApi } from '@/lib/data/api'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { t } from '@/lib/i18n/t'
import { formatMAD, formatDate } from '@/lib/utils'
import { StatusBadge, SkeletonRow, EmptyState } from '@/components/shared'
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, ShoppingCart, Wrench, AlertTriangle,
  RefreshCw, Clock, ArrowRight, Wallet, Target, BarChart2,
} from 'lucide-react'
import Link from 'next/link'
import AttendanceWidget from '@/components/attendance/AttendanceWidget'
import { STORE_TIME_ZONE } from '@/lib/time'

// ─── Types ────────────────────────────────────────────────────
type Period = 'day' | 'week' | 'month'

interface TxnRow {
  txn_id:         string
  device_id:      string
  device_type:    string
  type_operation: string
  prix_vente:     number
  avance:         number
  valeur_echange: number
  payment_method: string
  date_vente:     string
}

interface RecentTxn extends TxnRow {
  client_nom?: string
}

interface ChartPoint {
  label:   string
  revenue: number
  profit:  number
  net:     number
  count:   number
}

interface DashboardData {
  ca_period:         number
  benefice_brut:     number
  benefice_net:      number
  nb_ventes:         number
  panier_moyen:      number
  active_repairs:    number
  repair_counts:     Record<string, number>
  low_stock_count:   number
  low_stock_items:   { acc_id: string; nom: string; quantite: number; seuil_alerte: number }[]
  pending_credits:   number
  recent_txns:       RecentTxn[]
  chart_data:        ChartPoint[]
  payment_breakdown: { cash: number; transfer: number; credit: number; mixed: number }
}

const STORE_ID = 'EZ-001'

// ─── Fix: correct collected-amount logic ──────────────────────
// Previous code had `fariq > 0 ? av : pv` which returned 0 for all
// fully-paid cash/virement sales (fariq = pv > 0 → av = 0).
function collected(t: TxnRow): number {
  const pv = t.prix_vente     || 0
  const av = t.avance         || 0
  const ve = t.valeur_echange || 0
  if (t.payment_method === 'credit')   return av               // deferred: only avance collected now
  if (t.type_operation === 'echange')  return pv - ve          // exchange: deduct trade-in
  const isPartial = av > 0 && (pv - av - ve) > 0
  return isPartial ? av : pv                                   // partial تسبيق → avance; full → full price
}

// ─── Period helpers ────────────────────────────────────────────
function periodDates(p: Period): { start: string; end: string } {
  const today = new Date().toISOString().split('T')[0]
  if (p === 'day')  return { start: today, end: today }
  if (p === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 6)
    return { start: d.toISOString().split('T')[0], end: today }
  }
  return { start: today.slice(0, 7) + '-01', end: today }
}

// A return lowers the day's sales by what was refunded; an item put back in
// stock also gives back its purchase cost (it will be sold again).
type ReturnRow = { date: string; montant: number; qty: number; destination: string | null; device_id: string; device_type: string }
const returnedCost = (r: ReturnRow, costs: Record<string, number>) =>
  r.destination === 'stock' ? (costs[r.device_id] || 0) * (r.device_type === 'accessoire' ? r.qty : 1) : 0

function buildChart(
  txns: TxnRow[],
  exps: { montant: number; date: string }[],
  costs: Record<string, number>,
  start: string,
  end: string,
  returns: ReturnRow[] = [],
): ChartPoint[] {
  const dates: string[] = []
  const d = new Date(start + 'T12:00:00Z')
  const e = new Date(end   + 'T12:00:00Z')
  while (d <= e) {
    dates.push(d.toISOString().split('T')[0])
    d.setDate(d.getDate() + 1)
  }
  return dates.map(date => {
    const dt      = new Date(date + 'T12:00:00Z')
    const n       = dates.length
    const label   = n === 1
      ? dt.toLocaleDateString('fr-FR', { timeZone: STORE_TIME_ZONE, weekday: 'long' })
      : n <= 7
      ? dt.toLocaleDateString('fr-FR', { timeZone: STORE_TIME_ZONE, weekday: 'short', day: 'numeric' })
      : String(dt.getUTCDate())
    const dayT    = txns.filter(t => t.date_vente === date)
    const dayR    = returns.filter(r => r.date.slice(0, 10) === date)
    const revenue = dayT.reduce((s, t) => s + collected(t), 0) - dayR.reduce((s, r) => s + r.montant, 0)
    const cost    = dayT.reduce((s, t) => s + (costs[t.device_id] || 0), 0) - dayR.reduce((s, r) => s + returnedCost(r, costs), 0)
    const expDay  = exps.filter(ex => ex.date === date).reduce((s, ex) => s + ex.montant, 0)
    const profit  = revenue - cost
    return { label, revenue, profit, net: profit - expDay, count: dayT.length }
  })
}

// ─── Custom recharts tooltip ──────────────────────────────────
function ChartTip({
  active, payload, label,
}: {
  active?:  boolean
  label?:   string
  payload?: { dataKey: string; name: string; value: number; color: string }[]
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-[#E8E5DE] rounded-xl shadow-lg p-3 text-xs min-w-[150px]">
      <p className="font-bold text-[#1A1A1A] mb-2 capitalize">{label}</p>
      {payload.map(e => (
        <div key={e.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
            <span className="text-[#6B6860]">{e.name}</span>
          </div>
          <span className="font-bold text-[#1A1A1A]">
            {e.dataKey === 'count' ? e.value : formatMAD(e.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────
export default function EZDashboard() {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const isAr         = language === 'ar'
  const canFin       = user?.role === 'gerant' || user?.role === 'proprietaire'

  const [period,   setPeriod]   = useState<Period>('month')

  // Chart series toggles
  const [showRev,   setShowRev]   = useState(true)
  const [showProf,  setShowProf]  = useState(false)
  const [showNet,   setShowNet]   = useState(false)
  const [showCount, setShowCount] = useState(true)

  // Cached per period; refreshed in the background when sales, stock, repairs,
  // credits or expenses change. One round trip: the server runs every query in parallel.
  const { start: pStart, end: pEnd } = periodDates(period)
  const dashQ = useApi<Record<string, unknown>, Record<string, unknown>>(
    user ? `/api/dashboard?store_id=${STORE_ID}&start=${pStart}&end=${pEnd}` : null,
    { select: json => json },
  )
  const loading = !dashQ.data && !dashQ.error
  const [manualRefresh, setManualRefresh] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  useEffect(() => { if (dashQ.data) setLastSync(new Date()) }, [dashQ.data])
  async function fetchDashboard() {
    setManualRefresh(true)
    try { await dashQ.refresh() } finally { setManualRefresh(false) }
  }

  const data = useMemo<DashboardData | null>(() => {
    const json = dashQ.data as Record<string, any> | undefined
    if (!json) return null
    const periodTxns = (json.periodTxns  || []) as TxnRow[]
    const recentRaw  = (json.recent      || []) as Record<string, unknown>[]
    const repairs    = (json.repairs     || []) as Record<string, unknown>[]
    const accs       = (json.accessories || []) as Record<string, unknown>[]
    const credits    = (json.credits     || []) as Record<string, unknown>[]
    const exps       = (json.expenses    || []) as { montant: number; date: string }[]
    const costMap: Record<string, number> = canFin ? (json.costMap || {}) : {}
    const returns    = (json.returns     || []) as ReturnRow[]

    // ── KPI calculations ────────────────────────────────────
    // Net of returns refunded in the period
    const ca        = periodTxns.reduce((s, t) => s + collected(t), 0) - returns.reduce((s, r) => s + r.montant, 0)
    const totalCost = periodTxns.reduce((s, t) => s + (costMap[t.device_id] || 0), 0) - returns.reduce((s, r) => s + returnedCost(r, costMap), 0)
    const bBrut     = ca - totalCost
    const totalExp  = exps.reduce((s, e) => s + e.montant, 0)
    const bNet      = bBrut - totalExp
    const nb        = periodTxns.length
    const moy       = nb > 0 ? ca / nb : 0

    // ── Payment breakdown ────────────────────────────────────
    const breakdown = { cash: 0, transfer: 0, credit: 0, mixed: 0 }
    for (const t of periodTxns) {
      const v = collected(t)
      if      (t.payment_method === 'especes')  breakdown.cash     += v
      else if (t.payment_method === 'virement') breakdown.transfer += v
      else if (t.payment_method === 'avance')   breakdown.credit   += v
      else if (t.payment_method === 'mixte')    breakdown.mixed    += v
    }

    // ── Repairs ──────────────────────────────────────────────
    const repair_counts: Record<string, number> = {}
    for (const r of repairs) {
      const s = r.statut as string
      repair_counts[s] = (repair_counts[s] ?? 0) + 1
    }

    // ── Low stock ────────────────────────────────────────────
    const lowItems = accs.filter((a: Record<string, unknown>) =>
      (a.quantite as number) <= (a.seuil_alerte as number)
    ) as { acc_id: string; nom: string; quantite: number; seuil_alerte: number }[]

    // ── Pending credits ──────────────────────────────────────
    const pending_credits = credits.filter((c: Record<string, unknown>) => {
      const pv = (c.prix_vente as number) || 0
      const av = (c.avance    as number) || 0
      const ve = (c.valeur_echange as number) || 0
      return c.payment_method === 'credit' || (pv - av - ve) > 0
    }).length

    // ── Recent transactions ──────────────────────────────────
    const recent_txns: RecentTxn[] = recentRaw.map(t => ({
      txn_id:         t.txn_id         as string,
      device_id:      t.device_id      as string,
      device_type:    t.device_type    as string || 'telephone',
      type_operation: t.type_operation as string,
      prix_vente:     t.prix_vente     as number,
      avance:         (t.avance        as number) || 0,
      valeur_echange: (t.valeur_echange as number) || 0,
      payment_method: t.payment_method as string,
      date_vente:     t.date_vente     as string,
      client_nom:     (t.clients as Record<string, string> | null)?.nom,
    }))

    // ── Chart ────────────────────────────────────────────────
    const { start: s, end: e } = periodDates(period)
    const chart_data = buildChart(periodTxns, exps, costMap, s, e, returns)

    return {
      ca_period: ca, benefice_brut: bBrut, benefice_net: bNet,
      nb_ventes: nb, panier_moyen: moy,
      active_repairs: repairs.length, repair_counts,
      low_stock_count: lowItems.length, low_stock_items: lowItems,
      pending_credits, recent_txns, chart_data,
      payment_breakdown: breakdown,
    }
  }, [dashQ.data, period, canFin])

  const periodLabel = {
    day:   isAr ? 'اليوم'        : "Aujourd'hui",
    week:  isAr ? 'هذا الأسبوع' : 'Cette semaine',
    month: isAr ? 'هذا الشهر'   : 'Ce mois',
  }[period]

  // ── KPI definitions ────────────────────────────────────────
  type KpiDef = {
    label: string; value: string; sub?: string
    icon: React.ElementType; color: string; bg: string
  }

  const kpisFin: KpiDef[] = data && canFin ? [
    {
      label: isAr ? `رقم الأعمال — ${periodLabel}` : `CA — ${periodLabel}`,
      value: formatMAD(data.ca_period),
      icon: TrendingUp, color: '#C9A440', bg: '#FAF5E8',
    },
    {
      label: isAr ? 'الربح الإجمالي' : 'Bénéfice brut',
      value: formatMAD(data.benefice_brut),
      sub:   data.ca_period > 0
        ? `Marge: ${Math.round(data.benefice_brut / data.ca_period * 100)}%`
        : undefined,
      icon:  TrendingUp,
      color: data.benefice_brut >= 0 ? '#10B981' : '#EF4444',
      bg:    data.benefice_brut >= 0 ? '#F0FDF4' : '#FEF2F2',
    },
    {
      label: isAr ? 'الربح الصافي' : 'Bénéfice net',
      value: formatMAD(data.benefice_net),
      icon:  Wallet,
      color: data.benefice_net >= 0 ? '#3B82F6' : '#EF4444',
      bg:    data.benefice_net >= 0 ? '#EFF6FF' : '#FEF2F2',
    },
    {
      label: isAr ? 'متوسط السلة' : 'Panier moyen',
      value: formatMAD(data.panier_moyen),
      icon:  Target, color: '#8B5CF6', bg: '#F5F3FF',
    },
  ] : []

  const kpisOps: KpiDef[] = data ? [
    {
      label: isAr ? `عدد المبيعات — ${periodLabel}` : `Ventes — ${periodLabel}`,
      value: String(data.nb_ventes),
      icon:  ShoppingCart, color: '#6366F1', bg: '#EEF2FF',
    },
    {
      label: t(isAr, 'common.activeRepairs'),
      value: String(data.active_repairs),
      icon:  Wrench, color: '#F59E0B', bg: '#FFFBEB',
    },
    {
      label: t(isAr, 'common.stockAlerts'),
      value: String(data.low_stock_count),
      icon:  AlertTriangle,
      color: data.low_stock_count > 0 ? '#EF4444' : '#10B981',
      bg:    data.low_stock_count > 0 ? '#FEF2F2' : '#F0FDF4',
    },
  ] : []

  const allKpis = [...kpisFin, ...kpisOps]
  const brkTotal = data
    ? Object.values(data.payment_breakdown).reduce((s, v) => s + v, 0)
    : 0

  // ── Chart series config ────────────────────────────────────
  const chartSeries = [
    { key: 'rev',   label: isAr ? 'الإيرادات'       : 'Revenus',    color: '#C9A440', show: showRev,   set: setShowRev   },
    { key: 'prof',  label: isAr ? 'الربح الإجمالي'  : 'Bén. brut',  color: '#10B981', show: showProf,  set: setShowProf  },
    { key: 'net',   label: isAr ? 'الربح الصافي'    : 'Bén. net',   color: '#3B82F6', show: showNet,   set: setShowNet   },
    { key: 'count', label: isAr ? 'عدد المبيعات'    : 'Nb. ventes', color: '#8B5CF6', show: showCount, set: setShowCount },
  ]

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      <AttendanceWidget storeId={STORE_ID} />

      {/* ── Header + period selector ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <h1 className="font-display text-3xl font-bold text-[#1A1A1A] tracking-wide">
            {isAr ? 'لوحة التحكم' : 'Tableau de bord'}
          </h1>
          <p className="text-[#6B6860] text-sm mt-1 flex items-center gap-2 flex-wrap">
            {isAr ? `مرحباً، ${user?.display_name}` : `Bonjour, ${user?.display_name}`}
            {lastSync && (
              <span className="text-[#B0ADA6] text-xs flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {lastSync.toLocaleTimeString('fr-FR', { timeZone: STORE_TIME_ZONE, hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period tabs */}
          <div className="flex bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl p-1 gap-1">
            {(['day', 'week', 'month'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                style={{
                  backgroundColor: period === p ? 'white' : 'transparent',
                  color:           period === p ? '#1A1A1A' : '#6B6860',
                  boxShadow:       period === p ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                {p === 'day'   ? (isAr ? 'اليوم'   : 'Jour')
                : p === 'week' ? (isAr ? 'أسبوع'   : 'Semaine')
                :                (isAr ? 'الشهر'    : 'Mois')}
              </button>
            ))}
          </div>
          <button
            onClick={fetchDashboard}
            disabled={manualRefresh}
            className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F8F7F4] transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${manualRefresh ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── KPI grid ── */}
      {loading && !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(canFin ? 7 : 3)].map((_, i) => (
            <div key={i} className="bg-white border border-[#E8E5DE] rounded-2xl p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {allKpis.map(kpi => {
            const Icon = kpi.icon
            return (
              <div
                key={kpi.label}
                className="bg-white border border-[#E8E5DE] rounded-2xl p-5 hover:shadow-md transition-all"
                style={{ borderLeftColor: kpi.color, borderLeftWidth: '3px' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <p className="text-[#6B6860] text-xs leading-snug">{kpi.label}</p>
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: kpi.bg }}
                  >
                    <Icon className="w-4 h-4" style={{ color: kpi.color }} />
                  </div>
                </div>
                <p className="font-display text-2xl font-bold text-[#1A1A1A]">{kpi.value}</p>
                {kpi.sub && <p className="text-xs text-[#6B6860] mt-0.5">{kpi.sub}</p>}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Chart (owner / manager only) ── */}
      {canFin && (
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          {/* Chart header + toggles */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4 border-b border-[#E8E5DE]">
            <h2 className="font-display font-bold text-[#1A1A1A] tracking-wide flex items-center gap-2 flex-shrink-0">
              <BarChart2 className="w-4 h-4 text-[#C9A440]" />
              {isAr ? 'تطور الأداء' : 'Évolution des performances'}
              <span className="text-xs font-normal text-[#B0ADA6]">— {periodLabel}</span>
            </h2>
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              {chartSeries.map(s => (
                <button
                  key={s.key}
                  onClick={() => s.set((v: boolean) => !v)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold border transition-all"
                  style={{
                    backgroundColor: s.show ? `${s.color}15` : 'white',
                    borderColor:     s.show ? s.color : '#E8E5DE',
                    color:           s.show ? s.color : '#B0ADA6',
                  }}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.show ? s.color : '#E8E5DE' }} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Chart body */}
          <div className="p-4">
            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <RefreshCw className="w-5 h-5 animate-spin text-[#B0ADA6]" />
              </div>
            ) : data && data.chart_data.some(p => p.revenue > 0 || p.count > 0) ? (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={data.chart_data} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F2F0EB" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#6B6860' }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: '#6B6860' }}
                    axisLine={false} tickLine={false}
                    tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                    width={45}
                  />
                  {showCount && (
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11, fill: '#8B5CF6' }}
                      axisLine={false} tickLine={false}
                      width={28}
                    />
                  )}
                  <Tooltip content={<ChartTip />} />

                  {showRev && (
                    <Bar
                      yAxisId="left"
                      dataKey="revenue"
                      name={isAr ? 'الإيرادات' : 'Revenus'}
                      fill="#C9A440"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                    />
                  )}
                  {showProf && (
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="profit"
                      name={isAr ? 'الربح الإجمالي' : 'Bén. brut'}
                      stroke="#10B981"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#10B981' }}
                      activeDot={{ r: 5 }}
                    />
                  )}
                  {showNet && (
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="net"
                      name={isAr ? 'الربح الصافي' : 'Bén. net'}
                      stroke="#3B82F6"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#3B82F6' }}
                      activeDot={{ r: 5 }}
                    />
                  )}
                  {showCount && (
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="count"
                      name={isAr ? 'عدد المبيعات' : 'Nb. ventes'}
                      stroke="#8B5CF6"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                      dot={{ r: 3, fill: '#8B5CF6' }}
                      activeDot={{ r: 5 }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center gap-2 text-[#B0ADA6]">
                <BarChart2 className="w-8 h-8 opacity-30" />
                <p className="text-sm">{isAr ? 'لا توجد بيانات لهذه الفترة' : 'Aucune donnée pour cette période'}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Low stock alert ── */}
      {data && data.low_stock_count > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <p className="text-sm font-bold text-amber-800">
              {isAr
                ? `${data.low_stock_count} أصناف قاربت على النفاد`
                : `${data.low_stock_count} article(s) en alerte de stock`}
            </p>
          </div>
          <div className="space-y-1">
            {data.low_stock_items.slice(0, 6).map(item => (
              <div key={item.acc_id} className="flex justify-between text-xs text-amber-700">
                <span>{item.nom}</span>
                <span className="font-bold">{item.quantite} / {item.seuil_alerte}</span>
              </div>
            ))}
            {data.low_stock_items.length > 6 && (
              <p className="text-xs text-amber-600 mt-1">
                +{data.low_stock_items.length - 6} {isAr ? 'أخرى' : 'autres'}
              </p>
            )}
          </div>
          <Link href="/ez/stock/accessories"
            className="mt-3 inline-flex items-center gap-1 text-xs text-amber-700 font-bold hover:underline">
            {isAr ? 'إدارة المخزون' : 'Gérer le stock'} <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      )}

      {/* ── Bottom grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Recent transactions */}
        <div className="lg:col-span-2 bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E5DE]">
            <h2 className="font-display font-bold text-[#1A1A1A] tracking-wide">
              {isAr ? 'آخر المعاملات' : 'Transactions récentes'}
            </h2>
            <Link href="/ez/transactions"
              className="text-xs text-[#C9A440] hover:underline flex items-center gap-1">
              {t(isAr, 'common.viewAll')} <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {loading && !data ? (
            <div className="divide-y divide-[#F2F0EB]">
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : !data?.recent_txns.length ? (
            <EmptyState
              icon={<ShoppingCart className="w-6 h-6" />}
              title={t(isAr, 'common.noTransactions')}
            />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {data.recent_txns.map(txn => (
                <div
                  key={txn.txn_id}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-[#F8F7F4] transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A] truncate">
                      {txn.client_nom || (isAr ? 'عميل عابر' : 'Client comptoir')}
                    </p>
                    <p className="text-xs text-[#B0ADA6]">
                      {txn.device_id} · {formatDate(txn.date_vente)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {canFin && (
                      <p className="text-sm font-bold text-[#C9A440]">
                        {formatMAD(collected(txn))}
                      </p>
                    )}
                    <StatusBadge domain="operation_type" code={txn.type_operation} lang={isAr ? 'ar' : 'fr'} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">

          {/* Repair breakdown */}
          <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E8E5DE] flex items-center justify-between">
              <h2 className="font-display font-bold text-[#1A1A1A] tracking-wide">
                {t(isAr, 'common.repairs')}
              </h2>
              <Link href="/ez/repairs" className="text-xs text-[#C9A440] hover:underline">
                {t(isAr, 'common.viewAll')}
              </Link>
            </div>
            <div className="p-4 space-y-2">
              {[
                { status: 'en_attente',        label: isAr ? 'معلق'        : 'En attente', color: '#F59E0B' },
                { status: 'en_cours', label: isAr ? 'قيد الإصلاح' : 'En cours',   color: '#3B82F6' },
                { status: 'pret',        label: isAr ? 'جاهز'        : 'Prêt',       color: '#10B981' },
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

          {/* Alerts */}
          {data && data.pending_credits > 0 && (
            <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#E8E5DE]">
                <h2 className="font-display font-bold text-[#1A1A1A] tracking-wide">
                  {isAr ? 'تنبيهات' : 'Alertes'}
                </h2>
              </div>
              <div className="p-4">
                <Link
                  href="/ez/credits"
                  className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-100 rounded-xl hover:bg-amber-100 transition-all"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <p className="text-sm text-amber-700">
                    {isAr
                      ? `${data.pending_credits} ذمة مفتوحة`
                      : `${data.pending_credits} créance${data.pending_credits > 1 ? 's' : ''} ouverte${data.pending_credits > 1 ? 's' : ''}`}
                  </p>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Payment breakdown (owner / manager only) ── */}
      {canFin && data && brkTotal > 0 && (
        <div className="bg-white border border-[#E8E5DE] rounded-2xl p-5">
          <h2 className="font-display font-bold text-[#1A1A1A] tracking-wide mb-4">
            {isAr ? 'تفصيل طرق الدفع' : 'Répartition des paiements'}
            <span className="text-xs font-normal text-[#B0ADA6] ml-2">— {periodLabel}</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            {[
              { key: 'cash',     label: isAr ? 'نقد'   : 'Espèces',  color: '#10B981', value: data.payment_breakdown.cash     },
              { key: 'transfer', label: t(isAr, 'common.transfer'), color: '#3B82F6', value: data.payment_breakdown.transfer },
              { key: 'credit',   label: t(isAr, 'common.advances'),  color: '#F59E0B', value: data.payment_breakdown.credit  },
              { key: 'mixed',    label: isAr ? 'مختلط' : 'Mixte',    color: '#8B5CF6', value: data.payment_breakdown.mixed   },
            ].filter(r => r.value > 0).map(row => {
              const pct = Math.round(row.value / brkTotal * 100)
              return (
                <div key={row.key}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-medium text-[#6B6860]">{row.label}</span>
                    <span className="font-bold text-[#1A1A1A]">
                      {formatMAD(row.value)}
                      <span className="text-[#B0ADA6] font-normal ml-1">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 bg-[#F2F0EB] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: row.color }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}