'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import {
  CreditCard, Plus, CheckCircle, Loader2,
  X, ArrowUpRight, Banknote, Landmark,
} from 'lucide-react'

// ── Types ───────────────────────────────────────────────────────────
interface CreditSale {
  credit_id:      string
  phone_id:       string
  client_name:    string
  client_tel:     string | null
  client_cin:     string | null
  montant_total:  number
  montant_paye:   number
  montant_restant: number
  pct_paye:       number
  statut:         'en_cours' | 'solde' | 'annule'
  phone_remis:    boolean
  created_at:     string
  discharged_at:  string | null
}

interface CreditPayment {
  payment_id:     string
  montant:        number
  payment_method: 'نقد' | 'تحويل'
  date_paiement:  string
  notes:          string | null
}

interface CreditForm {
  client_name:     string
  client_tel:      string
  client_cin:      string
  montant_total:   string
  avance_initiale: string
  payment_method:  string
  phone_remis:     boolean
  notes:           string
}

interface PaymentForm {
  montant:        string
  payment_method: string
  date_paiement:  string
  notes:          string
}

interface PhoneCreditPanelProps {
  phoneId:        string
  phoneStatus:    string
  storeId:        string
  userId:         string
  userName:       string
  onCreditCreated: () => void   // rafraîchir la liste parent
}

// ── Composant principal ──────────────────────────────────────────────
export default function PhoneCreditPanel({
  phoneId,
  phoneStatus,
  storeId,
  onCreditCreated,
}: PhoneCreditPanelProps) {
  const router = useRouter()

  const [credit,   setCredit]   = useState<CreditSale | null>(null)
  const [payments, setPayments] = useState<CreditPayment[]>([])
  const [loading,  setLoading]  = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [showNewCreditModal,  setShowNewCreditModal]  = useState(false)
  const [showPaymentModal,    setShowPaymentModal]    = useState(false)
  const [showDischargeResult, setShowDischargeResult] = useState(false)
  const [dischargeData, setDischargeData]             = useState<Record<string, unknown> | null>(null)

  const [creditForm, setCreditForm] = useState<CreditForm>({
    client_name: '', client_tel: '', client_cin: '',
    montant_total: '', avance_initiale: '0',
    payment_method: 'نقد', phone_remis: false, notes: '',
  })

  const [paymentForm, setPaymentForm] = useState<PaymentForm>({
    montant: '', payment_method: 'نقد',
    date_paiement: new Date().toISOString().split('T')[0], notes: '',
  })

  // ── Fetch ────────────────────────────────────────────────────────
  const fetchCredit = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/phone-credits?phone_id=${phoneId}`)
      const json = await res.json() as { data?: { credit: CreditSale | null; payments: CreditPayment[] }; error?: string }
      if (!res.ok) throw new Error(json.error)
      setCredit(json.data?.credit   ?? null)
      setPayments(json.data?.payments ?? [])
    } catch (err) {
      console.error('[PhoneCreditPanel fetch]', err)
    } finally {
      setLoading(false)
    }
  }, [phoneId])

  useEffect(() => { void fetchCredit() }, [fetchCredit])

  // ── Créer un crédit ──────────────────────────────────────────────
  async function handleCreateCredit() {
    if (!creditForm.client_name.trim()) { toast.error('Nom du client obligatoire'); return }
    const montantTotal   = parseFloat(creditForm.montant_total)
    const avanceInitiale = parseFloat(creditForm.avance_initiale) || 0
    if (!montantTotal || montantTotal <= 0) { toast.error('Montant total invalide'); return }
    if (avanceInitiale > montantTotal)      { toast.error("L'avance dépasse le total"); return }

    setSubmitting(true)
    try {
      const res  = await fetch('/api/phone-credits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_id:        phoneId,
          client_name:     creditForm.client_name.trim(),
          client_tel:      creditForm.client_tel.trim()  || null,
          client_cin:      creditForm.client_cin.trim()  || null,
          montant_total:   montantTotal,
          avance_initiale: avanceInitiale,
          payment_method:  creditForm.payment_method,
          phone_remis:     creditForm.phone_remis,
          notes:           creditForm.notes.trim() || null,
          store_id:        storeId,
        }),
      })
      const json = await res.json() as { error?: string }
      if (!res.ok) throw new Error(json.error)
      toast.success('Vente à crédit créée')
      setShowNewCreditModal(false)
      onCreditCreated()
      await fetchCredit()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Ajouter un versement ─────────────────────────────────────────
  async function handleAddPayment() {
    if (!credit) return
    const montant = parseFloat(paymentForm.montant)
    if (!montant || montant <= 0) { toast.error('Montant invalide'); return }

    setSubmitting(true)
    try {
      const res  = await fetch(`/api/phone-credits/${credit.credit_id}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          montant,
          payment_method: paymentForm.payment_method,
          date_paiement:  paymentForm.date_paiement,
          notes:          paymentForm.notes.trim() || null,
          store_id:       storeId,
        }),
      })
      const json = await res.json() as { error?: string }
      if (!res.ok) throw new Error(json.error)
      toast.success(`+${montant.toLocaleString('fr-MA')} DH enregistré`)
      setShowPaymentModal(false)
      setPaymentForm({ montant: '', payment_method: 'نقد', date_paiement: new Date().toISOString().split('T')[0], notes: '' })
      await fetchCredit()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Décharge ─────────────────────────────────────────────────────
  async function handleDischarge() {
    if (!credit) return
    setSubmitting(true)
    try {
      const res  = await fetch(`/api/phone-credits/${credit.credit_id}/discharge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId }),
      })
      const json = await res.json() as { data?: { fac_prefill: Record<string, unknown> }; error?: string }
      if (!res.ok) throw new Error(json.error)
      setDischargeData(json.data?.fac_prefill ?? null)
      setShowDischargeResult(true)
      onCreditCreated()
      await fetchCredit()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Loading ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/40 py-3">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Chargement...</span>
      </div>
    )
  }

  const isAvailable  = phoneStatus === 'متوفر'
  const hasCredit    = !!credit
  const isFullyPaid  = hasCredit && credit.pct_paye >= 99.9
  const canDischarge = isFullyPaid && !credit.discharged_at && credit.statut === 'en_cours'

  // ── Phone disponible sans crédit → proposer ──────────────────────
  if (!hasCredit && isAvailable) {
    return (
      <>
        <button
          onClick={() => setShowNewCreditModal(true)}
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#C9A440]/30 text-[#C9A440] text-sm font-medium hover:bg-[#C9A440]/10 transition-all duration-200"
        >
          <CreditCard className="w-4 h-4" />
          Vendre à crédit / Avance
        </button>

        {showNewCreditModal && (
          <NewCreditModal
            form={creditForm}
            setForm={setCreditForm}
            onConfirm={handleCreateCredit}
            onClose={() => setShowNewCreditModal(false)}
            submitting={submitting}
          />
        )}
      </>
    )
  }

  // ── Pas de crédit sur un phone non-disponible → rien ────────────
  if (!hasCredit) return null

  // ── Panneau crédit ────────────────────────────────────────────────
  return (
    <>
      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">

        {/* En-tête */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-[#C9A440]" />
            <span className="text-sm font-semibold text-white">Vente à Crédit</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              credit.statut === 'solde'
                ? 'bg-green-500/20 text-green-400'
                : credit.statut === 'annule'
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-amber-500/20 text-amber-400'
            }`}>
              {credit.statut === 'solde' ? '✓ Soldé' : credit.statut === 'annule' ? 'Annulé' : 'En cours'}
            </span>
          </div>
          <span className="text-xs text-white/30 font-mono">{credit.credit_id}</span>
        </div>

        {/* Infos client */}
        <div className="px-4 pt-3 pb-1">
          <p className="text-sm font-medium text-white">{credit.client_name}</p>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-white/50">
            {credit.client_tel && <span>{credit.client_tel}</span>}
            {credit.client_cin && <span>CIN : {credit.client_cin}</span>}
            <span className={credit.phone_remis ? 'text-amber-400/70' : 'text-blue-400/70'}>
              {credit.phone_remis ? 'Téléphone remis' : 'Téléphone réservé'}
            </span>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2 px-4 py-3">
          {[
            { label: 'Total convenu',   value: credit.montant_total,   color: 'text-white' },
            { label: 'Versé',           value: credit.montant_paye,    color: 'text-green-400' },
            { label: 'Reste dû',        value: credit.montant_restant, color: credit.montant_restant > 0 ? 'text-amber-400' : 'text-green-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white/5 rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-white/40 mb-1">{label}</p>
              <p className={`text-sm font-bold ${color}`}>
                {value.toLocaleString('fr-MA')} <span className="text-xs font-normal">DH</span>
              </p>
            </div>
          ))}
        </div>

        {/* Barre de progression */}
        <div className="px-4 pb-3">
          <div className="flex justify-between text-xs text-white/40 mb-1.5">
            <span>Progression</span>
            <span className="font-medium text-white/60">{credit.pct_paye}%</span>
          </div>
          <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${isFullyPaid ? 'bg-green-500' : 'bg-[#C9A440]'}`}
              style={{ width: `${Math.min(Number(credit.pct_paye), 100)}%` }}
            />
          </div>
        </div>

        {/* Historique paiements */}
        {payments.length > 0 && (
          <div className="border-t border-white/10">
            <p className="px-4 py-2 text-[10px] text-white/30 uppercase tracking-widest font-medium">
              Historique — {payments.length} versement{payments.length > 1 ? 's' : ''}
            </p>
            <div className="divide-y divide-white/5 max-h-44 overflow-y-auto">
              {payments.map((p) => (
                <div key={p.payment_id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    {p.payment_method === 'نقد'
                      ? <Banknote className="w-3.5 h-3.5 text-green-400/70" />
                      : <Landmark  className="w-3.5 h-3.5 text-blue-400/70" />
                    }
                    <span className="text-xs text-white/60">
                      {new Date(p.date_paiement + 'T00:00:00').toLocaleDateString('fr-MA', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      })}
                    </span>
                    <span className="text-xs text-white/30">{p.payment_method}</span>
                  </div>
                  <span className="text-sm font-semibold text-white">
                    +{Number(p.montant).toLocaleString('fr-MA')} DH
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {credit.statut === 'en_cours' && (
          <div className="flex gap-2 p-3 border-t border-white/10">
            <button
              onClick={() => setShowPaymentModal(true)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-all"
            >
              <Plus className="w-4 h-4" />
              Versement
            </button>
            <button
              onClick={handleDischarge}
              disabled={!canDischarge || submitting}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                canDischarge
                  ? 'bg-[#C9A440] hover:bg-[#b8932e] text-black cursor-pointer'
                  : 'bg-white/5 text-white/25 cursor-not-allowed'
              }`}
              title={!canDischarge ? `Reste ${credit.montant_restant.toLocaleString('fr-MA')} DH à payer` : 'Décharger et générer la FAC'}
            >
              {submitting
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <CheckCircle className="w-4 h-4" />
              }
              Décharger & FAC
            </button>
          </div>
        )}
      </div>

      {/* Modal — Ajouter versement */}
      {showPaymentModal && credit && (
        <PaymentModal
          credit={credit}
          form={paymentForm}
          setForm={setPaymentForm}
          onConfirm={handleAddPayment}
          onClose={() => setShowPaymentModal(false)}
          submitting={submitting}
        />
      )}

      {/* Modal — Résultat décharge */}
      {showDischargeResult && dischargeData && (
        <DischargeResultModal
          data={dischargeData}
          onClose={() => setShowDischargeResult(false)}
          onGoToDocuments={() => { router.push('/ez/documents') }}
        />
      )}

      {/* Modal — Nouvelle vente à crédit (affiché ici aussi si ouvert depuis un autre chemin) */}
      {showNewCreditModal && (
        <NewCreditModal
          form={creditForm}
          setForm={setCreditForm}
          onConfirm={handleCreateCredit}
          onClose={() => setShowNewCreditModal(false)}
          submitting={submitting}
        />
      )}
    </>
  )
}

// ── Modal : Nouvelle vente à crédit ─────────────────────────────────
function NewCreditModal({
  form, setForm, onConfirm, onClose, submitting,
}: {
  form: CreditForm
  setForm: React.Dispatch<React.SetStateAction<CreditForm>>
  onConfirm: () => Promise<void>
  onClose: () => void
  submitting: boolean
}) {
  const avance   = parseFloat(form.avance_initiale) || 0
  const total    = parseFloat(form.montant_total)   || 0
  const restant  = Math.max(total - avance, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#111] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#C9A440]" />
            <h3 className="font-semibold text-white">Nouvelle vente à crédit</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">

          {/* Client */}
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wide mb-2 font-medium">Client</p>
            <div className="space-y-2">
              <input
                value={form.client_name}
                onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
                placeholder="Nom complet *"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A440]/50"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={form.client_tel}
                  onChange={(e) => setForm((f) => ({ ...f, client_tel: e.target.value }))}
                  placeholder="Téléphone"
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A440]/50"
                />
                <input
                  value={form.client_cin}
                  onChange={(e) => setForm((f) => ({ ...f, client_cin: e.target.value }))}
                  placeholder="CIN"
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A440]/50"
                />
              </div>
            </div>
          </div>

          {/* Montants */}
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wide mb-2 font-medium">Paiement</p>
            <div className="space-y-2">
              <div className="relative">
                <input
                  type="number" min="0" step="0.01"
                  value={form.montant_total}
                  onChange={(e) => setForm((f) => ({ ...f, montant_total: e.target.value }))}
                  placeholder="Prix convenu total *"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 pr-12 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A440]/50"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30">DH</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <input
                    type="number" min="0" step="0.01"
                    value={form.avance_initiale}
                    onChange={(e) => setForm((f) => ({ ...f, avance_initiale: e.target.value }))}
                    placeholder="Avance initiale"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A440]/50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30">DH</span>
                </div>
                <select
                  value={form.payment_method}
                  onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A440]/50"
                >
                  <option value="نقد">نقد — Espèces</option>
                  <option value="تحويل">تحويل — Virement</option>
                </select>
              </div>
              {/* Récap */}
              {total > 0 && (
                <div className="flex justify-between text-xs bg-white/5 rounded-lg px-3 py-2">
                  <span className="text-white/50">Reste après avance</span>
                  <span className="font-semibold text-amber-400">{restant.toLocaleString('fr-MA')} DH</span>
                </div>
              )}
            </div>
          </div>

          {/* Toggle téléphone remis */}
          <div
            onClick={() => setForm((f) => ({ ...f, phone_remis: !f.phone_remis }))}
            className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all ${
              form.phone_remis
                ? 'border-amber-500/40 bg-amber-500/10'
                : 'border-white/10 bg-white/5'
            }`}
          >
            <div>
              <p className="text-sm font-medium text-white">
                {form.phone_remis ? 'Téléphone remis maintenant' : 'Téléphone réservé (reste en stock)'}
              </p>
              <p className="text-xs text-white/40 mt-0.5">
                {form.phone_remis
                  ? 'Statut → مباع. FAC générée à la fin.'
                  : 'Statut → حجز. Remis seulement au paiement complet.'}
              </p>
            </div>
            <div className={`w-10 h-5 rounded-full transition-all relative flex-shrink-0 ${form.phone_remis ? 'bg-amber-500' : 'bg-white/20'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${form.phone_remis ? 'left-5' : 'left-0.5'}`} />
            </div>
          </div>

          {/* Notes */}
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Notes (optionnel)"
            rows={2}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A440]/50 resize-none"
          />
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-white/60 hover:text-white hover:border-white/20 transition-all"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl bg-[#C9A440] hover:bg-[#b8932e] text-black text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Créer le crédit
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal : Ajouter un versement ─────────────────────────────────────
function PaymentModal({
  credit, form, setForm, onConfirm, onClose, submitting,
}: {
  credit:     CreditSale
  form:       PaymentForm
  setForm:    React.Dispatch<React.SetStateAction<PaymentForm>>
  onConfirm:  () => Promise<void>
  onClose:    () => void
  submitting: boolean
}) {
  const montant  = parseFloat(form.montant) || 0
  const restant  = credit.montant_restant
  const willFill = montant >= restant - 0.01 && montant > 0

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">

        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h3 className="font-semibold text-white">Ajouter un versement</h3>
            <p className="text-xs text-white/40 mt-0.5">{credit.client_name} · {credit.credit_id}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {/* Rappel solde */}
          <div className="flex justify-between bg-white/5 rounded-xl px-4 py-3">
            <span className="text-sm text-white/50">Reste dû</span>
            <span className="text-sm font-bold text-amber-400">
              {restant.toLocaleString('fr-MA')} DH
            </span>
          </div>

          {/* Montant */}
          <div className="relative">
            <input
              type="number" min="0.01" step="0.01"
              value={form.montant}
              onChange={(e) => setForm((f) => ({ ...f, montant: e.target.value }))}
              placeholder="Montant du versement"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A440]/50"
              autoFocus
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-white/30">DH</span>
          </div>

          {/* Quick fill buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => setForm((f) => ({ ...f, montant: String(Math.round(restant / 2)) }))}
              className="flex-1 py-1.5 rounded-lg bg-white/5 text-xs text-white/50 hover:bg-white/10 hover:text-white transition-all"
            >
              Moitié
            </button>
            <button
              onClick={() => setForm((f) => ({ ...f, montant: String(restant) }))}
              className="flex-1 py-1.5 rounded-lg bg-white/5 text-xs text-white/50 hover:bg-white/10 hover:text-white transition-all"
            >
              Solde total
            </button>
          </div>

          {/* Méthode */}
          <div className="grid grid-cols-2 gap-2">
            {(['نقد', 'تحويل'] as const).map((method) => (
              <button
                key={method}
                onClick={() => setForm((f) => ({ ...f, payment_method: method }))}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                  form.payment_method === method
                    ? 'border-[#C9A440] bg-[#C9A440]/15 text-[#C9A440]'
                    : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20'
                }`}
              >
                {method === 'نقد'
                  ? <><Banknote className="w-4 h-4" /> Espèces</>
                  : <><Landmark  className="w-4 h-4" /> Virement</>
                }
              </button>
            ))}
          </div>

          {/* Date */}
          <input
            type="date"
            value={form.date_paiement}
            onChange={(e) => setForm((f) => ({ ...f, date_paiement: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A440]/50"
          />

          {/* Alerte solde complet */}
          {willFill && (
            <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2.5">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              Ce versement solde le crédit — décharge possible ensuite
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-white/60 hover:text-white transition-all"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl bg-[#C9A440] hover:bg-[#b8932e] text-black text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal : Résultat décharge ────────────────────────────────────────
function DischargeResultModal({
  data, onClose, onGoToDocuments,
}: {
  data:             Record<string, unknown>
  onClose:          () => void
  onGoToDocuments:  () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">

        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Crédit soldé ✓</h3>
              <p className="text-xs text-white/40">Décharge effectuée — téléphone marqué مباع</p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-2">
          <p className="text-xs text-white/40 uppercase tracking-wide font-medium mb-3">Données pour la FAC</p>

          {[
            { label: 'Client',    value: data.client_name as string },
            { label: 'Tél',       value: (data.client_tel as string) || '—' },
            { label: 'CIN',       value: (data.client_cin as string) || '—' },
            { label: 'Téléphone', value: data.device_label as string },
            { label: 'IMEI',      value: (data.imei as string) || '—' },
            { label: 'Montant',   value: `${(data.montant as number).toLocaleString('fr-MA')} DH` },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-white/40">{label}</span>
              <span className="text-white font-medium">{value}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-white/60 hover:text-white transition-all"
          >
            Fermer
          </button>
          <button
            onClick={onGoToDocuments}
            className="flex-1 py-2.5 rounded-xl bg-[#C9A440] hover:bg-[#b8932e] text-black text-sm font-semibold flex items-center justify-center gap-1.5 transition-all"
          >
            Créer FAC
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}