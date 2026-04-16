'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { formatMAD, computeFariq, computeStatutPaiement, isBelowMinimum } from '@/lib/utils'
import { Modal, Field, inputClass, selectClass, Btn, PageHeader } from '@/components/shared'
import { StatusBadge } from '@/components/shared'
import { toast } from 'sonner'
import type { Phone, Laptop, PaymentMethod, OperationType } from '@/types/database'
import {
  Search, ShoppingCart, User, CreditCard, ArrowLeftRight,
  X, Plus, Minus, AlertTriangle, Loader2, CheckCircle,
  Smartphone, Laptop as LaptopIcon, Package, Lock
} from 'lucide-react'

type DeviceResult = (Phone | Laptop) & {
  _type: 'phone' | 'laptop' | 'accessory'
  _displayName: string
  _id: string
}

type CartItem = DeviceResult & {
  prix_vente_saisi: number
}

interface SaleForm {
  client_nom: string
  client_tel: string
  type_operation: OperationType
  payment_method: PaymentMethod
  montant_especes: number
  montant_carte: number
  avance: number
  payment_ref: string
  valeur_echange: number
  marque_echange: string
  model_echange: string
  imei_echange: string
  description_echange: string
  notes: string
}

const EMPTY_SALE: SaleForm = {
  client_nom: '', client_tel: '',
  type_operation: 'بيع',
  payment_method: 'نقد',
  montant_especes: 0, montant_carte: 0,
  avance: 0, payment_ref: '',
  valeur_echange: 0, marque_echange: '', model_echange: '',
  imei_echange: '', description_echange: '', notes: '',
}

export default function POSPage() {
  const { user } = useUser()
  const { language } = useLanguageStore()
  const isAr = language === 'ar'
  const canSeePrices = user?.role !== 'staff'

  const [search, setSearch]         = useState('')
  const [results, setResults]       = useState<DeviceResult[]>([])
  const [searching, setSearching]   = useState(false)
  const [cart, setCart]             = useState<CartItem[]>([])
  const [saleForm, setSaleForm]     = useState<SaleForm>({ ...EMPTY_SALE })
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overridePin, setOverridePin]   = useState('')
  const [overrideItem, setOverrideItem] = useState<CartItem | null>(null)
  const [overrideLoading, setOverrideLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [successTxn, setSuccessTxn] = useState<string | null>(null)
  const searchRef = useRef<NodeJS.Timeout>()

  // Search devices
  useEffect(() => {
    if (!search.trim() || search.length < 2) { setResults([]); return }
    clearTimeout(searchRef.current)
    setSearching(true)
    searchRef.current = setTimeout(async () => {
      const [pRes, lRes] = await Promise.all([
        fetch(`/api/phones?status=متوفر&search=${encodeURIComponent(search)}`),
        fetch(`/api/laptops?status=متوفر&search=${encodeURIComponent(search)}`),
      ])
      const [pJson, lJson] = await Promise.all([pRes.json(), lRes.json()])
      const phones: DeviceResult[] = (pJson.data || []).map((p: Phone) => ({
        ...p, _type: 'phone' as const,
        _displayName: `${p.marque} ${p.model}${p.stockage ? ' ' + p.stockage : ''}`,
        _id: p.phone_id,
      }))
      const laptops: DeviceResult[] = (lJson.data || []).map((l: Laptop) => ({
        ...l, _type: 'laptop' as const,
        _displayName: `${l.marque} ${l.model}${l.stockage ? ' ' + l.stockage : ''}`,
        _id: l.laptop_id,
      }))
      setResults([...phones, ...laptops])
      setSearching(false)
    }, 300)
  }, [search])

  function addToCart(device: DeviceResult) {
    if (cart.find(c => c._id === device._id)) {
      toast.error('Déjà dans le panier')
      return
    }
    const prix = (device as Phone).prix_vente_recommande || 0
    setCart(prev => [...prev, { ...device, prix_vente_saisi: prix }])
    setSearch('')
    setResults([])
  }

  function removeFromCart(id: string) {
    setCart(prev => prev.filter(c => c._id !== id))
  }

  function updatePrice(id: string, prix: number) {
    const item = cart.find(c => c._id === id)
    if (!item) return
    const min = (item as Phone).prix_vente_minimum
    if (isBelowMinimum(prix, min) && user?.role === 'staff') {
      setOverrideItem({ ...item, prix_vente_saisi: prix })
      setOverrideOpen(true)
      return
    }
    setCart(prev => prev.map(c => c._id === id ? { ...c, prix_vente_saisi: prix } : c))
  }

  async function verifyOverride() {
    if (!overridePin || overridePin.length !== 4) { toast.error('Code PIN 4 chiffres requis'); return }
    setOverrideLoading(true)
    try {
      const res = await fetch('/api/auth/verify-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: overridePin }),
      })
      const json = await res.json()
      if (!json.authorized) throw new Error('Code incorrect')
      if (overrideItem) {
        setCart(prev => prev.map(c => c._id === overrideItem._id ? { ...c, prix_vente_saisi: overrideItem.prix_vente_saisi } : c))
      }
      toast.success('Dérogation autorisée ✓')
      setOverrideOpen(false)
      setOverridePin('')
      setOverrideItem(null)
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setOverrideLoading(false)
    }
  }

  function setSale(k: keyof SaleForm, v: unknown) {
    setSaleForm(prev => ({ ...prev, [k]: v }))
  }

  const totalVente    = cart.reduce((s, c) => s + c.prix_vente_saisi, 0)
  const fariq = computeFariq(
    totalVente,
    saleForm.avance,
    saleForm.type_operation === 'إستبدال' ? saleForm.valeur_echange : 0
  )
  const statutPaiement = computeStatutPaiement(fariq)

  async function handleSubmit() {
    if (cart.length === 0)       { toast.error('Panier vide'); return }
    if (!saleForm.client_tel)    { toast.error('Téléphone client obligatoire'); return }
    if (saleForm.payment_method === 'تحويل' && !saleForm.payment_ref) {
      toast.error('Référence virement obligatoire'); return
    }

    setSubmitting(true)
    try {
      // Create/find client
      const cRes = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom: saleForm.client_nom || saleForm.client_tel, telephone: saleForm.client_tel }),
      })
      const cJson = await cRes.json()
      const clientId = cJson.data?.client_id

      // Create transactions for each cart item
      for (const item of cart) {
        const txnData = {
          device_type: item._type === 'phone' ? 'هاتف' : item._type === 'laptop' ? 'لابتوب' : 'إكسسوار',
          device_id: item._id,
          client_id: clientId,
          type_operation: saleForm.type_operation,
          prix_vente: item.prix_vente_saisi,
          payment_method: saleForm.payment_method,
          avance: saleForm.avance,
          payment_ref: saleForm.payment_ref || undefined,
          montant_especes: saleForm.montant_especes,
          montant_carte: saleForm.montant_carte,
          valeur_echange: saleForm.type_operation === 'إستبدال' ? saleForm.valeur_echange : 0,
          marque_echange: saleForm.marque_echange || undefined,
          model_echange:  saleForm.model_echange || undefined,
          imei_echange:   saleForm.imei_echange || undefined,
          description_echange: saleForm.description_echange || undefined,
          warranty_start: new Date().toISOString().split('T')[0],
          notes: saleForm.notes || undefined,
        }

        const res = await fetch('/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(txnData),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        setSuccessTxn(json.data.txn_id)
      }

      toast.success('Vente enregistrée ✓')
      setCart([])
      setSaleForm({ ...EMPTY_SALE })
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (successTxn) return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="text-center bg-white border border-ez-border rounded-2xl p-10 max-w-sm shadow-ez-md">
        <CheckCircle className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
        <h2 className="font-display text-2xl font-bold text-ez-text mb-1">Vente enregistrée</h2>
        <p className="text-ez-subtle text-sm mb-6">Transaction {successTxn}</p>
        <div className="flex gap-3 justify-center">
          <Btn variant="secondary" onClick={() => setSuccessTxn(null)}>Nouvelle vente</Btn>
          <Btn variant="primary" onClick={() => window.print()}>Imprimer reçu</Btn>
        </div>
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col lg:flex-row gap-0 animate-fade-in overflow-hidden">

      {/* Left — Search + Cart */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-ez-border">
        <div className="p-6 border-b border-ez-border flex-shrink-0">
          <PageHeader
            title={isAr ? 'نقطة البيع' : 'Point de vente'}
            subtitle={isAr ? 'ابحث عن جهاز لإضافته' : 'Recherchez un appareil à vendre'}
          />

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ez-placeholder" />
            <input
              className="w-full pl-9 pr-4 py-3 bg-white border border-ez-border rounded-xl text-sm text-ez-text placeholder:text-ez-placeholder focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/10 transition-all"
              placeholder="IMEI, marque, modèle..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ez-placeholder animate-spin" />}
          </div>

          {/* Search results dropdown */}
          {results.length > 0 && (
            <div className="mt-2 bg-white border border-ez-border rounded-xl shadow-ez-md overflow-hidden max-h-64 overflow-y-auto">
              {results.map(device => (
                <button
                  key={device._id}
                  onClick={() => addToCart(device)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gold/5 transition-all text-left border-b border-ez-border last:border-0"
                >
                  <div className="w-8 h-8 rounded-lg bg-ez-muted flex items-center justify-center flex-shrink-0">
                    {device._type === 'phone' ? <Smartphone className="w-4 h-4 text-ez-subtle" /> : <LaptopIcon className="w-4 h-4 text-ez-subtle" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ez-text truncate">{device._displayName}</p>
                    <p className="text-xs text-ez-subtle">{(device as Phone).imei || (device as Laptop).serial || '—'}</p>
                  </div>
                  {canSeePrices && (
                    <span className="text-sm font-bold text-gold flex-shrink-0">
                      {formatMAD((device as Phone).prix_vente_recommande || 0)}
                    </span>
                  )}
                  <Plus className="w-4 h-4 text-ez-subtle flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="flex-1 overflow-y-auto p-6">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <ShoppingCart className="w-10 h-10 text-ez-border mb-3" />
              <p className="text-ez-subtle text-sm">Panier vide</p>
              <p className="text-ez-placeholder text-xs mt-1">Recherchez un appareil ci-dessus</p>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.map(item => (
                <div key={item._id} className="bg-white border border-ez-border rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-ez-muted flex items-center justify-center flex-shrink-0">
                      {item._type === 'phone' ? <Smartphone className="w-4 h-4 text-ez-subtle" /> : <LaptopIcon className="w-4 h-4 text-ez-subtle" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-ez-text truncate">{item._displayName}</p>
                      <p className="text-xs text-ez-subtle">{(item as Phone).imei || (item as Laptop).serial || '—'}</p>
                    </div>
                    <button onClick={() => removeFromCart(item._id)} className="p-1 rounded-lg text-ez-subtle hover:text-red-500 hover:bg-red-50 transition-all">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1">
                      <label className="text-[10px] text-ez-subtle uppercase tracking-widest">Prix de vente (MAD)</label>
                      <input
                        type="number"
                        className={`${inputClass} mt-1 font-bold text-base`}
                        value={item.prix_vente_saisi || ''}
                        onChange={e => updatePrice(item._id, Number(e.target.value))}
                      />
                    </div>
                    {canSeePrices && (item as Phone).prix_achat && (
                      <div className="text-right">
                        <p className="text-[10px] text-ez-subtle">Marge</p>
                        <p className={`text-sm font-bold ${item.prix_vente_saisi - ((item as Phone).prix_achat || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {formatMAD(item.prix_vente_saisi - ((item as Phone).prix_achat || 0))}
                        </p>
                      </div>
                    )}
                  </div>
                  {/* Below min warning */}
                  {isBelowMinimum(item.prix_vente_saisi, (item as Phone).prix_vente_minimum) && (
                    <div className="mt-2 flex items-center gap-2 text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Sous le prix minimum ({formatMAD((item as Phone).prix_vente_minimum || 0)})
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right — Sale form */}
      <div className="w-full lg:w-96 flex flex-col bg-ez-bg border-t lg:border-t-0 border-ez-border overflow-y-auto">
        <div className="p-6 space-y-5">

          {/* Client */}
          <div>
            <p className="text-xs font-bold text-ez-subtle uppercase tracking-widest mb-3 flex items-center gap-2">
              <User className="w-3.5 h-3.5" /> Client
            </p>
            <div className="space-y-2">
              <input className={inputClass} placeholder="Nom client" value={saleForm.client_nom} onChange={e => setSale('client_nom', e.target.value)} />
              <input className={inputClass} placeholder="06XXXXXXXX *" value={saleForm.client_tel} onChange={e => setSale('client_tel', e.target.value)} />
            </div>
          </div>

          {/* Operation type */}
          <div>
            <p className="text-xs font-bold text-ez-subtle uppercase tracking-widest mb-3 flex items-center gap-2">
              <ArrowLeftRight className="w-3.5 h-3.5" /> Type d'opération
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(['بيع','إستبدال','تسبيق'] as OperationType[]).map(op => (
                <button key={op} onClick={() => setSale('type_operation', op)}
                  className={`py-2 rounded-xl text-xs font-medium border transition-all ${
                    saleForm.type_operation === op
                      ? 'bg-gold text-white border-gold'
                      : 'bg-white border-ez-border text-ez-subtle hover:border-gold/30'
                  }`}>
                  {op === 'بيع' ? 'Vente' : op === 'إستبدال' ? 'Échange' : 'Avance'}
                </button>
              ))}
            </div>
          </div>

          {/* Exchange block */}
          {saleForm.type_operation === 'إستبدال' && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3 animate-fade-in">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-widest">Appareil échangé</p>
              <input className={inputClass} placeholder="Marque" value={saleForm.marque_echange} onChange={e => setSale('marque_echange', e.target.value)} />
              <input className={inputClass} placeholder="Modèle" value={saleForm.model_echange} onChange={e => setSale('model_echange', e.target.value)} />
              <input className={inputClass} placeholder="IMEI" value={saleForm.imei_echange} onChange={e => setSale('imei_echange', e.target.value)} />
              <div>
                <label className="text-xs text-ez-subtle">Valeur échange (MAD)</label>
                <input type="number" className={`${inputClass} mt-1`} value={saleForm.valeur_echange || ''} onChange={e => setSale('valeur_echange', Number(e.target.value))} />
              </div>
            </div>
          )}

          {/* Payment method */}
          <div>
            <p className="text-xs font-bold text-ez-subtle uppercase tracking-widest mb-3 flex items-center gap-2">
              <CreditCard className="w-3.5 h-3.5" /> Paiement
            </p>
            <select className={selectClass} value={saleForm.payment_method} onChange={e => setSale('payment_method', e.target.value as PaymentMethod)}>
              <option value="نقد">Espèces (نقد)</option>
              <option value="تحويل">Virement (تحويل)</option>
              <option value="تسبيق">Avance (تسبيق)</option>
              <option value="إستبدال">Échange (إستبدال)</option>
              <option value="مختلط">Mixte (مختلط)</option>
            </select>

            {saleForm.payment_method === 'تحويل' && (
              <input className={`${inputClass} mt-2`} placeholder="Référence virement *" value={saleForm.payment_ref} onChange={e => setSale('payment_ref', e.target.value)} />
            )}
            {saleForm.payment_method === 'تسبيق' && (
              <input type="number" className={`${inputClass} mt-2`} placeholder="Montant avance (MAD)" value={saleForm.avance || ''} onChange={e => setSale('avance', Number(e.target.value))} />
            )}
            {saleForm.payment_method === 'مختلط' && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <input type="number" className={inputClass} placeholder="Espèces" value={saleForm.montant_especes || ''} onChange={e => setSale('montant_especes', Number(e.target.value))} />
                <input type="number" className={inputClass} placeholder="Virement" value={saleForm.montant_carte || ''} onChange={e => setSale('montant_carte', Number(e.target.value))} />
              </div>
            )}
          </div>

          {/* Notes */}
          <textarea className={`${inputClass} resize-none text-xs`} rows={2} placeholder="Notes..." value={saleForm.notes} onChange={e => setSale('notes', e.target.value)} />

          {/* Summary */}
          <div className="bg-white border border-ez-border rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-ez-subtle">Total panier</span>
              <span className="font-bold text-ez-text">{formatMAD(totalVente)}</span>
            </div>
            {saleForm.avance > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-ez-subtle">Avance</span>
                <span className="text-ez-text">- {formatMAD(saleForm.avance)}</span>
              </div>
            )}
            {saleForm.valeur_echange > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-ez-subtle">Valeur échange</span>
                <span className="text-ez-text">- {formatMAD(saleForm.valeur_echange)}</span>
              </div>
            )}
            <div className="flex justify-between text-base pt-2 border-t border-ez-border">
              <span className="font-bold text-ez-text">Reste à payer</span>
              <div className="text-right">
                <p className="font-display font-bold text-xl text-gold">{formatMAD(fariq)}</p>
                <StatusBadge status={statutPaiement} />
              </div>
            </div>
          </div>

          {/* Submit */}
          <Btn
            variant="primary"
            size="lg"
            className="w-full font-display text-base tracking-wider"
            onClick={handleSubmit}
            loading={submitting}
            disabled={cart.length === 0}
          >
            {isAr ? 'إتمام البيع' : 'Finaliser la vente'}
          </Btn>
        </div>
      </div>

      {/* Override PIN modal */}
      <Modal open={overrideOpen} onClose={() => { setOverrideOpen(false); setOverridePin('') }} title="Dérogation prix minimum" size="sm">
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl p-4">
            <Lock className="w-5 h-5 text-orange-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-orange-800">Prix sous le minimum autorisé</p>
              <p className="text-xs text-orange-600 mt-0.5">Un manager ou propriétaire doit saisir son code PIN</p>
            </div>
          </div>
          <Field label="Code PIN (4 chiffres)">
            <input
              type="password"
              maxLength={4}
              className={`${inputClass} text-center text-2xl tracking-[0.5em] font-mono`}
              value={overridePin}
              onChange={e => setOverridePin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              autoFocus
            />
          </Field>
          <div className="flex gap-3 justify-end">
            <Btn variant="secondary" onClick={() => { setOverrideOpen(false); setOverridePin('') }}>Annuler</Btn>
            <Btn variant="primary" onClick={verifyOverride} loading={overrideLoading} disabled={overridePin.length !== 4}>
              Confirmer
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}