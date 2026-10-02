'use client'
// Credit sales of phones with their schedule — late ones first, WhatsApp
// reminder in one click, the full credit panel on click (owner, 2026-10-02).
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageCircle, Smartphone, X, CalendarClock } from 'lucide-react'
import { useApi } from '@/lib/data/api'
import { useUser } from '@/lib/hooks/useUser'
import { formatMAD } from '@/lib/utils'
import { EmptyState, SkeletonRow } from '@/components/shared'
import { whatsappLink } from '@/components/site/common'
import { scheduleStatus, type Echeance } from '@/lib/creditSchedule'
import { reminderMessage, type EditableCredit } from '@/components/phones/PhoneCreditEdit'
import PhoneCreditPanel from '@/components/phones/PhoneCreditPanel'

type Row = EditableCredit & { phone_id: string; phone_status: string; echeances: Echeance[] }

const frDate = (d: string) => new Date(d.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('fr-MA', { day: '2-digit', month: 'short' })

export default function PhoneCreditsTab({ storeId }: { storeId: string }) {
  const { user } = useUser()
  const q = useApi<Row[]>(`/api/phone-credits?store_id=${storeId}&with=echeances`)
  const [open, setOpen] = useState<Row | null>(null)

  const rows = useMemo(() => (q.data ?? [])
    .filter(c => c.statut !== 'annule' && !c.discharged_at)
    .map(c => ({ c, st: scheduleStatus(c.echeances ?? [], Number(c.montant_paye), Number(c.echeancier_base ?? 0)) }))
    .sort((a, b) => (b.st.daysLate - a.st.daysLate)
      || ((a.st.next?.date_echeance ?? '9999') .localeCompare(b.st.next?.date_echeance ?? '9999'))), [q.data])

  const late = rows.filter(r => r.st.lateAmount > 0 && Number(r.c.montant_restant) > 0.01)

  return (
    <div className="space-y-4">
      {late.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <b>{late.length} client{late.length > 1 ? 's' : ''} en retard</b> — total {formatMAD(late.reduce((s, r) => s + r.st.lateAmount, 0))}
        </div>
      )}
      <div className="bg-white border border-ez-border rounded-2xl overflow-hidden">
        {q.isLoading ? (
          <div className="divide-y divide-ez-muted">{[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<CalendarClock className="w-7 h-7" />} title="Aucune vente à crédit en cours" />
        ) : (
          <div className="divide-y divide-ez-muted">
            {rows.map(({ c, st }) => {
              const paidUp = Number(c.montant_restant) <= 0.01
              return (
                <div key={c.credit_id} onClick={() => setOpen(c)}
                  className="grid grid-cols-1 sm:grid-cols-[1.4fr_1.2fr_0.8fr_1.2fr_auto] gap-2 sm:gap-4 items-center px-5 py-3.5 hover:bg-ez-bg cursor-pointer transition-all">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ez-text truncate">{c.client_name}</p>
                    <p className="text-xs text-ez-faint font-mono">{c.client_tel ?? '—'} · {c.credit_id}</p>
                  </div>
                  <p className="text-sm text-ez-subtle truncate">{[c.marque, c.model].filter(Boolean).join(' ')}</p>
                  <p className={`text-sm font-bold ${paidUp ? 'text-emerald-600' : 'text-ez-text'}`}>{paidUp ? 'Soldé' : formatMAD(Number(c.montant_restant))}</p>
                  <div className="text-xs">
                    {paidUp ? <span className="text-emerald-700">À décharger</span>
                      : st.lateAmount > 0 ? <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 font-bold">Retard {formatMAD(st.lateAmount)} · {st.daysLate} j</span>
                      : st.next ? <span className="text-ez-subtle">Prochaine : <b>{frDate(st.next.date_echeance)}</b> · {formatMAD(st.next.montant - st.next.covered)}</span>
                      : <span className="text-ez-faint">Pas d'échéancier</span>}
                  </div>
                  <div className="flex justify-end" onClick={e => e.stopPropagation()}>
                    {!paidUp && c.client_tel && (st.lateAmount > 0 || st.next) && (
                      <a href={`${whatsappLink(c.client_tel)}?text=${encodeURIComponent(reminderMessage(c, st))}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all">
                        <MessageCircle className="w-3.5 h-3.5" />Rappel
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Portal: the page's fade-in animation would otherwise offset a fixed overlay */}
      {open && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Vente à crédit"
             className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(null)}>
          <div className="w-full max-w-md max-h-[90vh] flex flex-col bg-[#0F0F0F] border border-white/10 rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center"><Smartphone className="w-4 h-4 text-white/60" /></div>
                <div>
                  <p className="text-sm font-semibold text-white">{[open.marque, open.model].filter(Boolean).join(' ')}</p>
                  <p className="text-xs text-white/40 font-mono">{open.phone_id}</p>
                </div>
              </div>
              <button onClick={() => setOpen(null)} aria-label="Fermer" className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 overflow-y-auto">
              <PhoneCreditPanel phoneId={open.phone_id} phoneStatus={open.phone_status} storeId={storeId}
                userId={user?.id ?? ''} userName={user?.display_name ?? ''} onCreditCreated={() => void q.refresh()} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
