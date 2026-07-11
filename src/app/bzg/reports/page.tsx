'use client'
import { useState, useEffect } from 'react'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD } from '@/lib/utils'
import { PageHeader } from '@/components/shared'
import { BarChart3, RefreshCw, TrendingUp, ShoppingCart, Wrench, Package, Calendar } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts'

const STORES = [
  { id: 'EZ-001', name: 'Electro Zaki', color: '#C9A440' },
]

interface StoreStats {
  storeId:        string
  storeName:      string
  color:          string
  ca_today:       number
  ca_week:        number
  ca_month:       number
  nb_transactions: number
  nb_repairs:     number
  low_stock:      number
}

interface DailyData {
  date: string
  EZ:   number
}

export default function BZGReportsPage() {
  const { language } = useLanguageStore()
  const isAr = language === 'ar'

  const [stats, setStats]       = useState<StoreStats[]>([])
  const [chartData, setChartData] = useState<DailyData[]>([])
  const [loading, setLoading]   = useState(true)
  const [period, setPeriod]     = useState<'7' | '30'>('7')

  async function fetchReports() {
    setLoading(true)
    try {
      const today      = new Date().toISOString().split('T')[0]
      const weekStart  = new Date(Date.now() - 7  * 86400000).toISOString().split('T')[0]
      const monthStart = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]

      // Fetch all transactions for both stores
      const [txnRes, repairRes, accRes] = await Promise.all([
        fetch(`/api/transactions?limit=500`),
        fetch(`/api/repairs?store_id=EZ-001`),
        fetch(`/api/accessories?store_id=EZ-001&low_stock=true`),
      ])

      const [txnJson, repairJson, accJson] = await Promise.all([
        txnRes.json(), repairRes.json(), accRes.json(),
      ])

      const txns    = (txnJson.data   || []) as Record<string, unknown>[]
      const repairs = (repairJson.data || []) as Record<string, unknown>[]
      const lowAcc  = (accJson.data   || []) as Record<string, unknown>[]

      // Build per-store stats
      const newStats: StoreStats[] = STORES.map(store => {
        const storeTxns = txns.filter(t => t.store_id === store.id)
        return {
          storeId:         store.id,
          storeName:       store.name,
          color:           store.color,
          ca_today:        storeTxns.filter(t => t.date_vente === today)
                                    .reduce((s, t) => s + ((t.prix_vente as number) || 0), 0),
          ca_week:         storeTxns.filter(t => (t.date_vente as string) >= weekStart)
                                    .reduce((s, t) => s + ((t.prix_vente as number) || 0), 0),
          ca_month:        storeTxns.filter(t => (t.date_vente as string) >= monthStart)
                                    .reduce((s, t) => s + ((t.prix_vente as number) || 0), 0),
          nb_transactions: storeTxns.length,
          nb_repairs:      repairs.filter(r => r.store_id === store.id && r.statut !== 'تم الاستلام').length,
          low_stock:       store.id === 'EZ-001' ? lowAcc.length : 0,
        }
      })
      setStats(newStats)

      // Build daily chart data for last N days
      const days = parseInt(period)
      const daily: Record<string, DailyData> = {}
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0]
        daily[d] = { date: d.slice(5), EZ: 0 }
      }
      txns.forEach(t => {
        const d = t.date_vente as string
        if (daily[d] && t.store_id === 'EZ-001') daily[d].EZ += (t.prix_vente as number) || 0
      })
      setChartData(Object.values(daily))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchReports() }, [period])

  const totalCA = stats.reduce((s, st) => s + st.ca_month, 0)

  return (
    <div className="flex flex-col h-full overflow-auto animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="px-6 pt-6 pb-4 flex-shrink-0 space-y-4">
        <PageHeader
          title={isAr ? 'التقارير' : 'Rapports'}
          subtitle={isAr ? 'تحليل أداء Electro Zaki' : 'Analyse des performances — Electro Zaki'}
          actions={
            <div className="flex items-center gap-2">
              <select
                className="text-sm border border-[#E8E5DE] rounded-xl px-3 py-2 bg-white text-[#6B6860] focus:outline-none"
                value={period}
                onChange={e => setPeriod(e.target.value as '7' | '30')}>
                <option value="7">{isAr ? '7 أيام' : '7 jours'}</option>
                <option value="30">{isAr ? '30 يوم' : '30 jours'}</option>
              </select>
              <button onClick={fetchReports} disabled={loading}
                className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F5F3FF] transition-all">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          }
        />

        {/* Global KPI */}
        <div className="bg-[#1A1A2E] rounded-2xl p-5 text-white">
          <p className="text-xs text-white/50 uppercase tracking-widest mb-1">
            {isAr ? `إجمالي BZG — آخر ${period} يوم` : `Total BZG — ${period} derniers jours`}
          </p>
          <p className="font-display text-4xl font-bold text-white">{formatMAD(totalCA)}</p>
          <p className="text-white/40 text-sm mt-1">
            {stats.reduce((s, st) => s + st.nb_transactions, 0)}{' '}
            {isAr ? 'معاملة' : 'transaction(s)'}
          </p>
        </div>
      </div>

      <div className="flex-1 px-6 pb-6 space-y-6">

        {/* Per-store KPI comparison */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {stats.map(st => (
            <div key={st.storeId} className="bg-white border-2 border-[#E8E5DE] rounded-2xl overflow-hidden"
                 style={{ borderTopColor: st.color, borderTopWidth: '3px' }}>
              <div className="px-5 py-4 border-b border-[#E8E5DE]">
                <h3 className="font-display font-bold text-[#1A1A1A] tracking-wide"
                    style={{ color: st.color }}>{st.storeName}</h3>
              </div>
              <div className="grid grid-cols-2 gap-px bg-[#F2F0EB]">
                {[
                  { label: isAr ? 'اليوم'        : "Aujourd'hui", value: formatMAD(st.ca_today),   icon: Calendar },
                  { label: isAr ? 'الشهر'         : '30 jours',   value: formatMAD(st.ca_month),   icon: TrendingUp },
                  { label: isAr ? 'المعاملات'     : 'Transactions', value: String(st.nb_transactions), icon: ShoppingCart },
                  { label: isAr ? 'إصلاحات نشطة' : 'Réparations', value: String(st.nb_repairs),   icon: Wrench },
                ].map(kpi => {
                  const Icon = kpi.icon
                  return (
                    <div key={kpi.label} className="bg-white px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-[#B0ADA6]">{kpi.label}</p>
                        <Icon className="w-3.5 h-3.5 text-[#B0ADA6]" />
                      </div>
                      {loading
                        ? <div className="h-5 bg-[#F2F0EB] rounded animate-pulse w-2/3" />
                        : <p className="font-bold text-sm text-[#1A1A1A]">{kpi.value}</p>
                      }
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Revenue chart */}
        <div className="bg-white border border-[#E8E5DE] rounded-2xl p-5">
          <h3 className="font-display font-bold text-[#1A1A1A] tracking-wide mb-5">
            {isAr ? `مقارنة الإيرادات — آخر ${period} يوم` : `Comparaison CA — ${period} derniers jours`}
          </h3>
          {loading ? (
            <div className="h-48 bg-[#F8F7F4] rounded-xl animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F2F0EB" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#B0ADA6' }} />
                <YAxis tick={{ fontSize: 11, fill: '#B0ADA6' }}
                  tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip
                  formatter={(value) => typeof value === 'number' ? formatMAD(value) : ''}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E8E5DE' }}
                />
                <Legend />
                <Bar dataKey="EZ" name="Electro Zaki" fill="#C9A440" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}