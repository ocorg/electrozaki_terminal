'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, X, Banknote, ArrowRightLeft, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

type PaymentMethod = 'نقد' | 'تحويل'

interface Props {
  isOpen:           boolean
  onClose:          () => void
  onSuccess:        (txn_id: string) => void

  // Document data — pré-rempli depuis le formulaire de la facture
  doc_id:           string
  doc_ref:          string
  phone_id:         string
  client_name:      string | null
  client_tel?:      string | null
  client_id?:       string | null
  device_label:     string | null
  imei:             string | null
  montant:          number          // montant de la facture, modifiable
  warranty_start?:  string | null
  warranty_expiry?: string | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ConfirmSaleModal({
  isOpen, onClose, onSuccess,
  doc_id, doc_ref, phone_id,
  client_name, client_tel, client_id,
  device_label, imei,
  montant: initialMontant,
  warranty_start, warranty_expiry,
}: Props) {

  const [amount,         setAmount]         = useState(initialMontant)
  const [paymentMethod,  setPaymentMethod]  = useState<PaymentMethod>('نقد')
  const [notes,          setNotes]          = useState('')
  const [loading,        setLoading]        = useState(false)

  // Reset local state chaque fois que le modal s'ouvre
  useEffect(() => {
    if (isOpen) {
      setAmount(initialMontant)
      setPaymentMethod('نقد')
      setNotes('')
      setLoading(false)
    }
  }, [isOpen, initialMontant])

  if (!isOpen) return null

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!amount || amount <= 0) {
      toast.error('Le montant doit être supérieur à 0')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/documents/confirm-sale', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_id,
          phone_id,
          facture_ref:     doc_ref,
          prix_vente:      amount,
          payment_method:  paymentMethod,
          date_vente:      new Date().toISOString().split('T')[0],
          warranty_start:  warranty_start  || null,
          warranty_expiry: warranty_expiry || null,
          client_id:       client_id       || null,
          notes:           notes           || null,
        }),
      })

      const json = await res.json()
      if (json.status !== 'success') throw new Error(json.error ?? 'Erreur inconnue')

      toast.success(`Vente confirmée — ${doc_ref}`, {
        description: `${amount.toLocaleString('fr-MA')} MAD · ${paymentMethod === 'نقد' ? 'Espèces' : 'Virement'}`,
      })
      onSuccess(json.data.txn_id)

    } catch (err: any) {
      toast.error('Échec de la confirmation', {
        description: err.message ?? 'Veuillez réessayer',
      })
    } finally {
      setLoading(false)
    }
  }

  const amountDiffers = Math.abs(amount - initialMontant) > 0.01

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget && !loading) onClose() }}
    >
      <div className="w-full max-w-md bg-[#0c0c0c] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <div>
            <h2 className="text-white font-semibold tracking-tight">
              Confirmer la vente
            </h2>
            <p className="font-mono text-[#C9A440] text-xs mt-0.5 tracking-wide">
              {doc_ref}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1.5 text-white/40 hover:text-white hover:bg-white/5
                       rounded-lg transition-colors disabled:opacity-30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Sale summary ───────────────────────────────────────────────── */}
        <div className="px-6 py-4 bg-white/[0.025] border-b border-white/10">
          <p className="text-white text-sm font-medium truncate">
            {device_label ?? <span className="text-white/30">Appareil non renseigné</span>}
          </p>
          {imei && (
            <p className="text-white/30 text-xs font-mono mt-0.5">{imei}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            {client_name && (
              <span className="text-white/50 text-xs">{client_name}</span>
            )}
            {client_name && client_tel && (
              <span className="text-white/20 text-xs">·</span>
            )}
            {client_tel && (
              <span className="text-white/50 text-xs">{client_tel}</span>
            )}
          </div>
        </div>

        {/* ── Form ───────────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-5">

          {/* Amount */}
          <div>
            <label className="block text-[10px] text-white/40 uppercase tracking-widest mb-2">
              Montant encaissé (MAD)
            </label>
            <div className="relative">
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount === 0 ? '' : amount}
                onChange={e => setAmount(parseFloat(e.target.value) || 0)}
                disabled={loading}
                placeholder="0.00"
                className="w-full px-4 py-3.5 pr-16 bg-white/5 border border-white/15 rounded-xl
                           text-white text-2xl font-semibold tracking-tight focus:outline-none
                           focus:border-[#C9A440]/60 transition-colors disabled:opacity-50
                           placeholder-white/15"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2
                               text-white/25 text-sm font-medium pointer-events-none">
                MAD
              </span>
            </div>
          </div>

          {/* Payment method */}
          <div>
            <label className="block text-[10px] text-white/40 uppercase tracking-widest mb-2">
              Mode de règlement
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { method: 'نقد'   as PaymentMethod, labelFr: 'Espèces',  Icon: Banknote       },
                  { method: 'تحويل' as PaymentMethod, labelFr: 'Virement', Icon: ArrowRightLeft },
                ]
              ).map(({ method, labelFr, Icon }) => {
                const active = paymentMethod === method
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    disabled={loading}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2
                                transition-all duration-150 disabled:opacity-50 ${
                      active
                        ? 'border-[#C9A440] bg-[#C9A440]/10 text-[#C9A440]'
                        : 'border-white/10 bg-white/[0.03] text-white/35 hover:border-white/20 hover:text-white/60'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-sm font-medium">{labelFr}</span>
                    <span className="text-xs opacity-60" dir="rtl">{method}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Optional notes */}
          <div>
            <label className="block text-[10px] text-white/40 uppercase tracking-widest mb-2">
              Notes <span className="normal-case text-white/25">(optionnel)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={loading}
              rows={2}
              placeholder="Acompte, réduction, observations..."
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm
                         text-white placeholder-white/20 focus:outline-none focus:border-[#C9A440]/50
                         transition-colors disabled:opacity-50 resize-none"
            />
          </div>
        </div>

        {/* ── Amount mismatch warning ─────────────────────────────────────── */}
        {amountDiffers && (
          <div className="mx-6 mb-4 flex items-start gap-2.5 px-4 py-3
                          bg-amber-500/8 border border-amber-500/20 rounded-xl">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-amber-300/80 text-xs leading-relaxed">
              Le montant encaissé ({amount.toLocaleString('fr-MA')} MAD) est différent
              du montant facturé ({initialMontant.toLocaleString('fr-MA')} MAD).
              C&apos;est le montant encaissé qui sera enregistré en caisse.
            </p>
          </div>
        )}

        {/* ── Actions ────────────────────────────────────────────────────── */}
        <div className="flex gap-3 px-6 py-5 border-t border-white/10">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-3 text-sm text-white/50 hover:text-white
                       border border-white/10 hover:border-white/20 rounded-xl
                       transition-all disabled:opacity-40"
          >
            Annuler
          </button>

          <button
            onClick={handleConfirm}
            disabled={loading || amount <= 0}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                       text-sm font-semibold bg-[#C9A440] hover:bg-[#d4aa48] text-black
                       rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-black/25 border-t-black
                                 rounded-full animate-spin" />
                Traitement...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Confirmer la vente
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  )
}