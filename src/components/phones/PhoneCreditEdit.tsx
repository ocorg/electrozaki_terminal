'use client'
// Editing a credit sale (owner's request, 2026-10-02): details and total,
// fixing a payment, cancelling, and the payment schedule with reminders.
// Same dark look as the rest of the credit panel.
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Pencil, CalendarClock, MessageCircle, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { useEscapeKey } from '@/lib/hooks/useEscapeKey'
import { whatsappLink } from '@/components/site/common'
import { scheduleStatus, monthlyPlan, type Echeance, type ScheduleStatus } from '@/lib/creditSchedule'
import { storeDate } from '@/lib/time'

export interface EditableCredit {
  credit_id:        string
  client_name:      string
  client_tel:       string | null
  client_cin:       string | null
  notes?:           string | null
  marque?:          string | null
  model?:           string | null
  montant_total:    number
  montant_paye:     number
  montant_restant:  number
  montant_cash_total: number
  statut:           'en_cours' | 'solde' | 'annule'
  discharged_at:    string | null
  has_reprise:      boolean
  reprise_marque:   string | null
  reprise_model:    string | null
  reprise_valeur:   number | null
  reprise_imei:     string | null
  reprise_etat:     string | null
  reprise_remise:   boolean
  reprise_phone_id: string | null
  echeancier_base?: number
}

export interface EditablePayment {
  payment_id:     string
  montant:        number
  payment_method: 'especes' | 'virement'
  date_paiement:  string
}

const inputCls = 'w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-gold/50 disabled:opacity-40'
const dh = (n: number) => `${Number(n).toLocaleString('fr-MA')} DH`
const frDate = (d: string) => new Date(d.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('fr-MA', { day: '2-digit', month: 'short', year: 'numeric' })

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Erreur')
  return json.data
}

function Shell({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEscapeKey(onClose, true)
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className={`w-full ${wide ? 'max-w-lg' : 'max-w-md'} max-h-[90vh] flex flex-col bg-[#111] border border-white/10 rounded-2xl overflow-hidden shadow-2xl`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            {subtitle && <p className="text-xs text-white/40 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Fermer" className="text-white/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-white/40 mb-1">{children}</p>
}

function Actions({ onClose, onConfirm, busy, disabled, label = 'Enregistrer', danger }: { onClose: () => void; onConfirm: () => void; busy: boolean; disabled?: boolean; label?: string; danger?: boolean }) {
  return (
    <div className="flex gap-2 pt-1">
      <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/5 text-sm text-white/60 hover:bg-white/10 transition-all">Retour</button>
      <button onClick={onConfirm} disabled={busy || disabled}
        className={`flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-40 ${danger ? 'bg-red-500/80 hover:bg-red-500 text-white' : 'bg-gold hover:bg-[#b8932e] text-black'}`}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}{label}
      </button>
    </div>
  )
}

// ── Edit details, total and trade-in ───────────────────────────────
export function EditCreditModal({ credit, onClose, onSaved }: { credit: EditableCredit; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    client_name: credit.client_name, client_tel: credit.client_tel ?? '', client_cin: credit.client_cin ?? '', notes: credit.notes ?? '',
    montant_total: String(credit.montant_total), has_reprise: credit.has_reprise,
    reprise_marque: credit.reprise_marque ?? '', reprise_model: credit.reprise_model ?? '', reprise_imei: credit.reprise_imei ?? '',
    reprise_valeur: credit.reprise_valeur != null ? String(credit.reprise_valeur) : '', reprise_etat: credit.reprise_etat ?? 'bon',
    motif: '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string | boolean) => setF(p => ({ ...p, [k]: v }))
  const moneyLocked   = !!credit.discharged_at
  const repriseLocked = moneyLocked || credit.reprise_remise || !!credit.reprise_phone_id

  const total   = Number(f.montant_total) || 0
  const reprise = f.has_reprise ? Number(f.reprise_valeur) || 0 : 0
  const repriseChanged = f.has_reprise !== credit.has_reprise || (f.has_reprise && (
    reprise !== Number(credit.reprise_valeur ?? 0) || f.reprise_marque !== (credit.reprise_marque ?? '') ||
    f.reprise_model !== (credit.reprise_model ?? '') || f.reprise_imei !== (credit.reprise_imei ?? '') || f.reprise_etat !== (credit.reprise_etat ?? 'bon')))
  const moneyChanged = total !== Number(credit.montant_total) || repriseChanged
  const newRest = total - reprise - Number(credit.montant_paye)

  async function save() {
    setBusy(true)
    try {
      const body: Record<string, unknown> = { client_name: f.client_name, client_tel: f.client_tel, client_cin: f.client_cin, notes: f.notes }
      if (total !== Number(credit.montant_total)) body.montant_total = total
      if (repriseChanged) Object.assign(body, {
        has_reprise: f.has_reprise, reprise_marque: f.reprise_marque, reprise_model: f.reprise_model,
        reprise_imei: f.reprise_imei, reprise_valeur: reprise, reprise_etat: f.reprise_etat,
      })
      if (moneyChanged) body.motif = f.motif
      await send(`/api/phone-credits/${credit.credit_id}`, 'PATCH', body)
      toast.success('Dossier modifié')
      onSaved(); onClose()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Shell title="Modifier le dossier" subtitle={credit.credit_id} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2"><Label>Client</Label><input className={inputCls} value={f.client_name} onChange={e => set('client_name', e.target.value)} /></div>
        <div><Label>Téléphone</Label><input className={inputCls} value={f.client_tel} onChange={e => set('client_tel', e.target.value)} placeholder="06…" /></div>
        <div><Label>CIN</Label><input className={inputCls} value={f.client_cin} onChange={e => set('client_cin', e.target.value)} /></div>
        <div className="col-span-2"><Label>Notes</Label><textarea rows={2} className={`${inputCls} resize-none`} value={f.notes} onChange={e => set('notes', e.target.value)} /></div>
      </div>

      <div className="border-t border-white/10 pt-3 space-y-2">
        <Label>Montant total convenu (DH){moneyLocked ? ' — figé : dossier déchargé' : ''}</Label>
        <input type="number" min={0} className={inputCls} value={f.montant_total} disabled={moneyLocked} onChange={e => set('montant_total', e.target.value)} />

        <label className={`flex items-center gap-2 text-sm text-white/70 ${repriseLocked ? 'opacity-40' : ''}`}>
          <input type="checkbox" checked={f.has_reprise} disabled={repriseLocked} onChange={e => set('has_reprise', e.target.checked)} />
          Reprise (téléphone donné en échange){repriseLocked && credit.has_reprise ? ' — déjà reçue, figée' : ''}
        </label>
        {f.has_reprise && (
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder="Marque" value={f.reprise_marque} disabled={repriseLocked} onChange={e => set('reprise_marque', e.target.value)} />
            <input className={inputCls} placeholder="Modèle" value={f.reprise_model} disabled={repriseLocked} onChange={e => set('reprise_model', e.target.value)} />
            <input className={inputCls} placeholder="IMEI (optionnel)" value={f.reprise_imei} disabled={repriseLocked} onChange={e => set('reprise_imei', e.target.value)} />
            <input type="number" min={0} className={inputCls} placeholder="Valeur (DH)" value={f.reprise_valeur} disabled={repriseLocked} onChange={e => set('reprise_valeur', e.target.value)} />
            <select className={inputCls} value={f.reprise_etat} disabled={repriseLocked} onChange={e => set('reprise_etat', e.target.value)}>
              <option value="bon">Bon état</option><option value="moyen">État moyen</option><option value="mauvais">Mauvais état</option>
            </select>
          </div>
        )}
      </div>

      {moneyChanged && (
        <div className="space-y-2">
          <div className={`flex justify-between rounded-xl px-4 py-2.5 text-sm ${newRest < -0.01 ? 'bg-red-500/10 text-red-300' : 'bg-white/5 text-white/70'}`}>
            <span>Nouveau reste à payer</span><b>{dh(Math.round(newRest * 100) / 100)}</b>
          </div>
          <div><Label>Motif (obligatoire)</Label><input className={inputCls} placeholder="Remise accordée, erreur de saisie…" value={f.motif} onChange={e => set('motif', e.target.value)} /></div>
        </div>
      )}
      <Actions onClose={onClose} onConfirm={save} busy={busy}
        disabled={!f.client_name.trim() || (moneyChanged && (f.motif.trim().length < 3 || newRest < -0.01 || total <= 0))} />
    </Shell>
  )
}

// ── Fix or delete one payment ──────────────────────────────────────
export function PaymentFixModal({ credit, payment, onClose, onSaved }: { credit: EditableCredit; payment: EditablePayment; onClose: () => void; onSaved: () => void }) {
  const [montant, setMontant] = useState(String(Number(payment.montant)))
  const [method, setMethod]   = useState(payment.payment_method)
  const [date, setDate]       = useState(payment.date_paiement.slice(0, 10))
  const [motif, setMotif]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await send(`/api/phone-credits/${credit.credit_id}/payments/${payment.payment_id}`, 'PATCH', { montant: Number(montant), payment_method: method, date_paiement: date, motif })
      toast.success('Versement corrigé'); onSaved(); onClose()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  async function remove() {
    setBusy(true)
    try {
      await send(`/api/phone-credits/${credit.credit_id}/payments/${payment.payment_id}?motif=${encodeURIComponent(motif)}`, 'DELETE')
      toast.success('Versement supprimé'); onSaved(); onClose()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Shell title="Corriger un versement" subtitle={`${credit.client_name} · ${dh(payment.montant)} du ${frDate(payment.date_paiement)}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Montant (DH)</Label><input type="number" min={0} className={inputCls} value={montant} onChange={e => setMontant(e.target.value)} /></div>
        <div><Label>Date</Label><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['especes', 'virement'] as const).map(m => (
          <button key={m} onClick={() => setMethod(m)}
            className={`py-2 rounded-xl border text-sm transition-all ${method === m ? 'border-gold/50 bg-gold/10 text-gold' : 'border-white/10 text-white/50 hover:bg-white/5'}`}>
            {m === 'especes' ? 'Espèces' : 'Virement'}
          </button>
        ))}
      </div>
      <div><Label>Motif (obligatoire)</Label><input className={inputCls} placeholder="Erreur de saisie…" value={motif} onChange={e => setMotif(e.target.value)} /></div>
      <p className="text-[11px] text-white/35">Impossible si la caisse du jour de ce versement est déjà clôturée.</p>
      {!confirmDelete ? (
        <>
          <Actions onClose={onClose} onConfirm={save} busy={busy} disabled={motif.trim().length < 3 || !(Number(montant) > 0)} />
          <button onClick={() => setConfirmDelete(true)} disabled={motif.trim().length < 3}
            className="w-full py-2 rounded-xl text-xs text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-30 flex items-center justify-center gap-1.5">
            <Trash2 className="w-3.5 h-3.5" />Supprimer ce versement
          </button>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-red-300 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Supprimer ce versement de {dh(payment.montant)} ?</p>
          <Actions onClose={() => setConfirmDelete(false)} onConfirm={remove} busy={busy} label="Supprimer" danger />
        </div>
      )}
    </Shell>
  )
}

// ── Cancel the whole credit (owner) ────────────────────────────────
export function CancelCreditModal({ credit, onClose, onDone }: { credit: EditableCredit; onClose: () => void; onDone: () => void }) {
  const [motif, setMotif] = useState('')
  const [busy, setBusy]   = useState(false)
  async function cancel() {
    setBusy(true)
    try {
      const data = await send(`/api/phone-credits/${credit.credit_id}/cancel`, 'POST', { motif })
      toast.success(data.phone_back_on_sale ? 'Dossier annulé — téléphone remis en vente' : 'Dossier annulé')
      onDone(); onClose()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Shell title="Annuler le dossier" subtitle={`${credit.credit_id} · ${credit.client_name}`} onClose={onClose}>
      <p className="text-sm text-white/70">Le client renonce : le téléphone redevient <b>disponible</b> et l'échéancier est supprimé.</p>
      {Number(credit.montant_paye) > 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-200">
          Le client a déjà versé <b>{dh(credit.montant_paye)}</b> : à lui rembourser ou à garder selon votre accord. Les versements restent enregistrés.
        </div>
      )}
      {credit.reprise_phone_id && <p className="text-xs text-white/50">Le téléphone repris ({credit.reprise_phone_id}) reste en stock.</p>}
      <div><Label>Motif (obligatoire)</Label><input className={inputCls} placeholder="Le client renonce…" value={motif} onChange={e => setMotif(e.target.value)} /></div>
      <Actions onClose={onClose} onConfirm={cancel} busy={busy} disabled={motif.trim().length < 3} label="Annuler le dossier" danger />
    </Shell>
  )
}

// ── Schedule: build / edit ─────────────────────────────────────────
export function ScheduleModal({ credit, echeances, onClose, onSaved }: { credit: EditableCredit; echeances: Echeance[]; onClose: () => void; onSaved: () => void }) {
  const nextMonth = (() => { const d = new Date(storeDate() + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10) })()
  const [count, setCount] = useState('3')
  const [first, setFirst] = useState(nextMonth)
  const [lines, setLines] = useState<Echeance[]>(() => echeances.length
    ? echeances.map(e => ({ date_echeance: String(e.date_echeance).slice(0, 10), montant: Number(e.montant) }))
    : monthlyPlan(Number(credit.montant_restant), 3, nextMonth))
  // A new plan (none yet, or regenerated) covers what is left to pay from now on
  const [rebase, setRebase] = useState(!echeances.length)
  const [busy, setBusy] = useState(false)

  const target = rebase ? Number(credit.montant_restant) : Number(credit.montant_cash_total) - Number(credit.echeancier_base ?? 0)
  const sum = Math.round(lines.reduce((s, l) => s + (Number(l.montant) || 0), 0) * 100) / 100
  const gap = Math.round((target - sum) * 100) / 100
  const setLine = (i: number, patch: Partial<Echeance>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))

  async function save(list: Echeance[]) {
    setBusy(true)
    try {
      await send(`/api/phone-credits/${credit.credit_id}/echeances`, 'PUT', { lines: list, rebase })
      toast.success(list.length ? 'Échéancier enregistré' : 'Échéancier supprimé'); onSaved(); onClose()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Shell title="Échéancier" subtitle={`${credit.client_name} · reste ${dh(credit.montant_restant)}`} onClose={onClose} wide>
      <div className="rounded-xl bg-white/5 p-3 space-y-2">
        <p className="text-xs text-white/50">Générer des mensualités égales pour le reste à payer</p>
        <div className="flex gap-2 items-end">
          <div className="w-24"><Label>Nombre</Label><input type="number" min={1} max={60} className={inputCls} value={count} onChange={e => setCount(e.target.value)} /></div>
          <div className="flex-1"><Label>Première échéance</Label><input type="date" className={inputCls} value={first} onChange={e => setFirst(e.target.value)} /></div>
          <button onClick={() => { setLines(monthlyPlan(Number(credit.montant_restant), Number(count) || 1, first)); setRebase(true) }}
            className="px-3 py-2.5 rounded-xl bg-gold/15 text-gold text-sm font-medium hover:bg-gold/25 transition-all">Générer</button>
        </div>
      </div>

      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2 items-center">
            <span className="w-5 text-xs text-white/30 text-right">{i + 1}</span>
            <input type="date" className={inputCls} value={l.date_echeance} onChange={e => setLine(i, { date_echeance: e.target.value })} />
            <input type="number" min={0} className={`${inputCls} w-32`} value={l.montant} onChange={e => setLine(i, { montant: Number(e.target.value) })} />
            <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Retirer" className="p-2 text-white/30 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button onClick={() => setLines(ls => [...ls, { date_echeance: ls.length ? ls[ls.length - 1].date_echeance : first, montant: Math.max(0, gap) }])}
          className="w-full py-2 rounded-xl border border-dashed border-white/15 text-xs text-white/50 hover:bg-white/5 flex items-center justify-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />Ajouter une échéance
        </button>
      </div>

      <div className={`flex justify-between rounded-xl px-4 py-2.5 text-sm ${Math.abs(gap) > 0.01 ? 'bg-amber-500/10 text-amber-200' : 'bg-green-500/10 text-green-300'}`}>
        <span>Total {dh(sum)} / à couvrir {dh(target)}</span>
        <b>{Math.abs(gap) > 0.01 ? (gap > 0 ? `manque ${dh(gap)}` : `${dh(-gap)} de trop`) : 'OK'}</b>
      </div>

      <Actions onClose={onClose} onConfirm={() => save(lines)} busy={busy}
        disabled={!lines.length || lines.some(l => !l.date_echeance || !(Number(l.montant) > 0))} />
      {echeances.length > 0 && (
        <button onClick={() => save([])} disabled={busy} className="w-full py-2 rounded-xl text-xs text-red-400 hover:bg-red-500/10 transition-all">Supprimer l'échéancier</button>
      )}
    </Shell>
  )
}

// ── Reminder text (WhatsApp) ───────────────────────────────────────
export function reminderMessage(credit: EditableCredit, st: ScheduleStatus) {
  const device = [credit.marque, credit.model].filter(Boolean).join(' ')
  const first = credit.client_name.split(' ')[0]
  const due = st.lateAmount > 0
    ? `un montant de ${dh(st.lateAmount)} était prévu${st.daysLate ? ` depuis le ${frDate(st.lines.find(l => l.state === 'en_retard')!.date_echeance)}` : ''}`
    : st.next ? `la prochaine échéance de ${dh(st.next.montant - st.next.covered)} est prévue le ${frDate(st.next.date_echeance)}` : ''
  return `Bonjour ${first}, petit rappel d'Electro Zaki pour votre ${device} : ${due}. Reste à payer : ${dh(credit.montant_restant)}. Merci !`
}

// ── Schedule block shown in the credit panel ───────────────────────
export function ScheduleBlock({ credit, echeances, canEdit, onEdit }: { credit: EditableCredit; echeances: Echeance[]; canEdit: boolean; onEdit: () => void }) {
  const st = useMemo(() => scheduleStatus(echeances, credit.montant_paye, credit.echeancier_base ?? 0), [echeances, credit.montant_paye, credit.echeancier_base])
  const open = credit.statut !== 'annule' && !credit.discharged_at && Number(credit.montant_restant) > 0.01

  if (!echeances.length) {
    return open && canEdit ? (
      <button onClick={onEdit} className="mx-3 mb-2 w-[calc(100%-1.5rem)] flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-white/15 text-xs text-white/50 hover:bg-white/5 transition-all">
        <CalendarClock className="w-3.5 h-3.5" />Créer un échéancier
      </button>
    ) : null
  }

  const chip: Record<string, string> = {
    payee: 'bg-green-500/15 text-green-400', partielle: 'bg-gold/15 text-gold',
    en_retard: 'bg-red-500/15 text-red-400', a_venir: 'bg-white/10 text-white/50',
  }
  const label: Record<string, string> = { payee: 'Payée', partielle: 'Partielle', en_retard: 'En retard', a_venir: 'À venir' }

  return (
    <div className="mx-3 mb-2 rounded-lg border border-white/10 bg-white/[0.02]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="text-xs font-medium text-white/60 flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5 text-gold" />Échéancier</span>
        <div className="flex items-center gap-1.5">
          {open && st.lateAmount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">Retard {dh(st.lateAmount)} · {st.daysLate} j</span>}
          {open && credit.client_tel && (st.lateAmount > 0 || st.next) && (
            <a href={`${whatsappLink(credit.client_tel)}?text=${encodeURIComponent(reminderMessage(credit, st))}`} target="_blank" rel="noopener noreferrer"
              className="text-xs px-2 py-1 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 flex items-center gap-1" title="Envoyer un rappel WhatsApp">
              <MessageCircle className="w-3.5 h-3.5" />Rappel
            </a>
          )}
          {open && canEdit && (
            <button onClick={onEdit} className="p-1 text-white/40 hover:text-white" aria-label="Modifier l'échéancier"><Pencil className="w-3.5 h-3.5" /></button>
          )}
        </div>
      </div>
      <div className="divide-y divide-white/5 max-h-40 overflow-y-auto">
        {st.lines.map((l, i) => (
          <div key={l.echeance_id ?? i} className="flex items-center justify-between px-3 py-1.5 text-xs">
            <span className="text-white/60">{frDate(l.date_echeance)}</span>
            <span className="flex items-center gap-2">
              <span className="text-white font-medium">{dh(l.montant)}</span>
              <span className={`px-1.5 py-0.5 rounded ${chip[l.state]}`}>{label[l.state]}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
