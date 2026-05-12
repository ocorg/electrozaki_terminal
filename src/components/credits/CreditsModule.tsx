'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD, formatDate } from '@/lib/utils'
import { Modal, Field, inputClass, selectClass, PageHeader, EmptyState, SkeletonRow } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import {
  CreditCard, Plus, RefreshCw, Trash2, Link2,
  Calendar, Search, X, DollarSign, User, AlertCircle
} from 'lucide-react'

interface ClientWithCredit {
  client_id:    string
  nom:          string
  telephone:    string
  solde_impaye: number
}

interface CreditImport {
  import_id:         string
  client_id:         string | null
  client_name_free:  string | null
  client_phone_free: string | null
  store_id:          string
  montant_du:        number
  description:       string | null
  date_origine:      string
  notes:             string | null
  clients?:          { nom: string; telephone: string } | null
}

interface PaymentForm {
  montant:        string
  payment_method: 'نقد' | 'تحويل'
  payment_ref:    string
  notes:          string
}

interface ImportForm {
  client_id:         string
  client_name_free:  string
  client_phone_free: string
  montant_du:        string
  description:       string
  date_origine:      string
  notes:             string
  useExisting:       boolean
}

interface ClientSuggestion {
  client_id: string
  nom:       string
  telephone: string
}

interface CreditsModuleProps {
  storeId: string
}

export default function CreditsModule({ storeId }: CreditsModuleProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const isAr         = language === 'ar'

  const [tab, setTab]           = useState<'credits' | 'imports'>('credits')
  const [credits, setCredits]   = useState<ClientWithCredit[]>([])
  const [imports, setImports]   = useState<CreditImport[]>([])
  const [loading, setLoading]   = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Payment modal
  const [payTarget, setPayTarget]   = useState<ClientWithCredit | null>(null)
  const [payForm, setPayForm]       = useState<PaymentForm>({
    montant: '', payment_method: 'نقد', payment_ref: '', notes: ''
  })

  // Import form
  const [importForm, setImportForm] = useState<ImportForm>({
    client_id: '', client_name_free: '', client_phone_free: '',
    montant_du: '', description: '', date_origine: '', notes: '', useExisting: true,
  })
  const [clientSearch, setClientSearch]         = useState('')
  const [clientSuggestions, setClientSuggestions] = useState<ClientSuggestion[]>([])
  const [showClientDrop, setShowClientDrop]     = useState(false)

  // Link modal
  const [linkTarget, setLinkTarget]   = useState<CreditImport | null>(null)
  const [linkSearch, setLinkSearch]   = useState('')
  const [linkSuggestions, setLinkSuggestions] = useState<ClientSuggestion[]>([])

  // ── Fetch credits list (clients with solde_impaye > 0) ─────
  const fetchCredits = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/clients?store_id=${storeId}`)
      const json = await res.json()
      const withCredit = (json.data || [])
        .filter((c: ClientWithCredit) => (c.solde_impaye ?? 0) > 0)
        .sort((a: ClientWithCredit, b: ClientWithCredit) => b.solde_impaye - a.solde_impaye)
      setCredits(withCredit)
    } catch {
      showError('Erreur chargement crédits')
    } finally {
      setLoading(false)
    }
  }, [storeId])

  const fetchImports = useCallback(async () => {
    try {
      const res  = await fetch(`/api/credit-imports?store_id=${storeId}`)
      const json = await res.json()
      setImports(json.data || [])
    } catch {
      showError('Erreur chargement imports')
    }
  }, [storeId])

  useEffect(() => { fetchCredits(); fetchImports() }, [fetchCredits, fetchImports])

  // ── Client autocomplete for import form ───────────────────
  useEffect(() => {
    if (!clientSearch.trim() || clientSearch.length < 1) {
      setClientSuggestions([])
      setShowClientDrop(false)
      return
    }
    const t = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/clients?search=${encodeURIComponent(clientSearch)}&store_id=${storeId}`)
        const json = await res.json()
        setClientSuggestions(json.data || [])
        setShowClientDrop(true)
      } catch { setClientSuggestions([]) }
    }, 200)
    return () => clearTimeout(t)
  }, [clientSearch, storeId])

  // ── Client autocomplete for link modal ────────────────────
  useEffect(() => {
    if (!linkSearch.trim() || linkSearch.length < 1) { setLinkSuggestions([]); return }
    const t = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/clients?search=${encodeURIComponent(linkSearch)}&store_id=${storeId}`)
        const json = await res.json()
        setLinkSuggestions(json.data || [])
      } catch { setLinkSuggestions([]) }
    }, 200)
    return () => clearTimeout(t)
  }, [linkSearch, storeId])

  // ── Record payment ────────────────────────────────────────
  async function submitPayment() {
    if (!payTarget) return
    const montant = parseFloat(payForm.montant)
    if (!montant || montant <= 0) { showError('Montant invalide'); return }
    if (montant > payTarget.solde_impaye) {
      showError(`Montant dépasse le solde (${formatMAD(payTarget.solde_impaye)})`)
      return
    }
    if (payForm.payment_method === 'تحويل' && !payForm.payment_ref) {
      showError('Référence virement requise')
      return
    }
    setSubmitting(true)
    try {
      const res  = await fetch('/api/credits', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          client_id:      payTarget.client_id,
          store_id:       storeId,
          montant,
          payment_method: payForm.payment_method,
          payment_ref:    payForm.payment_ref || undefined,
          notes:          payForm.notes || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم تسجيل الدفع ✓' : 'Paiement enregistré ✓')
      setPayTarget(null)
      setPayForm({ montant: '', payment_method: 'نقد', payment_ref: '', notes: '' })
      await fetchCredits()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Submit import ─────────────────────────────────────────
  async function submitImport() {
    const montant = parseFloat(importForm.montant_du)
    if (!montant || montant <= 0) { showError('Montant invalide'); return }
    if (!importForm.date_origine) { showError('Date requise'); return }
    if (importForm.useExisting && !importForm.client_id) {
      showError('Sélectionnez un client')
      return
    }
    if (!importForm.useExisting && !importForm.client_name_free) {
      showError('Nom du client requis')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        store_id:     storeId,
        montant_du:   montant,
        description:  importForm.description || undefined,
        date_origine: importForm.date_origine,
        notes:        importForm.notes || undefined,
      }
      if (importForm.useExisting) {
        body.client_id = importForm.client_id
      } else {
        body.client_name_free  = importForm.client_name_free
        body.client_phone_free = importForm.client_phone_free || undefined
      }
      const res  = await fetch('/api/credit-imports', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showSuccess(isAr ? 'تم استيراد الدين ✓' : 'Crédit importé ✓')
      setImportForm({
        client_id: '', client_name_free: '', client_phone_free: '',
        montant_du: '', description: '', date_origine: '', notes: '', useExisting: true,
      })
      setClientSearch('')
      await fetchImports()
      await fetchCredits()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Delete import ─────────────────────────────────────────
  async function deleteImport(import_id: string) {
    if (!window.confirm(isAr ? 'حذف هذا الاستيراد؟' : 'Supprimer cet import ?')) return
    try {
      const res = await fetch(`/api/credit-imports?import_id=${import_id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      showSuccess(isAr ? 'تم الحذف' : 'Import supprimé')
      await fetchImports()
      await fetchCredits()
    } catch (err: unknown) {
      showError((err as Error).message)
    }
  }

  // ── Link import to client ─────────────────────────────────
  async function linkImport(import_id: string, client_id: string) {
    try {
      const res  = await fetch('/api/credit-imports', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ import_id, client_id }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      showSuccess(isAr ? 'تم الربط ✓' : 'Lié au client ✓')
      setLinkTarget(null)
      setLinkSearch('')
      await fetchImports()
    } catch (err: unknown) {
      showError((err as Error).message)
    }
  }

  const isOwner   = user?.role === 'owner'
  const totalDue  = credits.reduce((s, c) => s + c.solde_impaye, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'إدارة الذمم' : 'Gestion des crédits'}
          subtitle={isAr
            ? `${credits.length} عميل لديه دين مفتوح · إجمالي: ${formatMAD(totalDue)}`
            : `${credits.length} client(s) avec solde ouvert · Total : ${formatMAD(totalDue)}`}
          actions={
            <button onClick={() => { fetchCredits(); fetchImports() }} disabled={loading}
              className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F5F3FF] transition-all">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          }
        />

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-[#F2F0EB] rounded-2xl w-fit">
          {[
            { key: 'credits', label: isAr ? 'الذمم الحالية' : 'Crédits en cours' },
            { key: 'imports', label: isAr ? 'استيراد تاريخي' : 'Import historique' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key as 'credits' | 'imports')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                tab === t.key
                  ? 'bg-white text-[#1A1A1A] shadow-sm'
                  : 'text-[#6B6860] hover:text-[#1A1A1A]'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 pb-6">

        {/* ── TAB 1 — Crédits en cours ─────────────────────── */}
        {tab === 'credits' && (
          <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
            {loading ? (
              <div className="divide-y divide-[#F2F0EB]">
                {[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}
              </div>
            ) : credits.length === 0 ? (
              <EmptyState
                icon={<CreditCard className="w-7 h-7" />}
                title={isAr ? 'لا توجد ذمم مفتوحة' : 'Aucun crédit en cours'}
              />
            ) : (
              <div className="divide-y divide-[#F2F0EB]">
                {/* Table header */}
                <div className="hidden sm:grid grid-cols-4 gap-4 px-5 py-3 bg-[#F8F7F4]">
                  {[
                    isAr ? 'العميل' : 'Client',
                    isAr ? 'الهاتف' : 'Téléphone',
                    isAr ? 'الرصيد المستحق' : 'Solde dû',
                    '',
                  ].map((h, i) => (
                    <p key={i} className="text-xs font-bold text-[#B0ADA6] uppercase tracking-wider">{h}</p>
                  ))}
                </div>
                {credits.map(c => (
                  <div key={c.client_id}
                    className="grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-4 items-center px-5 py-4 hover:bg-[#F8F7F4] transition-all">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4 text-red-500" />
                      </div>
                      <p className="text-sm font-bold text-[#1A1A1A]">{c.nom}</p>
                    </div>
                    <p className="text-sm text-[#6B6860] font-mono">{c.telephone}</p>
                    <p className="text-sm font-bold text-red-500">{formatMAD(c.solde_impaye)}</p>
                    <button
                      onClick={() => { setPayTarget(c); setPayForm(f => ({ ...f, montant: String(c.solde_impaye) })) }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all w-fit">
                      <DollarSign className="w-3 h-3" />
                      {isAr ? 'تسجيل دفع' : 'Enregistrer un paiement'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2 — Import historique ─────────────────────── */}
        {tab === 'imports' && (
          <div className="space-y-6">
            {/* Import form */}
            <div className="bg-white border border-[#E8E5DE] rounded-2xl p-6 space-y-4">
              <p className="text-sm font-bold text-[#1A1A1A] flex items-center gap-2">
                <Plus className="w-4 h-4" />
                {isAr ? 'إضافة دين تاريخي' : 'Importer un crédit historique'}
              </p>

              {/* Client type toggle */}
              <div className="flex gap-2">
                {[
                  { v: true,  l: isAr ? 'عميل موجود' : 'Client existant' },
                  { v: false, l: isAr ? 'عميل جديد' : 'Client libre' },
                ].map(opt => (
                  <button key={String(opt.v)}
                    onClick={() => setImportForm(f => ({ ...f, useExisting: opt.v, client_id: '', client_name_free: '' }))}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                      importForm.useExisting === opt.v
                        ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                        : 'bg-white text-[#6B6860] border-[#E8E5DE]'
                    }`}>
                    {opt.l}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Client field */}
                {importForm.useExisting ? (
                  <Field label={isAr ? 'العميل *' : 'Client *'}>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#B0ADA6]" />
                      <input
                        className={`${inputClass} pl-9`}
                        placeholder={isAr ? 'بحث عن عميل...' : 'Rechercher un client...'}
                        value={clientSearch}
                        onChange={e => setClientSearch(e.target.value)}
                        onBlur={() => setTimeout(() => setShowClientDrop(false), 150)}
                        autoComplete="off"
                      />
                      {showClientDrop && clientSuggestions.length > 0 && (
                        <div className="absolute z-30 w-full mt-1 bg-white border border-[#E8E5DE] rounded-xl shadow-xl overflow-hidden max-h-48 overflow-y-auto">
                          {clientSuggestions.map(c => (
                            <button key={c.client_id} type="button"
                              onMouseDown={() => {
                                setImportForm(f => ({ ...f, client_id: c.client_id }))
                                setClientSearch(`${c.nom} — ${c.telephone}`)
                                setShowClientDrop(false)
                              }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F8F7F4] text-left border-b border-[#F2F0EB] last:border-0">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-[#1A1A1A] truncate">{c.nom}</p>
                                <p className="text-[10px] text-[#B0ADA6] font-mono">{c.telephone}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </Field>
                ) : (
                  <Field label={isAr ? 'الاسم *' : 'Nom *'}>
                    <input className={inputClass}
                      placeholder={isAr ? 'اسم العميل' : 'Nom du client'}
                      value={importForm.client_name_free}
                      onChange={e => setImportForm(f => ({ ...f, client_name_free: e.target.value }))} />
                  </Field>
                )}

                {!importForm.useExisting && (
                  <Field label={isAr ? 'الهاتف' : 'Téléphone'}>
                    <input className={inputClass} type="tel"
                      placeholder="06XXXXXXXX"
                      value={importForm.client_phone_free}
                      onChange={e => setImportForm(f => ({ ...f, client_phone_free: e.target.value }))} />
                  </Field>
                )}

                <Field label={isAr ? 'المبلغ المستحق (درهم) *' : 'Montant dû (MAD) *'}>
                  <input className={inputClass} type="number" min="0" step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={importForm.montant_du}
                    onChange={e => setImportForm(f => ({ ...f, montant_du: e.target.value }))} />
                </Field>

                <Field label={isAr ? 'تاريخ الدين الأصلي *' : 'Date d\'origine *'}>
                  <input className={inputClass} type="date"
                    value={importForm.date_origine}
                    onChange={e => setImportForm(f => ({ ...f, date_origine: e.target.value }))} />
                </Field>

                <Field label={isAr ? 'وصف' : 'Description'}>
                  <input className={inputClass}
                    placeholder={isAr ? 'ما الذي اشتراه؟' : 'Objet du crédit'}
                    value={importForm.description}
                    onChange={e => setImportForm(f => ({ ...f, description: e.target.value }))} />
                </Field>

                <Field label={isAr ? 'ملاحظات' : 'Notes'}>
                  <input className={inputClass}
                    placeholder={isAr ? 'ملاحظات إضافية' : 'Notes internes'}
                    value={importForm.notes}
                    onChange={e => setImportForm(f => ({ ...f, notes: e.target.value }))} />
                </Field>
              </div>

              <button onClick={submitImport} disabled={submitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1A1A1A] text-white text-sm font-bold hover:bg-[#333] transition-all disabled:opacity-50">
                <Plus className="w-4 h-4" />
                {submitting
                  ? (isAr ? 'جارٍ الحفظ...' : 'Enregistrement...')
                  : (isAr ? 'حفظ الدين' : 'Enregistrer le crédit')}
              </button>
            </div>

            {/* Imports table */}
            {imports.length > 0 && (
              <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
                <div className="px-5 py-3 bg-[#F8F7F4] border-b border-[#E8E5DE]">
                  <p className="text-xs font-bold text-[#B0ADA6] uppercase tracking-wider">
                    {isAr ? 'الديون المستوردة' : 'Crédits importés'} ({imports.length})
                  </p>
                </div>
                <div className="divide-y divide-[#F2F0EB]">
                  {imports.map(imp => {
                    const displayName = imp.clients?.nom ?? imp.client_name_free ?? '—'
                    const displayPhone = imp.clients?.telephone ?? imp.client_phone_free ?? '—'
                    const isUnlinked = !imp.client_id

                    return (
                      <div key={imp.import_id}
                        className="flex items-center gap-4 px-5 py-3 hover:bg-[#F8F7F4] transition-all flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-[#1A1A1A]">{displayName}</p>
                            {isUnlinked && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                {isAr ? 'غير مرتبط' : 'Non lié'}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#B0ADA6] mt-0.5">
                            {displayPhone} · {formatDate(imp.date_origine)}
                            {imp.description && ` · ${imp.description}`}
                          </p>
                        </div>
                        <p className="text-sm font-bold text-red-500 flex-shrink-0">
                          {formatMAD(imp.montant_du)}
                        </p>
                        <div className="flex gap-2 flex-shrink-0">
                          {isUnlinked && (
                            <button
                              onClick={() => { setLinkTarget(imp); setLinkSearch('') }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-all">
                              <Link2 className="w-3 h-3" />
                              {isAr ? 'ربط' : 'Lier'}
                            </button>
                          )}
                          {isOwner && (
                            <button onClick={() => deleteImport(imp.import_id)}
                              className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 border border-transparent hover:border-red-200 transition-all">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Payment Modal ──────────────────────────────────── */}
      {payTarget && (
        <Modal
          open={payTarget !== null}
          title={isAr ? `دفع ذمة — ${payTarget.nom}` : `Paiement crédit — ${payTarget.nom}`}
          onClose={() => setPayTarget(null)}
        >
          <div className="space-y-4">
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl">
              <p className="text-xs text-red-700 font-medium">
                {isAr ? 'الرصيد المستحق:' : 'Solde en cours :'}{' '}
                <span className="font-bold">{formatMAD(payTarget.solde_impaye)}</span>
              </p>
            </div>

            <Field label={isAr ? 'المبلغ المحصل (درهم) *' : 'Montant encaissé (MAD) *'}>
              <input className={inputClass} type="number" min="0" step="0.01"
                inputMode="decimal"
                value={payForm.montant}
                onChange={e => setPayForm(f => ({ ...f, montant: e.target.value }))}
                autoFocus />
            </Field>

            <Field label={isAr ? 'طريقة الدفع' : 'Méthode de paiement'}>
              <select className={selectClass} value={payForm.payment_method}
                onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value as 'نقد' | 'تحويل' }))}>
                <option value="نقد">{isAr ? 'نقداً' : 'Espèces'}</option>
                <option value="تحويل">{isAr ? 'تحويل بنكي' : 'Virement'}</option>
              </select>
            </Field>

            {payForm.payment_method === 'تحويل' && (
              <Field label={isAr ? 'مرجع التحويل *' : 'Référence virement *'}>
                <input className={inputClass}
                  placeholder="REF-..."
                  value={payForm.payment_ref}
                  onChange={e => setPayForm(f => ({ ...f, payment_ref: e.target.value }))} />
              </Field>
            )}

            <Field label={isAr ? 'ملاحظات' : 'Notes'}>
              <input className={inputClass}
                placeholder={isAr ? 'ملاحظات...' : 'Notes...'}
                value={payForm.notes}
                onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} />
            </Field>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setPayTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-[#E8E5DE] text-sm font-bold text-[#6B6860] hover:bg-[#F8F7F4] transition-all">
                {isAr ? 'إلغاء' : 'Annuler'}
              </button>
              <button onClick={submitPayment} disabled={submitting}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-all disabled:opacity-50">
                {submitting ? '...' : (isAr ? 'تأكيد الدفع' : 'Confirmer')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Link-to-client Modal ──────────────────────────── */}
      {linkTarget && (
        <Modal
          open={linkTarget !== null}
          title={isAr ? 'ربط بعميل' : 'Lier à un client'}
          onClose={() => setLinkTarget(null)}
        >
          <div className="space-y-4">
            <p className="text-xs text-[#6B6860]">
              {isAr
                ? `الدين المستورد: ${linkTarget.client_name_free} — ${formatMAD(linkTarget.montant_du)}`
                : `Import : ${linkTarget.client_name_free} — ${formatMAD(linkTarget.montant_du)}`}
            </p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#B0ADA6]" />
              <input className={`${inputClass} pl-9`}
                placeholder={isAr ? 'بحث عن عميل...' : 'Rechercher un client...'}
                value={linkSearch}
                onChange={e => setLinkSearch(e.target.value)}
                autoFocus />
            </div>
            {linkSuggestions.length > 0 && (
              <div className="border border-[#E8E5DE] rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                {linkSuggestions.map(c => (
                  <button key={c.client_id}
                    onClick={() => linkImport(linkTarget.import_id, c.client_id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F8F7F4] text-left border-b border-[#F2F0EB] last:border-0 transition-all">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#1A1A1A]">{c.nom}</p>
                      <p className="text-[10px] text-[#B0ADA6] font-mono">{c.telephone}</p>
                    </div>
                    <span className="text-[10px] font-bold text-blue-600">
                      {isAr ? 'اختيار' : 'Choisir'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}