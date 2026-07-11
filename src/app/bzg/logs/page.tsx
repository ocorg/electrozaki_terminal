'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { PageHeader, EmptyState, SkeletonRow } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import {
  ScrollText, RefreshCw, Search, X,
  ChevronDown, ChevronUp, Calendar
} from 'lucide-react'

interface LogEntry {
  log_id:        string
  store_id?:     string | null
  user_name:     string
  action_type:   string
  module:        string
  record_id?:    string | null
  before_state?: Record<string, unknown> | null
  after_state?:  Record<string, unknown> | null
  notes?:        string | null
  ip_address?:   string | null
  created_at:    string
}

const ACTION_COLORS: Record<string, string> = {
  INSERT:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  UPDATE:      'bg-blue-50 text-blue-700 border-blue-200',
  DELETE:      'bg-red-50 text-red-700 border-red-200',
  VOID:        'bg-red-50 text-red-700 border-red-200',
  EOD_SUBMIT:  'bg-amber-50 text-amber-700 border-amber-200',
  EOD_APPROVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EOD_REJECT:  'bg-red-50 text-red-700 border-red-200',
  OVERRIDE:    'bg-violet-50 text-violet-700 border-violet-200',
  LOGIN:       'bg-slate-50 text-slate-600 border-slate-200',
  LOGOUT:      'bg-slate-50 text-slate-600 border-slate-200',
  PUNCH_IN:    'bg-teal-50 text-teal-700 border-teal-200',
  PUNCH_OUT:   'bg-teal-50 text-teal-700 border-teal-200',
  USER_CREATE: 'bg-violet-50 text-violet-700 border-violet-200',
}

const STORE_NAMES: Record<string, string> = {
  'EZ-001': 'Electro Zaki',
}

const MODULES = [
  'phones', 'laptops', 'accessories', 'transactions',
  'reparations', 'clients', 'suppliers', 'supplier_payments',
  'expenses', 'caisse', 'stock_movements', 'users',
  'settings', 'auth', 'attendance', 'changelog', 'repairs/parts',
]

const ACTIONS = [
  'INSERT', 'UPDATE', 'DELETE', 'VOID',
  'EOD_SUBMIT', 'EOD_APPROVE', 'EOD_REJECT',
  'OVERRIDE', 'LOGIN', 'LOGOUT', 'PUNCH_IN', 'PUNCH_OUT', 'USER_CREATE',
]

const STORES = [
  { id: 'EZ-001', name: 'Electro Zaki' },
]

export default function BZGLogsPage() {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const isAr         = language === 'ar'

  const [logs, setLogs]                   = useState<LogEntry[]>([])
  const [loading, setLoading]             = useState(true)
  const [expanded, setExpanded]           = useState<string | null>(null)
  const [search, setSearch]               = useState('')
  const [filterStore, setFilterStore]     = useState('')
  const [filterModule, setFilterModule]   = useState('')
  const [filterAction, setFilterAction]   = useState('')
  const [dateFrom, setDateFrom]           = useState('')
  const [dateTo, setDateTo]               = useState('')

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '300' })
      if (filterStore)  params.set('store_id',    filterStore)
      if (filterModule) params.set('module',       filterModule)
      if (filterAction) params.set('action_type',  filterAction)
      if (dateFrom)     params.set('date_from',    dateFrom)
      if (dateTo)       params.set('date_to',      dateTo)

      const res  = await fetch(`/api/log?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)

      let result: LogEntry[] = json.data || []

      if (search.trim()) {
        const q = search.toLowerCase()
        result = result.filter(l =>
          l.user_name.toLowerCase().includes(q)          ||
          (l.record_id  ?? '').toLowerCase().includes(q) ||
          (l.notes      ?? '').toLowerCase().includes(q) ||
          l.module.toLowerCase().includes(q)
        )
      }

      setLogs(result)
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [filterStore, filterModule, filterAction, dateFrom, dateTo, search])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  function clearFilters() {
    setSearch('')
    setFilterStore('')
    setFilterModule('')
    setFilterAction('')
    setDateFrom('')
    setDateTo('')
  }

  const hasFilters = !!(search || filterStore || filterModule || filterAction || dateFrom || dateTo)

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* ── Header ── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? "سجل النشاطات" : "Journal d'activité"}
          subtitle={`${logs.length} entrée${logs.length !== 1 ? 's' : ''}`}
          actions={
            <div className="flex items-center gap-2">
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] text-xs hover:bg-[#F5F3FF] transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                  {isAr ? 'مسح الفلاتر' : 'Réinitialiser'}
                </button>
              )}
              <button
                onClick={fetchLogs}
                disabled={loading}
                className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F5F3FF] transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          }
        />

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-2">

          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6] pointer-events-none" />
            <input
              className="w-full pl-9 pr-8 py-2 bg-white border border-[#E8E5DE] rounded-xl text-sm placeholder:text-[#B0ADA6] focus:outline-none focus:border-[#6366F1] transition-all"
              placeholder={isAr ? 'بحث في السجل...' : 'Rechercher utilisateur, ID, note...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#B0ADA6] hover:text-[#1A1A1A]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Store */}
          <select
            value={filterStore}
            onChange={e => setFilterStore(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E8E5DE] rounded-xl text-sm text-[#6B6860] focus:outline-none focus:border-[#6366F1] transition-all"
          >
            <option value="">{isAr ? 'كل المتاجر' : 'Tous les magasins'}</option>
            {STORES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {/* Module */}
          <select
            value={filterModule}
            onChange={e => setFilterModule(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E8E5DE] rounded-xl text-sm text-[#6B6860] focus:outline-none focus:border-[#6366F1] transition-all"
          >
            <option value="">{isAr ? 'كل الوحدات' : 'Tous les modules'}</option>
            {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>

          {/* Action */}
          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E8E5DE] rounded-xl text-sm text-[#6B6860] focus:outline-none focus:border-[#6366F1] transition-all"
          >
            <option value="">{isAr ? 'كل الأنواع' : 'Toutes les actions'}</option>
            {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>

          {/* Date from */}
          <div className="flex items-center gap-1.5 bg-white border border-[#E8E5DE] rounded-xl px-3 py-2">
            <Calendar className="w-3.5 h-3.5 text-[#B0ADA6] flex-shrink-0" />
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="text-sm text-[#6B6860] focus:outline-none bg-transparent w-32"
            />
          </div>

          {/* Date to */}
          <div className="flex items-center gap-1.5 bg-white border border-[#E8E5DE] rounded-xl px-3 py-2">
            <Calendar className="w-3.5 h-3.5 text-[#B0ADA6] flex-shrink-0" />
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="text-sm text-[#6B6860] focus:outline-none bg-transparent w-32"
            />
          </div>
        </div>
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-2">
        {loading ? (
          <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
            {[...Array(8)].map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : logs.length === 0 ? (
          <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
            <EmptyState
              icon={<ScrollText className="w-7 h-7" />}
              title={isAr ? 'لا توجد سجلات' : 'Aucune entrée dans le journal'}
              description={hasFilters
                ? (isAr ? 'جرب تعديل الفلاتر' : 'Essayez de modifier les filtres')
                : (isAr ? 'الأنشطة ستظهر هنا تلقائياً' : 'Les activités apparaîtront ici automatiquement')
              }
            />
          </div>
        ) : (
          logs.map(log => {
            const isExp       = expanded === log.log_id
            const actionStyle = ACTION_COLORS[log.action_type] ?? 'bg-slate-50 text-slate-600 border-slate-200'
            const storeName   = STORE_NAMES[log.store_id ?? ''] ?? log.store_id ?? '—'

            return (
              <div
                key={log.log_id}
                className="bg-white border border-[#E8E5DE] rounded-xl overflow-hidden hover:shadow-sm transition-all"
              >
                {/* Row */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#F5F3FF] transition-all"
                  onClick={() => setExpanded(isExp ? null : log.log_id)}
                >
                  {/* Action badge */}
                  <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-md border font-mono uppercase tracking-wide ${actionStyle}`}>
                    {log.action_type}
                  </span>

                  {/* Module badge */}
                  <span className="flex-shrink-0 text-[10px] font-mono text-[#B0ADA6] bg-[#F8F7F4] border border-[#E8E5DE] px-2 py-0.5 rounded">
                    {log.module}
                  </span>

                  {/* User */}
                  <span className="text-sm font-semibold text-[#1A1A1A] flex-shrink-0">
                    {log.user_name}
                  </span>

                  {/* Record ID */}
                  {log.record_id && (
                    <span className="text-xs text-[#B0ADA6] font-mono flex-shrink-0">
                      {log.record_id}
                    </span>
                  )}

                  {/* Notes preview */}
                  {log.notes && (
                    <span className="text-xs text-[#6B6860] flex-1 truncate hidden sm:block">
                      {log.notes}
                    </span>
                  )}

                  {/* Store + Time */}
                  <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                    <span className="text-[10px] text-[#6366F1] font-medium hidden md:block">
                      {storeName}
                    </span>
                    <span className="text-xs text-[#B0ADA6] tabular-nums">
                      {new Date(log.created_at).toLocaleString('fr-FR', {
                        day:    '2-digit',
                        month:  '2-digit',
                        hour:   '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {isExp
                      ? <ChevronUp   className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                      : <ChevronDown className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                    }
                  </div>
                </div>

                {/* Expanded detail */}
                {isExp && (
                  <div className="px-4 pb-4 space-y-3 border-t border-[#F2F0EB] pt-3">

                    {/* Meta */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div>
                        <p className="text-[#B0ADA6] font-mono uppercase tracking-widest mb-0.5">Log ID</p>
                        <p className="text-[#6B6860] font-mono">{log.log_id}</p>
                      </div>
                      <div>
                        <p className="text-[#B0ADA6] font-mono uppercase tracking-widest mb-0.5">
                          {isAr ? 'المتجر' : 'Magasin'}
                        </p>
                        <p className="text-[#6B6860]">{storeName}</p>
                      </div>
                      <div>
                        <p className="text-[#B0ADA6] font-mono uppercase tracking-widest mb-0.5">IP</p>
                        <p className="text-[#6B6860] font-mono">{log.ip_address ?? '—'}</p>
                      </div>
                      <div>
                        <p className="text-[#B0ADA6] font-mono uppercase tracking-widest mb-0.5">
                          {isAr ? 'التاريخ' : 'Date complète'}
                        </p>
                        <p className="text-[#6B6860]">
                          {new Date(log.created_at).toLocaleString('fr-FR')}
                        </p>
                      </div>
                    </div>

                    {/* Notes */}
                    {log.notes && (
                      <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                        <p className="text-[10px] font-mono text-amber-600 uppercase tracking-widest mb-0.5">
                          {isAr ? 'ملاحظة' : 'Note'}
                        </p>
                        <p className="text-sm text-amber-800">{log.notes}</p>
                      </div>
                    )}

                    {/* Before / After */}
                    {(log.before_state || log.after_state) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {log.before_state && (
                          <div>
                            <p className="text-[10px] font-mono text-[#B0ADA6] uppercase tracking-widest mb-1">
                              {isAr ? 'قبل' : 'Avant'}
                            </p>
                            <pre className="text-[10px] bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl p-3 overflow-auto max-h-48 text-[#6B6860] leading-relaxed">
                              {JSON.stringify(log.before_state, null, 2)}
                            </pre>
                          </div>
                        )}
                        {log.after_state && (
                          <div>
                            <p className="text-[10px] font-mono text-[#B0ADA6] uppercase tracking-widest mb-1">
                              {isAr ? 'بعد' : 'Après'}
                            </p>
                            <pre className="text-[10px] bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl p-3 overflow-auto max-h-48 text-[#6B6860] leading-relaxed">
                              {JSON.stringify(log.after_state, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}