'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Search, RefreshCw, Eye, X,
  FileText, ChevronDown, Calendar,
} from 'lucide-react'
import { toast } from 'sonner'
import { WarrantyBadge } from './WarrantyBadge'

// ── Types ─────────────────────────────────────────────────────────────────────

const DOC_TYPES = {
  FAC: { label: 'Facture',     labelAr: 'فاتورة',       color: 'text-blue-400   bg-blue-500/10   border-blue-500/20'   },
  RCH: { label: 'Acquisition', labelAr: 'اقتناء',       color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  ECH: { label: 'Reprise',     labelAr: 'استبدال',      color: 'text-amber-400  bg-amber-500/10  border-amber-500/20'  },
  PEC: { label: 'SAV Prise',   labelAr: 'صيانة استلام', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
  RST: { label: 'SAV Retour',  labelAr: 'صيانة إرجاع',  color: 'text-cyan-400   bg-cyan-500/10   border-cyan-500/20'   },
} as const

type DocType = keyof typeof DOC_TYPES

interface DocRecord {
  doc_id:          string
  doc_type:        DocType
  doc_ref:         string
  doc_date:        string
  client_name:     string | null
  client_tel:      string | null
  device_label:    string | null
  imei:            string | null
  montant:         number | null
  warranty_end:    string | null
  warranty_months: number | null
  txn_id:          string | null
  phone_id:        string | null
  created_at:      string
  printed_at:      string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('fr-MA', { day: '2-digit', month: '2-digit', year: 'numeric' })

const fmtMAD = (n: number | null) =>
  n != null ? `${n.toLocaleString('fr-MA')} MAD` : '—'

// ── Component ─────────────────────────────────────────────────────────────────

export function ArchiveTable() {
  const [docs,       setDocs]       = useState<DocRecord[]>([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [fromDate,   setFromDate]   = useState('')
  const [toDate,     setToDate]     = useState('')
  const [hasMore,    setHasMore]    = useState(false)
  const [preview,    setPreview]    = useState<DocRecord | null>(null)

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (search)     params.set('search',  search)
      if (typeFilter) params.set('type',    typeFilter)
      if (fromDate)   params.set('from',    fromDate)
      if (toDate)     params.set('to',      toDate)

      const res  = await fetch(`/api/documents?${params}`)
      const json = await res.json()
      if (json.status !== 'success') throw new Error()

      const fetched: DocRecord[] = json.data
      setDocs(fetched)
      setHasMore(fetched.length === 50)
    } catch {
      toast.error('Erreur lors du chargement des documents')
    } finally {
      setLoading(false)
    }
  }, [search, typeFilter, fromDate, toDate])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
          <input
            type="text"
            placeholder="Réf, client, IMEI, appareil..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg
                       text-sm text-white placeholder-white/25 focus:outline-none
                       focus:border-[#C9A440]/50 transition-colors"
          />
        </div>

        {/* Type */}
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white
                     focus:outline-none focus:border-[#C9A440]/50 transition-colors"
        >
          <option value="">Tous les types</option>
          {Object.entries(DOC_TYPES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {/* Date from */}
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="pl-9 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white
                       focus:outline-none focus:border-[#C9A440]/50 transition-colors"
          />
        </div>

        {/* Date to */}
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="pl-9 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white
                       focus:outline-none focus:border-[#C9A440]/50 transition-colors"
          />
        </div>

        {/* Refresh */}
        <button
          onClick={fetchDocs}
          disabled={loading}
          title="Actualiser"
          className="p-2.5 bg-white/5 border border-white/10 rounded-lg text-white/50
                     hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                {['Référence', 'Type', 'Date', 'Client', 'Appareil / IMEI', 'Montant', 'Garantie', ''].map(h => (
                  <th key={h} className={`px-4 py-3 text-xs text-white/40 font-medium uppercase tracking-wider
                                          ${h === 'Montant' ? 'text-right' : h === '' ? 'text-center' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-white/[0.04]">

              {/* Loading skeleton */}
              {loading && docs.length === 0 && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-4 py-4">
                      <div className="h-3 bg-white/5 rounded w-3/4" />
                    </td>
                  ))}
                </tr>
              ))}

              {/* Empty state */}
              {!loading && docs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <FileText className="w-8 h-8 mx-auto mb-3 text-white/15" />
                    <p className="text-white/30 text-sm">Aucun document trouvé</p>
                    {(search || typeFilter || fromDate || toDate) && (
                      <button
                        onClick={() => { setSearch(''); setTypeFilter(''); setFromDate(''); setToDate('') }}
                        className="mt-2 text-xs text-[#C9A440]/70 hover:text-[#C9A440] transition-colors"
                      >
                        Effacer les filtres
                      </button>
                    )}
                  </td>
                </tr>
              )}

              {/* Rows */}
              {docs.map(doc => {
                const tc = DOC_TYPES[doc.doc_type]
                return (
                  <tr key={doc.doc_id} className="hover:bg-white/[0.02] transition-colors">

                    {/* Réf */}
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-[#C9A440]">{doc.doc_ref}</span>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${tc.color}`}>
                        {tc.label}
                      </span>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">
                      {fmtDate(doc.doc_date)}
                    </td>

                    {/* Client */}
                    <td className="px-4 py-3">
                      <p className="text-white text-sm truncate max-w-[140px]">
                        {doc.client_name ?? <span className="text-white/25">—</span>}
                      </p>
                      {doc.client_tel && (
                        <p className="text-white/35 text-xs">{doc.client_tel}</p>
                      )}
                    </td>

                    {/* Appareil / IMEI */}
                    <td className="px-4 py-3">
                      <p className="text-white/80 text-xs truncate max-w-[180px]">
                        {doc.device_label ?? <span className="text-white/25">—</span>}
                      </p>
                      {doc.imei && (
                        <p className="text-white/25 text-xs font-mono">{doc.imei}</p>
                      )}
                    </td>

                    {/* Montant */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className="text-white font-medium">{fmtMAD(doc.montant)}</span>
                    </td>

                    {/* Garantie */}
                    <td className="px-4 py-3 text-center">
                      {doc.doc_type === 'FAC' && doc.txn_id
                        ? <WarrantyBadge txn_id={doc.txn_id} showDetails />
                        : <span className="text-white/20 text-xs">—</span>
                      }
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setPreview(doc)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/50
                                   hover:text-white bg-white/5 hover:bg-white/10 border border-white/10
                                   hover:border-white/20 rounded-lg transition-all"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Voir
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Load more ─────────────────────────────────────────────────────── */}
      {hasMore && (
        <div className="flex justify-center">
          <button
            onClick={fetchDocs}
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm text-white/50
                       hover:text-white border border-white/10 hover:border-white/20
                       rounded-lg transition-all disabled:opacity-40"
          >
            <ChevronDown className="w-4 h-4" />
            Charger plus
          </button>
        </div>
      )}

      {/* ── Preview Modal ──────────────────────────────────────────────────── */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setPreview(null) }}
        >
          <div className="w-full max-w-lg bg-[#0c0c0c] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">

            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b border-white/10">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-[#C9A440] text-base tracking-wide">
                    {preview.doc_ref}
                  </span>
                  {(() => {
                    const tc = DOC_TYPES[preview.doc_type]
                    return (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${tc.color}`}>
                        {tc.label}
                      </span>
                    )
                  })()}
                </div>
                <p className="text-white/35 text-xs">
                  {fmtDate(preview.doc_date)}
                  {preview.printed_at
                    ? ` · Imprimé le ${fmtDate(preview.printed_at)}`
                    : ' · Non encore imprimé'}
                </p>
              </div>
              <button
                onClick={() => setPreview(null)}
                className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Warranty status (FAC only) */}
            {preview.doc_type === 'FAC' && preview.txn_id && (
              <div className="px-5 py-3 border-b border-white/10 bg-white/[0.02]">
                <WarrantyBadge txn_id={preview.txn_id} showDetails />
              </div>
            )}

            {/* Info grid */}
            <div className="p-5">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Client',          value: preview.client_name },
                  { label: 'Téléphone',       value: preview.client_tel  },
                  { label: 'Appareil',        value: preview.device_label },
                  { label: 'IMEI',            value: preview.imei,         mono: true },
                  { label: 'Montant',         value: fmtMAD(preview.montant) },
                  { label: 'Fin de garantie', value: preview.warranty_end ? fmtDate(preview.warranty_end) : null },
                  { label: 'Transaction',     value: preview.txn_id,       mono: true },
                  { label: 'Téléphone ERP',   value: preview.phone_id,     mono: true },
                ].filter(f => f.value).map(({ label, value, mono }) => (
                  <div key={label} className="bg-white/[0.04] rounded-xl p-3">
                    <p className="text-white/35 text-xs mb-1">{label}</p>
                    <p className={`text-sm truncate ${mono ? 'font-mono text-xs text-[#C9A440]' : 'text-white'}`}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end px-5 py-4 border-t border-white/10">
              <button
                onClick={() => setPreview(null)}
                className="px-4 py-2 text-sm text-white/50 hover:text-white border border-white/10
                           hover:border-white/20 rounded-lg transition-all"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}