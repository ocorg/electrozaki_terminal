'use client'
import { useState, useEffect } from 'react'
import { Modal, Btn } from '@/components/shared'
import { useLanguageStore } from '@/lib/stores/language'
import { useUser } from '@/lib/hooks/useUser'
import { t } from '@/lib/i18n/t'
import { formatMAD } from '@/lib/utils'
import { apiWrite } from '@/lib/data/api'
import { Loader2, RotateCcw, Search, X, ShieldCheck, ShieldOff, Wallet, Ticket } from 'lucide-react'
import { showSuccess, showError } from '@/lib/utils/toasts'
import { codeLabel, type Code } from '@/lib/codes'

// Retour de vente (POS). A return never cancels the sale: it is a refund
// dated today (cash, transfer or store credit), for all or part of a sale,
// and says where the item goes. See src/app/api/retours.

interface Sale {
  txn_id:          string
  date_vente:      string
  device_type:     'telephone' | 'laptop' | 'accessoire'
  device_id:       string
  device_label:    string
  client:          { nom: string; telephone: string | null } | null
  qty:             number
  prix_vente:      number
  payment_method:  string
  warranty_expiry: string | null
  returned_qty:    number
  refunded:        number
  unpaid:          boolean
}

interface Avoir {
  retour_id:   string
  date:        string
  montant:     number
  avoir_solde: number
  txn_id:      string
  item:        string
  client:      { nom: string; telephone: string | null } | null
}

/** A store credit handed to the POS cart. */
export interface AppliedAvoir { retour_id: string; solde: number; label: string }

type Mode = 'especes' | 'virement' | 'avoir'
type Destination = 'stock' | 'reparation' | 'defectueux'
type Tab = 'sale' | 'avoirs'

interface RetourModalProps {
  open:         boolean
  onClose:      () => void
  storeId:      string
  primary:      string
  onRetourDone: () => void
  /** Use a store credit in the sale being prepared */
  onAvoir:      (avoir: AppliedAvoir) => void
}

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' })
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000)

export default function RetourModal({ open, onClose, storeId, primary, onRetourDone, onAvoir }: RetourModalProps) {
  const { language } = useLanguageStore()
  const isAr   = language === 'ar'
  const lang   = isAr ? 'ar' : 'fr'
  const L      = (fr: string, ar: string) => (isAr ? ar : fr)
  const { user } = useUser()
  const isManager = user?.role === 'gerant' || user?.role === 'proprietaire'

  const [tab,        setTab]        = useState<Tab>('sale')
  const [q,          setQ]          = useState('')
  const [from,       setFrom]       = useState('')
  const [to,         setTo]         = useState('')
  const [sales,      setSales]      = useState<Sale[]>([])
  const [avoirs,     setAvoirs]     = useState<Avoir[]>([])
  const [loading,    setLoading]    = useState(false)
  const [selected,   setSelected]   = useState<Sale | null>(null)
  const [qty,        setQty]        = useState(1)
  const [montant,    setMontant]    = useState(0)
  const [mode,       setMode]       = useState<Mode>('especes')
  const [dest,       setDest]       = useState<Destination>('stock')
  const [reason,     setReason]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [payout,     setPayout]     = useState<Avoir | null>(null)
  const [payoutAmt,  setPayoutAmt]  = useState(0)
  const [payoutMode, setPayoutMode] = useState<'especes' | 'virement'>('especes')

  // Reset when closed
  useEffect(() => {
    if (open) return
    setTab('sale'); setQ(''); setFrom(''); setTo(''); setSelected(null); setReason(''); setPayout(null)
  }, [open])

  // Search the whole history (debounced)
  useEffect(() => {
    if (!open) return
    const params = new URLSearchParams({ store_id: storeId })
    if (q.trim()) params.set('q', q.trim())
    if (tab === 'sale') {
      if (from) params.set('from', from)
      if (to)   params.set('to', to)
    }
    const url = tab === 'sale' ? `/api/retours?${params}` : `/api/retours/avoirs?${params}`
    setLoading(true)
    const timer = setTimeout(() => {
      fetch(url)
        .then(r => r.json())
        .then(j => { if (j.error) throw new Error(j.error); if (tab === 'sale') setSales(j.data ?? []); else setAvoirs(j.data ?? []) })
        .catch(e => showError(e.message))
        .finally(() => setLoading(false))
    }, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [open, storeId, q, from, to, tab])

  const leftQty   = (s: Sale) => s.qty - s.returned_qty
  const leftMoney = (s: Sale) => Math.round((s.prix_vente - s.refunded) * 100) / 100
  const unitPrice = (s: Sale) => s.prix_vente / Math.max(1, s.qty)

  function select(s: Sale) {
    setSelected(s)
    setQty(1)
    setMontant(Math.min(leftMoney(s), Math.round(unitPrice(s))))
    setMode('especes')
    setDest('stock')
  }

  function changeQty(n: number) {
    if (!selected) return
    const v = Math.max(1, Math.min(leftQty(selected), n))
    setQty(v)
    setMontant(Math.min(leftMoney(selected), Math.round(unitPrice(selected) * v)))
  }

  function warranty(s: Sale) {
    if (!s.warranty_expiry) return null
    const end  = new Date(s.warranty_expiry)
    const diff = daysBetween(new Date(), end)
    return diff >= 0
      ? { ok: true,  text: L(`Sous garantie jusqu'au ${day(s.warranty_expiry)}`, `تحت الضمان حتى ${day(s.warranty_expiry)}`) }
      : { ok: false, text: L(`Garantie expirée depuis ${-diff} jour(s) (${day(s.warranty_expiry)})`, `انتهى الضمان منذ ${-diff} يوم`) }
  }

  const destinations: Destination[] = selected?.device_type === 'accessoire'
    ? ['stock', 'defectueux']
    : selected?.device_type === 'laptop' ? ['stock', 'reparation'] : ['stock', 'reparation', 'defectueux']

  async function confirmReturn() {
    if (!selected) return
    if (reason.trim().length < 3) { showError(L('Motif du retour obligatoire', 'سبب الإرجاع مطلوب')); return }
    setSubmitting(true)
    try {
      const { data: res } = await apiWrite<{ data: { retour_id: string } }>('/api/retours', {
        method: 'POST',
        body:   { txn_id: selected.txn_id, qty, montant, mode, destination: dest, motif: reason.trim() },
      })
      if (mode === 'avoir') {
        onAvoir({ retour_id: res.retour_id, solde: montant, label: selected.device_label })
        showSuccess(L(`Avoir ${res.retour_id} de ${formatMAD(montant)} ajouté à la vente en cours`, `تمت إضافة الرصيد ${res.retour_id}`))
      } else {
        showSuccess(L(`Retour ${res.retour_id} enregistré — ${formatMAD(montant)} remboursés`, `تم تسجيل الإرجاع ${res.retour_id}`))
        onRetourDone()
      }
      onClose()
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmPayout() {
    if (!payout) return
    setSubmitting(true)
    try {
      await apiWrite('/api/retours/avoirs', { method: 'POST', body: { avoir_id: payout.retour_id, montant: payoutAmt, mode: payoutMode } })
      showSuccess(L(`${formatMAD(payoutAmt)} remboursés sur l'avoir ${payout.retour_id}`, 'تم الاسترداد'))
      setAvoirs(prev => prev.map(a => a.retour_id === payout.retour_id ? { ...a, avoir_solde: a.avoir_solde - payoutAmt } : a).filter(a => a.avoir_solde > 0))
      setPayout(null)
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const choice = (on: boolean) => ({
    backgroundColor: on ? primary : 'white',
    borderColor:     on ? primary : '#E8E5DE',
    color:           on ? 'white' : '#6B6860',
  })

  return (
    <Modal open={open} onClose={onClose} title={L('Retours et avoirs', 'المرتجعات والأرصدة')} size="lg">
      <div className="space-y-4">

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl w-fit">
          {([['sale', L("Retour d'une vente", 'إرجاع بيع'), RotateCcw], ['avoirs', L('Avoirs', 'الأرصدة'), Ticket]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => { setTab(key); setQ(''); setSelected(null); setPayout(null) }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${tab === key ? 'bg-white shadow-sm text-[#1A1A1A]' : 'text-[#6B6860]'}`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder={tab === 'sale'
                ? L('Client, téléphone, article, IMEI ou n° de vente (TXN-…)', 'العميل، الهاتف، المنتج، IMEI أو رقم البيع')
                : L('Client, téléphone ou n° d’avoir (RET-…)', 'العميل، الهاتف أو رقم الرصيد')}
              className="w-full pl-9 pr-9 py-2.5 bg-white border border-[#E8E5DE] rounded-xl text-sm placeholder:text-[#B0ADA6] focus:outline-none focus:border-[#C9A440]" />
            {q && (
              <button type="button" onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B0ADA6] hover:text-[#1A1A1A]">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {tab === 'sale' && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B6860]">
              <span>{L('Vendu entre le', 'بيع بين')}</span>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border border-[#E8E5DE] rounded-lg px-2 py-1" />
              <span>{L('et le', 'و')}</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border border-[#E8E5DE] rounded-lg px-2 py-1" />
              {(from || to) && <button type="button" onClick={() => { setFrom(''); setTo('') }} className="text-red-500">{L('Effacer', 'مسح')}</button>}
            </div>
          )}
        </div>

        {/* Results */}
        <div className="max-h-64 overflow-y-auto border border-[#E8E5DE] rounded-xl divide-y divide-[#F2F0EB]">
          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 text-[#B0ADA6] animate-spin" /></div>
          ) : tab === 'sale' ? (
            sales.length === 0 ? (
              <p className="text-center text-sm text-[#B0ADA6] py-10">{q || from || to ? L('Aucune vente trouvée', 'لا توجد نتائج') : L('Aucune vente', 'لا توجد مبيعات')}</p>
            ) : sales.map(s => {
              const done = leftQty(s) <= 0
              const w    = warranty(s)
              const on   = selected?.txn_id === s.txn_id
              return (
                <button key={s.txn_id} type="button" disabled={done || s.unpaid} onClick={() => select(s)}
                  className="w-full flex items-start gap-4 px-4 py-3 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: on ? `${primary}12` : 'white', borderLeft: on ? `3px solid ${primary}` : '3px solid transparent' }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#1A1A1A] truncate">{s.qty > 1 ? `${s.qty} × ` : ''}{s.device_label}</p>
                    <p className="text-xs text-[#6B6860]">
                      <span className="font-mono">{s.txn_id}</span> · {s.client?.nom ?? L('Comptoir', 'عميل عابر')}{s.client?.telephone ? ` · ${s.client.telephone}` : ''}
                    </p>
                    <p className="text-xs text-[#B0ADA6] flex flex-wrap items-center gap-x-2">
                      <span>{day(s.date_vente)} · {codeLabel('payment_method', s.payment_method as Code<'payment_method'>, lang)}</span>
                      {w && <span className={w.ok ? 'text-emerald-600' : 'text-red-500'}>{w.ok ? '✓ ' : ''}{w.text}</span>}
                    </p>
                    {done && <p className="text-xs font-bold text-red-500">{L('Déjà entièrement retourné', 'تم إرجاعه بالكامل')}</p>}
                    {!done && s.returned_qty > 0 && <p className="text-xs font-bold text-amber-600">{L(`${s.returned_qty} déjà retourné(s)`, `${s.returned_qty} تم إرجاعها`)}</p>}
                    {s.unpaid && <p className="text-xs font-bold text-amber-600">{L('Crédit / avance non soldée : retour avec le propriétaire', 'بيع بالدين: الإرجاع مع المالك')}</p>}
                  </div>
                  <p className="text-sm font-bold flex-shrink-0" style={{ color: primary }}>{formatMAD(s.prix_vente)}</p>
                </button>
              )
            })
          ) : (
            avoirs.length === 0 ? (
              <p className="text-center text-sm text-[#B0ADA6] py-10">{L('Aucun avoir disponible', 'لا توجد أرصدة')}</p>
            ) : avoirs.map(a => (
              <div key={a.retour_id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#1A1A1A]"><span className="font-mono">{a.retour_id}</span> · {a.client?.nom ?? L('Client comptoir', 'عميل عابر')}</p>
                  <p className="text-xs text-[#6B6860] truncate">{L('Retour de', 'إرجاع')} {a.item} · {day(a.date)}</p>
                  <p className="text-xs text-[#B0ADA6]">{L('Solde', 'الرصيد')} <b className="text-emerald-700">{formatMAD(a.avoir_solde)}</b> / {formatMAD(a.montant)}</p>
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <Btn size="sm" onClick={() => { onAvoir({ retour_id: a.retour_id, solde: a.avoir_solde, label: a.item }); onClose() }}
                    style={{ backgroundColor: primary } as React.CSSProperties}>
                    <Wallet className="w-3.5 h-3.5" />{L('Utiliser', 'استعمال')}
                  </Btn>
                  {isManager && (
                    <button type="button" onClick={() => { setPayout(a); setPayoutAmt(a.avoir_solde); setPayoutMode('especes') }}
                      className="text-[11px] font-bold text-[#6B6860] hover:text-red-600">
                      {L('Rembourser le solde', 'استرداد الرصيد')}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Return form ── */}
        {tab === 'sale' && selected && (
          <div className="bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{selected.device_label}</p>
                <p className="text-xs text-[#6B6860]"><span className="font-mono">{selected.txn_id}</span> · {selected.client?.nom ?? '—'} · {day(selected.date_vente)}</p>
              </div>
              {(() => {
                const w = warranty(selected)
                if (!w) return null
                const Icon = w.ok ? ShieldCheck : ShieldOff
                return (
                  <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border flex-shrink-0 ${w.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
                    <Icon className="w-3.5 h-3.5" />{w.ok ? L('Sous garantie', 'تحت الضمان') : L('Garantie expirée', 'انتهى الضمان')}
                  </span>
                )
              })()}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {leftQty(selected) > 1 ? (
                <div>
                  <label className="text-xs font-bold text-[#6B6860] block mb-1">{L(`Quantité rendue (sur ${leftQty(selected)})`, 'الكمية المرجعة')}</label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => changeQty(qty - 1)} className="w-8 h-8 rounded-lg border border-[#E8E5DE] bg-white font-bold">−</button>
                    <span className="w-8 text-center font-bold">{qty}</span>
                    <button type="button" onClick={() => changeQty(qty + 1)} className="w-8 h-8 rounded-lg border border-[#E8E5DE] bg-white font-bold">+</button>
                  </div>
                </div>
              ) : <div />}
              <div>
                <label className="text-xs font-bold text-[#6B6860] block mb-1">{L(`Montant (max ${formatMAD(leftMoney(selected))})`, 'المبلغ')}</label>
                <input type="number" min={0} max={leftMoney(selected)} value={montant}
                  onChange={e => setMontant(Math.max(0, Math.min(leftMoney(selected), Number(e.target.value) || 0)))}
                  className="w-full border border-[#E8E5DE] rounded-xl px-3 py-2 text-sm bg-white focus:outline-none" />
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-[#6B6860] mb-1">{L('Rendre au client', 'الإرجاع للعميل')}</p>
              <div className="grid grid-cols-3 gap-2">
                {(['especes', 'virement', 'avoir'] as Mode[]).map(m => (
                  <button key={m} type="button" onClick={() => setMode(m)} style={choice(mode === m)}
                    className="py-2 rounded-xl text-xs font-bold border transition-all">
                    {m === 'avoir' ? L('Avoir (échange)', 'رصيد (استبدال)') : codeLabel('retour_mode', m, lang)}
                  </button>
                ))}
              </div>
              {mode === 'avoir' && (
                <p className="text-[11px] text-[#6B6860] mt-1">
                  {L("Aucun argent ne sort : l'avoir est ajouté à la vente en cours, le client paie la différence. Un solde restant reste utilisable plus tard.",
                    'لا يخرج أي مال: يضاف الرصيد إلى البيع الحالي')}
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-bold text-[#6B6860] mb-1">{L("L'article va", 'وجهة المنتج')}</p>
              <div className="grid grid-cols-3 gap-2">
                {destinations.map(d => (
                  <button key={d} type="button" onClick={() => setDest(d)} style={choice(dest === d)}
                    className="py-2 rounded-xl text-xs font-bold border transition-all">
                    {codeLabel('retour_destination', d, lang)}
                  </button>
                ))}
              </div>
              {dest === 'defectueux' && (
                <p className="text-[11px] text-[#6B6860] mt-1">
                  {selected.device_type === 'accessoire'
                    ? L("Non remis en stock (perte).", 'لا يعاد إلى المخزون')
                    : L('Remis en stock avec la mention « endommagé » (hors site web).', 'يعاد مع علامة معطوب')}
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-bold text-[#6B6860] block mb-1">{L('Motif du retour *', 'سبب الإرجاع *')}</label>
              <input value={reason} onChange={e => setReason(e.target.value)}
                placeholder={L('Ex : défaut écran, ne correspond pas, changement de modèle…', 'مثال: عيب في الشاشة...')}
                className="w-full border border-[#E8E5DE] rounded-xl px-3 py-2 text-sm bg-white focus:outline-none" />
            </div>
          </div>
        )}

        {/* ── Pay back what is left on a store credit ── */}
        {tab === 'avoirs' && payout && (
          <div className="bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl p-4 space-y-3">
            <p className="text-sm font-bold">{L(`Rembourser l'avoir ${payout.retour_id}`, `استرداد الرصيد ${payout.retour_id}`)}</p>
            <div className="grid grid-cols-2 gap-3">
              <input type="number" min={1} max={payout.avoir_solde} value={payoutAmt}
                onChange={e => setPayoutAmt(Math.max(0, Math.min(payout.avoir_solde, Number(e.target.value) || 0)))}
                className="border border-[#E8E5DE] rounded-xl px-3 py-2 text-sm bg-white" />
              <div className="grid grid-cols-2 gap-2">
                {(['especes', 'virement'] as const).map(m => (
                  <button key={m} type="button" onClick={() => setPayoutMode(m)} style={choice(payoutMode === m)}
                    className="py-2 rounded-xl text-xs font-bold border">{codeLabel('retour_mode', m, lang)}</button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Btn variant="secondary" size="sm" onClick={() => setPayout(null)}>{t(isAr, 'common.cancel')}</Btn>
              <Btn size="sm" variant="danger" loading={submitting} disabled={payoutAmt <= 0} onClick={confirmPayout}>
                {L(`Rembourser ${formatMAD(payoutAmt)}`, 'استرداد')}
              </Btn>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end">
          {tab === 'sale' && !isManager && (
            <p className="text-xs text-amber-700 mr-auto">{L('Seul un gérant ou le propriétaire peut valider un retour.', 'فقط المدير يمكنه تأكيد الإرجاع')}</p>
          )}
          <Btn variant="secondary" onClick={onClose}>{t(isAr, 'common.cancel')}</Btn>
          {tab === 'sale' && (
            <button onClick={confirmReturn}
              disabled={!selected || !isManager || reason.trim().length < 3 || submitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold transition-all hover:bg-red-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              {mode === 'avoir'
                ? L(`Créer un avoir de ${formatMAD(montant)}`, 'إنشاء رصيد')
                : L(`Rembourser ${formatMAD(montant)}`, `استرداد ${formatMAD(montant)}`)}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
