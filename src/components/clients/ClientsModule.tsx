'use client'
import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, formatDate } from '@/lib/utils'
import { Modal, Field, inputClass, Btn, PageHeader, EmptyState, SkeletonRow } from '@/components/shared'
import { toast } from 'sonner'
import {
  Users, Plus, Search, X, Phone, Mail,
  MapPin, RefreshCw, Edit2, TrendingUp,
  ShoppingCart, Wrench, MessageCircle, ChevronRight
} from 'lucide-react'

interface Client {
  client_id:          string
  nom:                string
  telephone:          string
  telephone_2?:       string | null
  email?:             string | null
  adresse?:           string | null
  date_premier_achat?: string | null
  notes?:             string | null
  created_at:         string
  total_ca?:          number
  solde_impaye?:      number
  total_reparations?: number
}

const EMPTY_FORM = {
  nom:         '',
  telephone:   '',
  telephone_2: '',
  email:       '',
  adresse:     '',
  notes:       '',
}

interface ClientsModuleProps {
  storeId: string
}

export default function ClientsModule({ storeId }: ClientsModuleProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor

  const [clients, setClients]       = useState<Client[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [selected, setSelected]     = useState<Client | null>(null)
  const [formOpen, setFormOpen]     = useState(false)
  const [editClient, setEditClient] = useState<Client | null>(null)
  const [form, setForm]             = useState({ ...EMPTY_FORM })
  const [submitting, setSubmitting] = useState(false)

  const fetchClients = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ store_id: storeId })
      if (search.length >= 2) params.set('search', search)
      const res  = await fetch(`/api/clients?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setClients(json.data || [])
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [storeId, search])

  useEffect(() => {
    const t = setTimeout(() => fetchClients(), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [fetchClients, search])

  function openAdd() {
    setEditClient(null)
    setForm({ ...EMPTY_FORM })
    setFormOpen(true)
  }

  function openEdit(client: Client) {
    setEditClient(client)
    setForm({
      nom:         client.nom,
      telephone:   client.telephone,
      telephone_2: client.telephone_2 ?? '',
      email:       client.email ?? '',
      adresse:     client.adresse ?? '',
      notes:       client.notes ?? '',
    })
    setFormOpen(true)
    setSelected(null)
  }

  function setF(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit() {
    if (!form.nom || !form.telephone) {
      toast.error(isAr ? 'الاسم والهاتف مطلوبان' : 'Nom et téléphone obligatoires')
      return
    }
    setSubmitting(true)
    try {
      const isEdit  = !!editClient
      const payload = {
        store_id:    storeId,
        nom:         form.nom,
        telephone:   form.telephone,
        telephone_2: form.telephone_2  || null,
        email:       form.email        || null,
        adresse:     form.adresse      || null,
        notes:       form.notes        || null,
      }

      const res = await fetch('/api/clients', {
        method:  isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(
          isEdit ? { client_id: editClient!.client_id, ...payload } : payload
        ),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)

      toast.success(isEdit
        ? (isAr ? 'تم التعديل ✓' : 'Client modifié ✓')
        : (isAr ? 'تم الإضافة ✓' : 'Client ajouté ✓'))
      setFormOpen(false)
      setForm({ ...EMPTY_FORM })
      setEditClient(null)
      await fetchClients()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const totalClients = clients.length
  const totalCA      = clients.reduce((s, c) => s + (c.total_ca ?? 0), 0)
  const openCredits  = clients.filter(c => (c.solde_impaye ?? 0) > 0).length

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>

      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title={isAr ? 'العملاء' : 'Clients'}
          subtitle={isAr
            ? `${totalClients} عميل مسجل`
            : `${totalClients} client${totalClients !== 1 ? 's' : ''} enregistré${totalClients !== 1 ? 's' : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={fetchClients} disabled={loading}
                className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F8F7F4] transition-all disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <Btn variant="primary" onClick={openAdd}
                style={{ backgroundColor: primary } as React.CSSProperties}>
                <Plus className="w-4 h-4" />
                {isAr ? 'عميل جديد' : 'Nouveau client'}
              </Btn>
            </div>
          }
        />

        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: isAr ? 'إجمالي العملاء' : 'Total clients',    value: String(totalClients), color: primary },
            { label: isAr ? 'رقم الأعمال'     : 'CA total',         value: formatMAD(totalCA),   color: '#10B981' },
            { label: isAr ? 'تسبيقات مفتوحة'  : 'Avances ouvertes', value: String(openCredits),  color: openCredits > 0 ? '#F59E0B' : '#10B981' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-[#E8E5DE] rounded-xl px-4 py-3"
                 style={{ borderLeftColor: s.color, borderLeftWidth: '3px' }}>
              <p className="text-xs text-[#6B6860]">{s.label}</p>
              <p className="font-display font-bold text-lg text-[#1A1A1A]">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
          <input
            className="w-full pl-9 pr-9 py-2.5 bg-white border border-[#E8E5DE] rounded-xl text-sm placeholder:text-[#B0ADA6] focus:outline-none transition-all"
            placeholder={isAr ? 'بحث بالاسم أو الهاتف...' : 'Rechercher par nom ou téléphone...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={e => { e.target.style.borderColor = primary; e.target.style.boxShadow = `0 0 0 3px ${primary}20` }}
            onBlur={e => { e.target.style.borderColor = '#E8E5DE'; e.target.style.boxShadow = 'none' }}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B0ADA6] hover:text-[#1A1A1A]">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── List ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          {loading ? (
            <div className="divide-y divide-[#F2F0EB]">
              {[...Array(6)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : clients.length === 0 ? (
            <EmptyState
              icon={<Users className="w-7 h-7" />}
              title={isAr ? 'لا يوجد عملاء' : 'Aucun client'}
              description={search
                ? (isAr ? 'لا توجد نتائج' : 'Aucun résultat')
                : (isAr ? 'أضف أول عميل' : 'Ajoutez le premier client')}
              action={
                !search
                  ? <Btn variant="primary" onClick={openAdd}
                      style={{ backgroundColor: primary } as React.CSSProperties}>
                      <Plus className="w-4 h-4" />
                      {isAr ? 'إضافة عميل' : 'Ajouter un client'}
                    </Btn>
                  : undefined
              }
            />
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {clients.map(client => (
                <div
                  key={client.client_id}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-[#F8F7F4] transition-all cursor-pointer"
                  onClick={() => setSelected(client)}
                >
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm"
                       style={{ backgroundColor: `${primary}18`, color: primary }}>
                    {client.nom.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#1A1A1A] truncate">{client.nom}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-[#B0ADA6] flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {client.telephone}
                      </span>
                      {client.date_premier_achat && (
                        <span className="text-xs text-[#B0ADA6]">
                          {isAr ? 'منذ' : 'depuis'} {formatDate(client.date_premier_achat)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Financials */}
                  <div className="text-right flex-shrink-0 hidden sm:block">
                    {(client.total_ca ?? 0) > 0 && (
                      <p className="text-sm font-bold" style={{ color: primary }}>
                        {formatMAD(client.total_ca ?? 0)}
                      </p>
                    )}
                    {(client.solde_impaye ?? 0) > 0 && (
                      <p className="text-xs text-amber-600 font-medium">
                        {isAr ? 'متبقي' : 'Reste'}: {formatMAD(client.solde_impaye ?? 0)}
                      </p>
                    )}
                  </div>

                  <ChevronRight className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Client detail modal ──────────────────────────── */}
      {selected && (
        <Modal
          open={!!selected}
          onClose={() => setSelected(null)}
          title={selected.nom}
          size="md"
        >
          <div className="space-y-5" dir={isAr ? 'rtl' : 'ltr'}>

            {/* KPIs */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: isAr ? 'رقم الأعمال' : 'CA total',          value: formatMAD(selected.total_ca ?? 0), icon: TrendingUp, color: primary },
                { label: isAr ? 'عدد المشتريات' : 'Achats',           value: '—',                              icon: ShoppingCart, color: '#10B981' },
                { label: isAr ? 'الإصلاحات' : 'Réparations',          value: String(selected.total_reparations ?? 0), icon: Wrench, color: '#F59E0B' },
              ].map(k => {
                const Icon = k.icon
                return (
                  <div key={k.label} className="bg-[#F8F7F4] rounded-xl p-3 text-center">
                    <Icon className="w-4 h-4 mx-auto mb-1" style={{ color: k.color }} />
                    <p className="font-bold text-sm text-[#1A1A1A]">{k.value}</p>
                    <p className="text-xs text-[#B0ADA6] mt-0.5">{k.label}</p>
                  </div>
                )
              })}
            </div>

            {/* Contact details */}
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-[#F8F7F4] rounded-xl">
                <Phone className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                <div>
                  <p className="text-xs text-[#B0ADA6]">{isAr ? 'الهاتف الرئيسي' : 'Téléphone'}</p>
                  <p className="text-sm font-medium text-[#1A1A1A]">{selected.telephone}</p>
                </div>
                <a href={`tel:${selected.telephone}`}
                  className="ml-auto text-xs font-bold py-1 px-3 rounded-lg"
                  style={{ backgroundColor: `${primary}15`, color: primary }}>
                  {isAr ? 'اتصال' : 'Appeler'}
                </a>
              </div>

              {selected.telephone_2 && (
                <div className="flex items-center gap-3 p-3 bg-[#F8F7F4] rounded-xl">
                  <Phone className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                  <div>
                    <p className="text-xs text-[#B0ADA6]">{isAr ? 'هاتف ثانوي' : 'Tél. secondaire'}</p>
                    <p className="text-sm font-medium text-[#1A1A1A]">{selected.telephone_2}</p>
                  </div>
                </div>
              )}

              {selected.email && (
                <div className="flex items-center gap-3 p-3 bg-[#F8F7F4] rounded-xl">
                  <Mail className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                  <div>
                    <p className="text-xs text-[#B0ADA6]">Email</p>
                    <p className="text-sm font-medium text-[#1A1A1A]">{selected.email}</p>
                  </div>
                </div>
              )}

              {selected.adresse && (
                <div className="flex items-center gap-3 p-3 bg-[#F8F7F4] rounded-xl">
                  <MapPin className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                  <div>
                    <p className="text-xs text-[#B0ADA6]">{isAr ? 'العنوان' : 'Adresse'}</p>
                    <p className="text-sm font-medium text-[#1A1A1A]">{selected.adresse}</p>
                  </div>
                </div>
              )}

              {selected.notes && (
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
                  <p className="text-xs text-amber-700 font-bold mb-1">{isAr ? 'ملاحظات' : 'Notes'}</p>
                  <p className="text-sm text-amber-800">{selected.notes}</p>
                </div>
              )}
            </div>

            {/* Open credit warning */}
            {(selected.solde_impaye ?? 0) > 0 && (
              <div className="flex items-center justify-between p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <div>
                  <p className="text-sm font-bold text-amber-800">
                    {isAr ? 'تسبيق مفتوح' : 'Avance en cours'}
                  </p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    {isAr ? 'لم يتم تسديد كامل المبلغ' : 'Solde impayé'}
                  </p>
                </div>
                <p className="font-display font-bold text-xl text-amber-700">
                  {formatMAD(selected.solde_impaye ?? 0)}
                </p>
              </div>
            )}

            {/* WhatsApp */}
            {(() => {
              const phone = selected.telephone.replace(/^0/, '')
              const waUrl = `https://wa.me/212${phone}`
              return (
                <a href={waUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-all">
                  <MessageCircle className="w-4 h-4" />
                  {isAr ? 'تواصل عبر واتساب' : 'Contacter via WhatsApp'}
                </a>
              )
            })()}

            {/* Actions */}
            <div className="flex gap-3 pt-2 border-t border-[#E8E5DE]">
              <Btn variant="secondary" className="flex-1" onClick={() => setSelected(null)}>
                {isAr ? 'إغلاق' : 'Fermer'}
              </Btn>
              <Btn
                variant="primary"
                className="flex-1"
                onClick={() => openEdit(selected)}
                style={{ backgroundColor: primary } as React.CSSProperties}
              >
                <Edit2 className="w-4 h-4" />
                {isAr ? 'تعديل' : 'Modifier'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Add / Edit modal ─────────────────────────────── */}
      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setForm({ ...EMPTY_FORM }); setEditClient(null) }}
        title={editClient
          ? (isAr ? 'تعديل العميل' : 'Modifier le client')
          : (isAr ? 'عميل جديد' : 'Nouveau client')}
        size="sm"
      >
        <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
          <Field label={isAr ? 'الاسم الكامل' : 'Nom complet'} required>
            <input type="text" className={inputClass}
              placeholder={isAr ? 'محمد أحمد...' : 'Prénom Nom...'}
              value={form.nom} onChange={e => setF('nom', e.target.value)} autoFocus />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={isAr ? 'الهاتف' : 'Téléphone'} required>
              <input type="tel" className={inputClass}
                placeholder="06XXXXXXXX"
                value={form.telephone} onChange={e => setF('telephone', e.target.value)} />
            </Field>
            <Field label={isAr ? 'هاتف ثانوي' : 'Tél. secondaire'}>
              <input type="tel" className={inputClass}
                placeholder="06XXXXXXXX"
                value={form.telephone_2} onChange={e => setF('telephone_2', e.target.value)} />
            </Field>
          </div>

          <Field label="Email">
            <input type="email" className={inputClass}
              placeholder="exemple@gmail.com"
              value={form.email} onChange={e => setF('email', e.target.value)} />
          </Field>

          <Field label={isAr ? 'العنوان' : 'Adresse'}>
            <input type="text" className={inputClass}
              placeholder={isAr ? 'مكناس، شارع...' : 'Meknès, rue...'}
              value={form.adresse} onChange={e => setF('adresse', e.target.value)} />
          </Field>

          <Field label={isAr ? 'ملاحظات' : 'Notes'}>
            <textarea className={`${inputClass} resize-none text-sm`} rows={2}
              value={form.notes} onChange={e => setF('notes', e.target.value)}
              placeholder={isAr ? 'ملاحظة...' : 'Note...'} />
          </Field>

          <div className="flex gap-3 justify-end pt-2">
            <Btn variant="secondary"
              onClick={() => { setFormOpen(false); setForm({ ...EMPTY_FORM }); setEditClient(null) }}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn variant="primary" onClick={handleSubmit} loading={submitting}
              style={{ backgroundColor: primary } as React.CSSProperties}>
              {editClient
                ? (isAr ? 'حفظ التعديلات' : 'Enregistrer')
                : (isAr ? 'إضافة' : 'Ajouter')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}