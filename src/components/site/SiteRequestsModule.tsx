'use client'
import { useState } from 'react'
import { Wrench, Mail, Phone, MessageCircle } from 'lucide-react'
import { useApi, apiWrite } from '@/lib/data/api'
import { PageHeader, EmptyState, SkeletonRow, selectClass } from '@/components/shared'
import { showError } from '@/lib/utils/toasts'
import { useSiteLang, Tabs, Chip, REPAIR_STATUS, whatsappLink, dateTime } from './common'

interface Repair {
  id: string; customerName: string; customerPhone: string; deviceBrand: string; deviceModel: string
  problemAreas: string[]; notes: string | null; status: string; createdAt: string
}
interface Message { id: string; name: string; phone: string | null; email: string | null; message: string; createdAt: string }

const AREA: Record<string, string> = {
  ecran: 'Écran', batterie: 'Batterie', camera: 'Appareil photo', connecteur: 'Port de charge', son: 'Son / Micro', reseau: 'Désimlockage',
}

type Tab = 'repairs' | 'messages'

export default function SiteRequestsModule() {
  const { L, isAr } = useSiteLang()
  const [tab, setTab] = useState<Tab>('repairs')
  const q = useApi<{ repairs: Repair[]; messages: Message[] }>('/api/site/requests')
  const repairs  = q.data?.repairs ?? []
  const messages = q.data?.messages ?? []

  async function setStatus(r: Repair, status: string) {
    try { await apiWrite('/api/site/requests', { method: 'PATCH', body: { id: r.id, status } }) } catch (e) { showError((e as Error).message) }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader title={L('Demandes du site', 'طلبات الموقع')} subtitle={L('Réparations et messages envoyés depuis le site', 'طلبات الإصلاح والرسائل من الموقع')} />
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { key: 'repairs',  label: L('Réparations', 'الإصلاحات'), count: repairs.filter(r => r.status === 'NEW').length },
          { key: 'messages', label: L('Messages', 'الرسائل'), count: messages.length },
        ]} />
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {q.isLoading ? <SkeletonRow /> : q.error ? (
          <EmptyState icon={<Wrench className="w-6 h-6" />} title={L('Site web indisponible', 'الموقع غير متاح')} description={q.error.message} />
        ) : tab === 'repairs' ? (
          repairs.length === 0 ? <EmptyState icon={<Wrench className="w-6 h-6" />} title={L('Aucune demande', 'لا توجد طلبات')} /> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {repairs.map(r => (
                <div key={r.id} className="bg-white border border-ez-border rounded-2xl p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ez-subtle">{dateTime(r.createdAt)}</span>
                    <Chip tone={REPAIR_STATUS[r.status].tone}>{isAr ? REPAIR_STATUS[r.status].ar : REPAIR_STATUS[r.status].fr}</Chip>
                  </div>
                  <p className="font-bold text-ez-text">{r.customerName}</p>
                  <p className="text-sm">{r.deviceBrand} {r.deviceModel} — {r.problemAreas.map(a => AREA[a] ?? a).join(', ')}</p>
                  {r.notes && <p className="text-xs text-ez-subtle italic">« {r.notes} »</p>}
                  <div className="flex items-center gap-3 text-sm">
                    <a href={`tel:${r.customerPhone}`} className="inline-flex items-center gap-1 font-mono"><Phone className="w-3.5 h-3.5" />{r.customerPhone}</a>
                    <a href={whatsappLink(r.customerPhone)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700"><MessageCircle className="w-3.5 h-3.5" />WhatsApp</a>
                  </div>
                  <select value={r.status} onChange={e => setStatus(r, e.target.value)} className={selectClass}>
                    {Object.entries(REPAIR_STATUS).map(([k, v]) => <option key={k} value={k}>{isAr ? v.ar : v.fr}</option>)}
                  </select>
                </div>
              ))}
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
    </div>
  )
}
