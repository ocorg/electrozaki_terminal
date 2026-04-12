'use client'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { TrendingUp, ShoppingCart, Wrench, AlertTriangle, Loader2 } from 'lucide-react'

export default function DashboardPage() {
  const { user, loading } = useUser()
  const { language } = useLanguageStore()
  const isAr = language === 'ar'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-gold animate-spin" />
      </div>
    )
  }

  const kpis = [
    { label: isAr ? 'رقم الأعمال اليوم' : 'CA du jour',          value: '— MAD', icon: TrendingUp,    color: 'text-gold' },
    { label: isAr ? 'مبيعات الشهر'       : 'Ventes ce mois',      value: '—',     icon: ShoppingCart,  color: 'text-blue-400' },
    { label: isAr ? 'إصلاحات نشطة'       : 'Réparations actives', value: '—',     icon: Wrench,        color: 'text-orange-400' },
    { label: isAr ? 'تنبيهات المخزون'    : 'Alertes stock',       value: '—',     icon: AlertTriangle, color: 'text-red-400' },
  ]

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-bold text-gold tracking-wide">
          {isAr ? 'لوحة التحكم' : 'Tableau de bord'}
        </h1>
        <p className="text-ez-subtle text-sm mt-1">
          {isAr ? `مرحباً، ${user?.display_name}` : `Bonjour, ${user?.display_name}`}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon
          return (
            <div key={kpi.label} className="bg-white border border-ez-border rounded-2xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.05)] hover:border-gold/30 hover:shadow-[0_4px_16px_rgba(201,164,64,0.08)] transition-all">
              <div className="flex items-start justify-between mb-3">
                <p className="text-ez-subtle text-xs leading-snug">{kpi.label}</p>
                <Icon className={`w-4 h-4 ${kpi.color} flex-shrink-0`} />
              </div>
              <p className="font-display text-2xl font-bold text-ez-text">{kpi.value}</p>
            </div>
          )
        })}
      </div>

      {/* Coming soon modules */}
      <div className="bg-white border border-ez-border rounded-2xl p-6">
        <p className="text-ez-subtle text-sm text-center">
          {isAr ? 'الوحدات قيد التطوير — Phase 4' : 'Modules en cours de développement — Phase 4'}
        </p>
      </div>
    </div>
  )
}