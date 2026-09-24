'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Wrench, Mail, Phone, MessageCircle, ClipboardPlus, ExternalLink, Ban, Clock, Monitor, Headphones } from 'lucide-react'
import { useApi, apiWrite } from '@/lib/data/api'
import { PageHeader, EmptyState, SkeletonRow, selectClass, Btn, Modal, Field, inputClass } from '@/components/shared'
import { showError, showSuccess } from '@/lib/utils/toasts'
import { codeLabel, type Code } from '@/lib/codes'
import { useSiteLang, Tabs, Chip, REPAIR_STATUS, whatsappLink, dateTime } from './common'

type WebKind = 'HARDWARE' | 'SOFTWARE' | 'CONSULTATION'

interface Repair {
  id: string; kind: WebKind; customerName: string; customerPhone: string; deviceBrand: string; deviceModel: string
  problemAreas: string[]; notes: string | null; preferredSlot: string | null; cancelReason: string | null
  status: string; createdAt: string
  ticket: { rep_id: string; statut: string } | null
}
interface Message { id: string; name: string; phone: string | null; email: string | null; message: string; createdAt: string }

const KIND: Record<WebKind, { code: Code<'repair_kind'>; icon: React.ComponentType<{ className?: string }> }> = {
  HARDWARE:     { code: 'materiel',     icon: Wrench },
  SOFTWARE:     { code: 'logiciel',     icon: Monitor },
  CONSULTATION: { code: 'consultation', icon: Headphones },
}

type Tab = 'repairs' | 'cancelled' | 'messages'

export default function SiteRequestsModule() {
  const { L, isAr, isManager } = useSiteLang()
  const lang = isAr ? 'ar' : 'fr'
  const [tab, setTab] = useState<Tab>('repairs')
  const q = useApi<{ repairs: Repair[]; messages: Message[] }>('/api/site/requests')
  const all       = q.data?.repairs ?? []
  const repairs   = all.filter(r => r.status !== 'CANCELLED')
  const cancelled = all.filter(r => r.status === 'CANCELLED')
  const messages  = q.data?.messages ?? []

  const [converting, setConverting] = useState<string | null>(null)
  const [cancelFor, setCancelFor]   = useState<Repair | null>(null)
  const [reason, setReason]         = useState('')
  const [cancelling, setCancelling] = useState(false)

  const problemLabel = (p: string) => codeLabel('repair_problem', p as Code<'repair_problem'>, lang)

  async function convert(r: Repair) {
    const device = `${r.deviceBrand} ${r.deviceModel}`.trim()
    const question = r.kind === 'CONSULTATION'
      ? L(`Créer la fiche de consultation pour ${r.customerName} ?`, `إنشاء بطاقة استشارة لـ ${r.customerName}؟`)
      : L(`Le client a déposé l'appareil ? Créer la fiche de réparation pour ${r.customerName}${device ? ` (${device})` : ''} ?`,
          `هل سلم العميل الجهاز؟ إنشاء بطاقة إصلاح لـ ${r.customerName}؟`)
    if (!window.confirm(question)) return
    setConverting(r.id)
    try {
      const res = await apiWrite<{ rep_id: string; existing?: boolean }>(`/api/site/requests/${r.id}/convert`, { method: 'POST' })
      showSuccess(res.existing
        ? L(`Fiche déjà créée : ${res.rep_id}`, `البطاقة موجودة : ${res.rep_id}`)
        : L(`Fiche ${res.rep_id} créée — à compléter dans Réparations`, `تم إنشاء البطاقة ${res.rep_id}`))
    } catch (e) {
      showError((e as Error).message)
    } finally {
      setConverting(null)
    }
  }

  async function setStatus(r: Repair, status: string) {
    try { await apiWrite('/api/site/requests', { method: 'PATCH', body: { id: r.id, status } }) } catch (e) { showError((e as Error).message) }
  }

  async function confirmCancel() {
    if (!cancelFor) return
    setCancelling(true)
    try {
      await apiWrite('/api/site/requests', { method: 'PATCH', body: { id: cancelFor.id, status: 'CANCELLED', reason } })
      showSuccess(L('Demande annulée', 'تم إلغاء الطلب'))
      setCancelFor(null); setReason('')
    } catch (e) {
      showError((e as Error).message)
    } finally {
      setCancelling(false)
    }
  }

  function Card({ r }: { r: Repair }) {
    const kind = KIND[r.kind] ?? KIND.HARDWARE
    const KindIcon = kind.icon
    const device = `${r.deviceBrand} ${r.deviceModel}`.trim()
    return (
      <div className="bg-white border border-ez-border rounded-2xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ez-subtle">{dateTime(r.createdAt)}</span>
          <Chip tone={REPAIR_STATUS[r.status].tone}>{isAr ? REPAIR_STATUS[r.status].ar : REPAIR_STATUS[r.status].fr}</Chip>
        </div>
        <p className="inline-flex items-center gap-1 text-[11px] font-bold text-ez-subtle uppercase tracking-wide">
          <KindIcon className="w-3.5 h-3.5" />{codeLabel('repair_kind', kind.code, lang)}
        </p>
        <p className="font-bold text-ez-text">{r.customerName}</p>
        <p className="text-sm">
          {device && <>{device} — </>}{r.problemAreas.map(problemLabel).join(', ')}
        </p>
        {r.preferredSlot && (
          <p className="text-xs text-ez-text inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{L('Créneau souhaité', 'الوقت المفضل')} : {r.preferredSlot}</p>
        )}
        {r.notes && <p className="text-xs text-ez-subtle italic">« {r.notes} »</p>}
        {r.cancelReason && <p className="text-xs text-red-600">{L('Motif', 'السبب')} : {r.cancelReason}</p>}
        <div className="flex items-center gap-3 text-sm">
          <a href={`tel:${r.customerPhone}`} className="inline-flex items-center gap-1 font-mono"><Phone className="w-3.5 h-3.5" />{r.customerPhone}</a>
          <a href={whatsappLink(r.customerPhone)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700"><MessageCircle className="w-3.5 h-3.5" />WhatsApp</a>
        </div>
        {r.status !== 'CANCELLED' && (
          <>
            <select value={r.status} onChange={e => setStatus(r, e.target.value)} className={selectClass}>
              {Object.entries(REPAIR_STATUS).filter(([k]) => k !== 'CANCELLED').map(([k, v]) => (
                <option key={k} value={k}>{isAr ? v.ar : v.fr}</option>
              ))}
            </select>
            {r.ticket ? (
              <Link href="/ez/repairs" className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
                <span>{L('Fiche', 'بطاقة')} <b className="font-mono">{r.ticket.rep_id}</b></span>
                <span className="inline-flex items-center gap-1 text-xs">{L('Ouvrir Réparations', 'فتح الإصلاحات')}<ExternalLink className="w-3 h-3" /></span>
              </Link>
            ) : (
              <Btn variant="secondary" className="w-full" loading={converting === r.id} onClick={() => convert(r)}>
                <ClipboardPlus className="w-4 h-4" />
                {r.kind === 'CONSULTATION' ? L('Créer la consultation', 'إنشاء الاستشارة') : L('Créer la réparation', 'إنشاء الإصلاح')}
              </Btn>
            )}
            {isManager && !r.ticket && (
              <button onClick={() => setCancelFor(r)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg">
                <Ban className="w-3.5 h-3.5" />{L('Annuler la demande', 'إلغاء الطلب')}
              </button>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader title={L('Demandes du site', 'طلبات الموقع')} subtitle={L('Réparations, logiciel, consultations et messages envoyés depuis le site', 'طلبات الإصلاح والبرمجيات والاستشارات والرسائل من الموقع')} />
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { key: 'repairs',   label: L('Demandes', 'الطلبات'), count: repairs.filter(r => r.status === 'NEW').length },
          { key: 'cancelled', label: L('Annulées', 'ملغاة'), count: cancelled.length },
          { key: 'messages',  label: L('Messages', 'الرسائل'), count: messages.length },
        ]} />
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {q.isLoading ? <SkeletonRow /> : q.error ? (
          <EmptyState icon={<Wrench className="w-6 h-6" />} title={L('Site web indisponible', 'الموقع غير متاح')} description={q.error.message} />
        ) : tab !== 'messages' ? (
          (tab === 'repairs' ? repairs : cancelled).length === 0
            ? <EmptyState icon={<Wrench className="w-6 h-6" />} title={L('Aucune demande', 'لا توجد طلبات')} />
            : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(tab === 'repairs' ? repairs : cancelled).map(r => <Card key={r.id} r={r} />)}
              </div>
            )
        ) : messages.length === 0 ? <EmptyState icon={<Mail className="w-6 h-6" />} title={L('Aucun message', 'لا توجد رسائل')} /> : (
          <div className="bg-white border border-ez-border rounded-2xl divide-y divide-ez-border">
            {messages.map(m => (
              <div key={m.id} className="p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-ez-text">{m.name}</p>
                  <span className="text-xs text-ez-subtle">{dateTime(m.createdAt)}</span>
                </div>
                <p className="text-sm text-ez-text whitespace-pre-line">{m.message}</p>
                <div className="flex gap-3 text-xs">
                  {m.phone && <a href={whatsappLink(m.phone)} target="_blank" rel="noopener noreferrer" className="text-emerald-700">{m.phone}</a>}
                  {m.email && <a href={`mailto:${m.email}`} className="text-blue-700">{m.email}</a>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={!!cancelFor} onClose={() => { setCancelFor(null); setReason('') }} title={L('Annuler la demande', 'إلغاء الطلب')} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-ez-subtle">{L("La demande passe dans l'onglet « Annulées », avec le motif.", 'ينتقل الطلب إلى تبويب «ملغاة» مع السبب.')}</p>
          <Field label={L("Motif de l'annulation", 'سبب الإلغاء')} required>
            <textarea className={`${inputClass} resize-none`} rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)}
              placeholder={L('Ex. : faux numéro, doublon, client injoignable…', 'مثال: رقم خاطئ، طلب مكرر…')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => { setCancelFor(null); setReason('') }}>{L('Retour', 'رجوع')}</Btn>
            <Btn variant="danger" loading={cancelling} disabled={reason.trim().length < 5} onClick={confirmCancel}>
              <Ban className="w-4 h-4" />{L("Confirmer l'annulation", 'تأكيد الإلغاء')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
