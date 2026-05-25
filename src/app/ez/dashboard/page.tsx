'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { useTranslation } from '@/lib/i18n/translations'
import { formatMAD, formatDate } from '@/lib/utils'
import { StatusBadge, SkeletonRow, EmptyState } from '@/components/shared'
import {
  TrendingUp, ShoppingCart, Wrench, AlertTriangle,
  Loader2, RefreshCw, Clock, ArrowRight
} from 'lucide-react'
import Link from 'next/link'
import AttendanceWidget from '@/components/attendance/AttendanceWidget'

interface DashboardData {
  ca_today:         number
  ca_month:         number
  nb_ventes_month:  number
  active_repairs:   number
  low_stock_count:  number
  low_stock_items:  { acc_id: string; nom: string; quantite: number; seuil_alerte: number }[]
  pending_credits:  number
  recent_txns:      RecentTxn[]
  repair_counts:    Record<string, number>
}

interface RecentTxn {
  txn_id:         string
  device_id:      string
  type_operation: string
  prix_vente:     number
  date_vente:     string
  client_nom?:    string
}

const STORE_ID = 'EZ-001'

export default function EZDashboard() {
  const { user }        = useUser()
  const { language }    = useLanguageStore()
  const t               = useTranslation(language)
  const supabase        = createClient()
  const isAr            = language === 'ar'

  const [data, setData]       = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastSync, setLastSync] = useState<Date | null>(null)

  async function fetchDashboard() {
    setLoading(true)
    try {
      const today     = new Date().toISOString().split('T')[0]
      const monthStart = today.slice(0, 7) + '-01'

      const [txnRes, repairRes, stockRes, creditRes] = await Promise.all([
        // All non-voided transactions for this store
        supabase
          .from('transactions')
          .select('txn_id, device_id, type_operation, prix_vente, date_vente, avance, valeur_echange, clients(nom)')
          .eq('store_id', STORE_ID)
          .eq('voided', false)
          .order('created_at', { ascending: false })
          .limit(200),

        // Active repairs
        supabase
          .from('reparations')
          .select('rep_id, statut')
          .eq('store_id', STORE_ID)
          .neq('statut', 'تم الاستلام'),

        // Low stock accessories
        supabase
          .from('accessories')
          .select('acc_id, nom, quantite, seuil_alerte')
          .eq('store_id', STORE_ID)
          .eq('is_deleted', false),

        // Open credit transactions (fariq > 0, non-voided only)
        supabase
          .from('transactions')
          .select('txn_id, prix_vente, avance, valeur_echange')
          .eq('store_id', STORE_ID)
          .eq('voided', false)
          .gt('avance', 0),
      ])

      const txns        = (txnRes.data || []) as Record<string, unknown>[]
      const repairs     = (repairRes.data || []) as Record<string, unknown>[]
      const accessories = (stockRes.data || []) as Record<string, unknown>[]
      const credits     = (creditRes.data || []) as Record<string, unknown>[]

      // Compute actually-collected amount per transaction
      const collectedAmount = (t: Record<string, unknown>): number => {
        const pv  = (t.prix_vente     as number) || 0
        const av  = (t.avance         as number) || 0
        const ve  = (t.valeur_echange as number) || 0
        const op  =  t.type_operation as string
        if (op === 'إستبدال') return pv - ve
        const fariq = pv - av - ve
        return fariq > 0 ? av : pv
      }

      // CA today
      const ca_today = txns
        .filter(t => t.date_vente === today)
        .reduce((sum: number, t) => sum + collectedAmount(t), 0)

      // CA + count this month
      const monthTxns = txns.filter(t => (t.date_vente as string) >= monthStart)
      const ca_month  = monthTxns.reduce((sum: number, t) => sum + collectedAmount(t), 0)
      const nb_ventes_month = monthTxns.length

      // Active repairs count
      const active_repairs = repairs.length

      // Repair counts by status
      const repair_counts: Record<string, number> = {}
      for (const r of repairs) {
        const s = r.statut as string
        repair_counts[s] = (repair_counts[s] ?? 0) + 1
      }

      // Low stock
      const lowStockItems  = (stockRes.data || []).filter((a: any) => a.quantite <= a.seuil_alerte)
      const low_stock_count = lowStockItems.length

      // Open credits
      const pending_credits = credits.filter(c => {
        const fariq = (c.prix_vente as number) - ((c.avance as number) || 0) - ((c.valeur_echange as number) || 0)
        return fariq > 0
      })
          - ((c.avance as number) || 0)
          - ((c.valeur_echange as number) || 0)
        return fariq > 0
      }).length

      // Recent 8 transactions
      const recent_txns: RecentTxn[] = txns.slice(0, 8).map(t => ({
        txn_id:         t.txn_id as string,
        device_id:      t.device_id as string,
        type_operation: t.type_operation as string,
        prix_vente:     t.prix_vente as number,
        date_vente:     t.date_vente as string,
        client_nom:     (t.clients as Record<string, string> | null)?.nom,
      }))

      setData({
        ca_today, ca_month, nb_ventes_month, active_repairs,
        low_stock_count, low_stock_items: lowStockItems as any,
        pending_credits, recent_txns, repair_counts,
      })
      setLastSync(new Date())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchDashboard() }, [])

  const kpis = data ? [
    {
      label:  isAr ? 'رقم الأعمال اليوم' : "CA du jour",
      value:  formatMAD(data.ca_today),
      icon:   TrendingUp,
      color:  '#C9A440',
      bg:     '#FAF5E8',
    },
    {
      label:  isAr ? 'مبيعات الشهر' : 'Ventes ce mois',
      value:  `${data.nb_ventes_month} vente${data.nb_ventes_month !== 1 ? 's' : ''}`,
      sub:    formatMAD(data.ca_month),
      icon:   ShoppingCart,
      color:  '#10B981',
      bg:     '#F0FDF4',
    },
    {
      label:  isAr ? 'إصلاحات نشطة' : 'Réparations actives',
      value:  String(data.active_repairs),
      icon:   Wrench,
      color:  '#F59E0B',
      bg:     '#FFFBEB',
    },
    {
      label:  isAr ? 'تنبيهات المخزون' : 'Alertes stock',
      value:  String(data.low_stock_count),
      icon:   AlertTriangle,
      color:  data.low_stock_count > 0 ? '#EF4444' : '#10B981',
      bg:     data.low_stock_count > 0 ? '#FEF2F2' : '#F0FDF4',
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
              <span className="ml-3 text-[#B0ADA6] text-xs flex-inline items-center gap-1">
                <Clock className="w-3 h-3 inline mb-0.5" />
                {' '}{isAr ? 'آخر تحديث' : 'Sync'} {lastSync.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={fetchDashboard}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-[#6B6860] border border-[#E8E5DE] bg-white hover:bg-[#F8F7F4] transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {isAr ? 'تحديث' : 'Actualiser'}
        </button>
      </div>

      {/* KPI Cards */}
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
              <div
                key={kpi.label}
                className="bg-white border border-[#E8E5DE] rounded-2xl p-5 hover:shadow-md transition-all"
                style={{ borderLeftColor: kpi.color, borderLeftWidth: '3px' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <p className="text-[#6B6860] text-xs leading-snug">{kpi.label}</p>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                       style={{ backgroundColor: kpi.bg }}>
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

      {/* Low stock alert — full width, ABOVE the grid */}
      {data && data.low_stock_count > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <p className="text-sm font-bold text-amber-800">
              {isAr ? `${data.low_stock_count} أصناف قاربت على النفاد` : `${data.low_stock_count} article(s) en rupture de stock`}
            </p>
          </div>
          <div className="space-y-1">
            {data.low_stock_items.map(item => (
              <div key={item.acc_id} className="flex justify-between text-xs text-amber-700">
                <span>{item.nom}</span>
                <span className="font-bold">{item.quantite} / {item.seuil_alerte}</span>
              </div>
            ))}
          </div>
          <Link href="/ez/stock/accessories" className="mt-3 inline-flex items-center gap-1 text-xs text-amber-700 font-bold hover:underline">
            {isAr ? 'إدارة المخزون' : 'Gérer le stock'} →
          </Link>
        </div>
      )}

      {/* Bottom grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Recent transactions */}
        <div className="lg:col-span-2 bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E5DE]">
            <h2 className="font-display font-bold text-[#1A1A1A] tracking-wide">
              {isAr ? 'آخر المعاملات' : 'Transactions récentes'}
            </h2>
            <Link href="/ez/transactions"
              className="text-xs text-[#C9A440] hover:underline flex items-center gap-1">
              {isAr ? 'عرض الكل' : 'Voir tout'} <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {loading && !data ? (
            <div className="divide-y divide-[#F2F0EB]">
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : !data?.recent_txns.length ? (
            <EmptyState icon={<ShoppingCart className="w-6 h-6" />}
              title={isAr ? 'لا توجد معاملات' : 'Aucune transaction'} />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {data.recent_txns.map(txn => (
                <div key={txn.txn_id} className="flex items-center gap-4 px-5 py-3 hover:bg-[#F8F7F4] transition-all">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A] truncate">
                      {txn.client_nom || (isAr ? 'عميل غير معروف' : 'Client anonyme')}
                    </p>
                    <p className="text-xs text-[#B0ADA6]">
                      {txn.device_id} · {formatDate(txn.date_vente)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-[#C9A440]">{formatMAD(txn.prix_vente)}</p>
                    <StatusBadge status={txn.type_operation} lang={isAr ? 'ar' : 'fr'} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Repairs summary + alerts */}
        <div className="space-y-4">

          {/* Repair status breakdown */}
          <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E8E5DE] flex items-center justify-between">
              <h2 className="font-display font-bold text-[#1A1A1A] tracking-wide">
                {isAr ? 'الإصلاحات' : 'Réparations'}
              </h2>
              <Link href="/ez/repairs" className="text-xs text-[#C9A440] hover:underline">
                {isAr ? 'عرض الكل' : 'Voir tout'}
              </Link>
            </div>
            <div className="p-4 space-y-2">
              {[
                { status: 'معلق',        label: isAr ? 'معلق' : 'En attente',  color: '#F59E0B' },
                { status: 'قيد الإصلاح', label: isAr ? 'قيد الإصلاح' : 'En cours',   color: '#3B82F6' },
                { status: 'جاهز',        label: isAr ? 'جاهز' : 'Prêt',        color: '#10B981' },
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
          {data && (data.low_stock_count > 0 || data.pending_credits > 0) && (
            <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#E8E5DE]">
                <h2 className="font-display font-bold text-[#1A1A1A] tracking-wide">
                  {isAr ? 'تنبيهات' : 'Alertes'}
                </h2>
              </div>
              <div className="p-4 space-y-2">
                {data.low_stock_count > 0 && (
                  <Link href="/ez/stock/accessories"
                    className="flex items-center gap-3 p-3 bg-red-50 border border-red-100 rounded-xl hover:bg-red-100 transition-all">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-sm text-red-700">
                      {isAr
                        ? `${data.low_stock_count} إكسسوار نفذ`
                        : `${data.low_stock_count} accessoire${data.low_stock_count > 1 ? 's' : ''} en rupture`}
                    </p>
                  </Link>
                )}
                {data.pending_credits > 0 && (
                  <Link href="/ez/transactions"
                    className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-100 rounded-xl hover:bg-amber-100 transition-all">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    <p className="text-sm text-amber-700">
                      {isAr
                        ? `${data.pending_credits} تسبيق مفتوح`
                        : `${data.pending_credits} avance${data.pending_credits > 1 ? 's' : ''} ouverte${data.pending_credits > 1 ? 's' : ''}`}
                    </p>
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}