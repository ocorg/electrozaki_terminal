'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, computeFariq, computeStatutPaiement, isBelowMinimum } from '@/lib/utils'
import { Modal, Field, inputClass, selectClass, Btn, PageHeader } from '@/components/shared'
import { StatusBadge } from '@/components/shared'
import { toast } from 'sonner'
import type { Phone, Laptop, PaymentMethod, OperationType } from '@/types/database'
import ScanButton from '@/components/scanner/ScanButton'
import {
  Search, ShoppingCart, User, CreditCard, ArrowLeftRight,
  X, Plus, AlertTriangle, Loader2, CheckCircle,
  Smartphone, Laptop as LaptopIcon, Package, Lock,
  Printer, RotateCcw
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────
type DeviceResult = (Phone | Laptop) & {
  _type:        'phone' | 'laptop' | 'accessory'
  _displayName: string
  _id:          string
}

type CartItem = DeviceResult & {
  prix_vente_saisi: number
}

interface SaleForm {
  client_nom:          string
  client_tel:          string
  type_operation:      OperationType
  payment_method:      PaymentMethod
  montant_especes:     number
  montant_carte:       number
  avance:              number
  payment_ref:         string
  valeur_echange:      number
  marque_echange:      string
  model_echange:       string
  imei_echange:        string
  description_echange: string
  notes:               string
}

const EMPTY_SALE: SaleForm = {
  client_nom: '', client_tel: '',
  type_operation:  'بيع',
  payment_method:  'نقد',
  montant_especes: 0, montant_carte: 0,
  avance: 0, payment_ref: '',
  valeur_echange: 0, marque_echange: '', model_echange: '',
  imei_echange: '', description_echange: '', notes: '',
}

interface POSModuleProps {
  storeId:    string
  hasLaptops?: boolean   // EZ = true, HP = false
}

// ─── Component ───────────────────────────────────────────────
export default function POSModule({ storeId, hasLaptops = true }: POSModuleProps) {
  const { user }     = useUser()
  const { language } = useLanguageStore()
  const portal       = usePortal()
  const isAr         = language === 'ar'
  const primary      = portal.primaryColor
  const canSeePrices = user?.role !== 'staff'

  const [search, setSearch]       = useState('')
  const [results, setResults]     = useState<DeviceResult[]>([])
  const [searching, setSearching] = useState(false)
  const [cart, setCart]           = useState<CartItem[]>([])
  const [saleForm, setSaleForm]   = useState<SaleForm>({ ...EMPTY_SALE })

  const [overrideOpen, setOverrideOpen]     = useState(false)
  const [overridePin, setOverridePin]       = useState('')
  const [overrideItem, setOverrideItem]     = useState<CartItem | null>(null)
  const [overrideLoading, setOverrideLoading] = useState(false)

  const [submitting, setSubmitting]   = useState(false)
  // Exchange intake panel (shown after successful sale with exchange)
  const [exchangePanel, setExchangePanel] = useState<{
    open: boolean
    txn_id: string
    valeur_echange: number
    marque_echange: string
    model_echange: string
    imei_echange: string
  } | null>(null)
  const [exchangeForm, setExchangeForm] = useState({
    modele: '', imei: '', marque: '', prix_achat: 0, couleur: '', capacite: '',
  })
  const [addingExchange, setAddingExchange] = useState(false)
  const [addedPhoneId, setAddedPhoneId] = useState<string | null>(null)
  const [successTxn, setSuccessTxn]   = useState<string | null>(null)
  const searchRef = useRef<ReturnType<typeof setTimeout>>()

  // ── Device search ─────────────────────────────────────────
  useEffect(() => {
    if (!search.trim() || search.length < 2) { setResults([]); return }
    clearTimeout(searchRef.current)
    setSearching(true)
    searchRef.current = setTimeout(async () => {
      try {
        const q = encodeURIComponent(search)
        const requests = [
          fetch(`/api/phones?status=متوفر&search=${q}&store_id=${storeId}`),
        ]
        if (hasLaptops) {
          requests.push(fetch(`/api/laptops?status=متوفر&search=${q}&store_id=${storeId}`))
        }

        const responses = await Promise.all(requests)
        const [pJson, lJson] = await Promise.all(responses.map(r => r.json()))

        const phones: DeviceResult[] = (pJson.data || []).map((p: Phone) => ({
          ...p,
          _type:        'phone' as const,
          _displayName: `${p.marque} ${p.model}${p.stockage ? ' ' + p.stockage : ''}${p.couleur ? ' · ' + p.couleur : ''}`,
          _id:          p.phone_id,
        }))

        const laptops: DeviceResult[] = hasLaptops
          ? ((lJson?.data || []).map((l: Laptop) => ({
              ...l,
              _type:        'laptop' as const,
              _displayName: `${l.marque} ${l.model}${l.stockage ? ' ' + l.stockage : ''}`,
              _id:          l.laptop_id,
            })))
          : []

        setResults([...phones, ...laptops])
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [search, storeId, hasLaptops])

  // ── Cart helpers ──────────────────────────────────────────
  function addToCart(device: DeviceResult) {
    if (cart.find(c => c._id === device._id)) {
      toast.error(isAr ? 'موجود في السلة' : 'Déjà dans le panier')
      return
    }
    const prix = (device as Phone).prix_vente_recommande || 0
    setCart(prev => [...prev, { ...device, prix_vente_saisi: prix }])
    setSearch('')
    setResults([])
    toast.success(isAr ? 'أضيف للسلة' : 'Ajouté au panier')
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

  // ── Override PIN ──────────────────────────────────────────
  async function verifyOverride() {
    if (!overridePin || overridePin.length !== 4) {
      toast.error(isAr ? 'يلزم كود PIN من 4 أرقام' : 'Code PIN 4 chiffres requis')
      return
    }
    setOverrideLoading(true)
    try {
      const res  = await fetch('/api/auth/verify-override', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pin: overridePin }),
      })
      const json = await res.json()
      if (!json.authorized) throw new Error(isAr ? 'كود غلط' : 'Code incorrect')
      if (overrideItem) {
        setCart(prev => prev.map(c =>
          c._id === overrideItem._id
            ? { ...c, prix_vente_saisi: overrideItem.prix_vente_saisi }
            : c
        ))
      }
      toast.success(isAr ? 'تمت الموافقة ✓' : 'Dérogation autorisée ✓')
      setOverrideOpen(false)
      setOverridePin('')
      setOverrideItem(null)
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setOverrideLoading(false)
    }
  }

  // ── Form helpers ──────────────────────────────────────────
  function setSale(k: keyof SaleForm, v: unknown) {
    setSaleForm(prev => ({ ...prev, [k]: v }))
  }

  const totalVente     = cart.reduce((s, c) => s + c.prix_vente_saisi, 0)
  const fariq          = computeFariq(
    totalVente,
    saleForm.avance,
    saleForm.type_operation === 'إستبدال' ? saleForm.valeur_echange : 0
  )
  const statutPaiement = computeStatutPaiement(fariq)

  // ── Submit sale ───────────────────────────────────────────
  async function handleSubmit() {
    if (cart.length === 0) { toast.error(isAr ? 'السلة فارغة' : 'Panier vide'); return }
    if (!saleForm.client_tel) { toast.error(isAr ? 'هاتف العميل مطلوب' : 'Téléphone client obligatoire'); return }
    if (saleForm.payment_method === 'تحويل' && !saleForm.payment_ref) {
      toast.error(isAr ? 'مرجع التحويل مطلوب' : 'Référence virement obligatoire')
      return
    }

    setSubmitting(true)
    try {
      // Create / find client
      const cRes  = await fetch('/api/clients', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          nom:       saleForm.client_nom || saleForm.client_tel,
          telephone: saleForm.client_tel,
          store_id:  storeId,
        }),
      })
      const cJson    = await cRes.json()
      const clientId = cJson.data?.client_id

      let lastTxnId: string | null = null

      for (const item of cart) {
        const txnData = {
          store_id:       storeId,
          device_type:    item._type === 'phone' ? 'هاتف' : item._type === 'laptop' ? 'لابتوب' : 'إكسسوار',
          device_id:      item._id,
          client_id:      clientId,
          type_operation: saleForm.type_operation,
          prix_vente:     item.prix_vente_saisi,
          payment_method: saleForm.payment_method,
          avance:         saleForm.avance || 0,
          payment_ref:    saleForm.payment_ref   || undefined,
          montant_especes: saleForm.montant_especes || 0,
          montant_carte:  saleForm.montant_carte  || 0,
          valeur_echange: saleForm.type_operation === 'إستبدال' ? saleForm.valeur_echange : 0,
          marque_echange: saleForm.marque_echange || undefined,
          model_echange:  saleForm.model_echange  || undefined,
          imei_echange:   saleForm.imei_echange   || undefined,
          description_echange: saleForm.description_echange || undefined,
          warranty_start: new Date().toISOString().split('T')[0],
          notes:          saleForm.notes          || undefined,
        }

        const res  = await fetch('/api/transactions', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(txnData),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        lastTxnId = json.data.txn_id
      }

      setSuccessTxn(lastTxnId)
      toast.success(isAr ? 'تمت عملية البيع ✓' : 'Vente enregistrée ✓')

      // Check if exchange device needs intake
      if (saleForm.valeur_echange > 0) {
        setExchangePanel({
          open:           true,
          txn_id:         lastTxnId || '',
          valeur_echange: saleForm.valeur_echange,
          marque_echange: saleForm.marque_echange ?? '',
          model_echange:  saleForm.model_echange  ?? '',
          imei_echange:   saleForm.imei_echange   ?? '',
        })
        setExchangeForm({
          modele:      saleForm.model_echange  ?? '',
          imei:        saleForm.imei_echange   ?? '',
          marque:      saleForm.marque_echange ?? '',
          prix_achat:  saleForm.valeur_echange,
          couleur:     '',
          capacite:    '',
        })
        setAddedPhoneId(null)
      }
      setCart([])
      setSaleForm({ ...EMPTY_SALE })
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success screen ─────────────────────────────────────────
  if (successTxn) return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="text-center bg-white border border-[#E8E5DE] rounded-2xl p-10 max-w-sm shadow-lg">
        <CheckCircle className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
        <h2 className="font-display text-2xl font-bold text-[#1A1A1A] mb-1">
          {isAr ? 'تم تسجيل البيع' : 'Vente enregistrée'}
        </h2>
        <p className="text-[#6B6860] text-sm mb-6">
          {isAr ? `معاملة رقم ${successTxn}` : `Transaction ${successTxn}`}
        </p>
        <div className="flex gap-3 justify-center">
          <Btn variant="secondary" onClick={() => setSuccessTxn(null)}>
            <RotateCcw className="w-4 h-4" />
            {isAr ? 'بيع جديد' : 'Nouvelle vente'}
          </Btn>
          <Btn
            variant="primary"
            onClick={() => window.print()}
            style={{ backgroundColor: primary } as React.CSSProperties}
          >
            <Printer className="w-4 h-4" />
            {isAr ? 'طباعة الفاتورة' : 'Imprimer reçu'}
          </Btn>
        </div>
      </div>
    </div>
  )

  // ── Main POS layout ───────────────────────────────────────
  return (
    <div className="h-full flex flex-col lg:flex-row overflow-hidden animate-fade-in"
         dir={isAr ? 'rtl' : 'ltr'}>

      {/* ── LEFT: Search + Cart ─────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-[#E8E5DE]">

        {/* Search header */}
        <div className="p-5 border-b border-[#E8E5DE] flex-shrink-0 space-y-3">
          <PageHeader
            title={isAr ? 'نقطة البيع' : 'Point de vente'}
            subtitle={isAr ? 'ابحث عن جهاز لإضافته للسلة' : 'Recherchez un appareil à vendre'}
          />

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
              <input
                className="w-full pl-9 pr-10 py-3 bg-white border border-[#E8E5DE] rounded-xl text-sm placeholder:text-[#B0ADA6] focus:outline-none transition-all"
                placeholder={isAr ? 'IMEI، ماركة، موديل...' : 'IMEI, marque, modèle...'}
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
                onFocus={e => { e.target.style.borderColor = primary; e.target.style.boxShadow = `0 0 0 3px ${primary}20` }}
                onBlur={e => { e.target.style.borderColor = '#E8E5DE'; e.target.style.boxShadow = 'none' }}
              />
              {searching
                ? <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6] animate-spin" />
                : search && (
                    <button onClick={() => { setSearch(''); setResults([]) }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B0ADA6] hover:text-[#1A1A1A]">
                      <X className="w-4 h-4" />
                    </button>
                  )
              }
            </div>
            <ScanButton
              onScan={v => setSearch(v)}
              hint="Scannez un IMEI pour trouver l'appareil"
              color={primary}
            />
          </div>

          {/* Search dropdown */}
          {results.length > 0 && (
            <div className="bg-white border border-[#E8E5DE] rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
              {results.map(device => (
                <button
                  key={device._id}
                  onClick={() => addToCart(device)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F8F7F4] transition-all text-left border-b border-[#F2F0EB] last:border-0"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                       style={{ backgroundColor: `${primary}15` }}>
                    {device._type === 'phone'
                      ? <Smartphone className="w-4 h-4" style={{ color: primary }} />
                      : <LaptopIcon className="w-4 h-4" style={{ color: primary }} />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A] truncate">{device._displayName}</p>
                    <p className="text-xs text-[#B0ADA6]">
                      {(device as Phone).imei || (device as Laptop).serial || '—'}
                      {' · '}
                      <span className="text-emerald-600">{isAr ? 'متوفر' : 'Disponible'}</span>
                    </p>
                  </div>
                  {canSeePrices && (
                    <span className="text-sm font-bold flex-shrink-0" style={{ color: primary }}>
                      {formatMAD((device as Phone).prix_vente_recommande || 0)}
                    </span>
                  )}
                  <Plus className="w-4 h-4 text-[#B0ADA6] flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="flex-1 overflow-y-auto p-5">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                   style={{ backgroundColor: `${primary}12` }}>
                <ShoppingCart className="w-8 h-8" style={{ color: `${primary}60` }} />
              </div>
              <p className="text-[#6B6860] text-sm font-medium">
                {isAr ? 'السلة فارغة' : 'Panier vide'}
              </p>
              <p className="text-[#B0ADA6] text-xs mt-1">
                {isAr ? 'ابحث عن جهاز أعلاه' : 'Recherchez un appareil ci-dessus'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.map(item => (
                <div key={item._id} className="bg-white border border-[#E8E5DE] rounded-2xl p-4 shadow-sm">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                         style={{ backgroundColor: `${primary}12` }}>
                      {item._type === 'phone'
                        ? <Smartphone className="w-4 h-4" style={{ color: primary }} />
                        : <LaptopIcon className="w-4 h-4" style={{ color: primary }} />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-[#1A1A1A] truncate">{item._displayName}</p>
                      <p className="text-xs text-[#B0ADA6]">
                        {(item as Phone).imei || (item as Laptop).serial || '—'}
                      </p>
                    </div>
                    <button
                      onClick={() => removeFromCart(item._id)}
                      className="p-1.5 rounded-lg text-[#B0ADA6] hover:text-red-500 hover:bg-red-50 transition-all"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="text-[10px] text-[#6B6860] uppercase tracking-widest">
                        {isAr ? 'سعر البيع (درهم)' : 'Prix de vente (MAD)'}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className={`${inputClass} mt-1 font-bold text-base`}
                        value={item.prix_vente_saisi || ''}
                        onChange={e => updatePrice(item._id, Number(e.target.value))}
                      />
                    </div>
                    {canSeePrices && (item as Phone).prix_achat && (
                      <div className="text-right pb-2.5 flex-shrink-0">
                        <p className="text-[10px] text-[#B0ADA6]">{isAr ? 'الهامش' : 'Marge'}</p>
                        <p className={`text-sm font-bold ${
                          item.prix_vente_saisi - ((item as Phone).prix_achat || 0) >= 0
                            ? 'text-emerald-600' : 'text-red-500'
                        }`}>
                          {formatMAD(item.prix_vente_saisi - ((item as Phone).prix_achat || 0))}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Below minimum warning */}
                  {isBelowMinimum(item.prix_vente_saisi, (item as Phone).prix_vente_minimum) && (
                    <div className="mt-2 flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      {isAr
                        ? `أقل من الحد الأدنى (${formatMAD((item as Phone).prix_vente_minimum || 0)})`
                        : `Sous le prix minimum (${formatMAD((item as Phone).prix_vente_minimum || 0)})`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Sale form ─────────────────────────────── */}
      <div className="w-full lg:w-96 flex flex-col bg-[#F8F7F4] border-t lg:border-t-0 border-[#E8E5DE] overflow-y-auto">
        <div className="p-5 space-y-5">

          {/* Client */}
          <div>
            <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-3 flex items-center gap-2">
              <User className="w-3.5 h-3.5" />
              {isAr ? 'العميل' : 'Client'}
            </p>
            <div className="space-y-2">
              <input
                className={inputClass}
                placeholder={isAr ? 'الاسم (اختياري)' : 'Nom (optionnel)'}
                value={saleForm.client_nom}
                onChange={e => setSale('client_nom', e.target.value)}
              />
              <input
                className={inputClass}
                placeholder={isAr ? '06XXXXXXXX *' : '06XXXXXXXX *'}
                value={saleForm.client_tel}
                onChange={e => setSale('client_tel', e.target.value)}
                type="tel"
              />
            </div>
          </div>

          {/* Operation type */}
          <div>
            <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-3 flex items-center gap-2">
              <ArrowLeftRight className="w-3.5 h-3.5" />
              {isAr ? 'نوع العملية' : "Type d'opération"}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(['بيع', 'إستبدال', 'تسبيق'] as OperationType[]).map(op => (
                <button
                  key={op}
                  onClick={() => setSale('type_operation', op)}
                  className="py-2.5 rounded-xl text-xs font-bold border transition-all"
                  style={{
                    backgroundColor: saleForm.type_operation === op ? primary : 'white',
                    borderColor:     saleForm.type_operation === op ? primary : '#E8E5DE',
                    color:           saleForm.type_operation === op ? 'white' : '#6B6860',
                  }}
                >
                  {op === 'بيع'
                    ? (isAr ? 'بيع' : 'Vente')
                    : op === 'إستبدال'
                    ? (isAr ? 'إستبدال' : 'Échange')
                    : (isAr ? 'تسبيق' : 'Avance')}
                </button>
              ))}
            </div>
          </div>

          {/* Exchange block */}
          {saleForm.type_operation === 'إستبدال' && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3 animate-fade-in">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-widest">
                {isAr ? 'الجهاز المستبدل' : 'Appareil échangé'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} placeholder={isAr ? 'الماركة' : 'Marque'}
                  value={saleForm.marque_echange} onChange={e => setSale('marque_echange', e.target.value)} />
                <input className={inputClass} placeholder={isAr ? 'الموديل' : 'Modèle'}
                  value={saleForm.model_echange} onChange={e => setSale('model_echange', e.target.value)} />
              </div>
              <input className={inputClass} placeholder="IMEI"
                value={saleForm.imei_echange} onChange={e => setSale('imei_echange', e.target.value)} />
              <div>
                <label className="text-xs text-[#6B6860]">
                  {isAr ? 'قيمة الاستبدال (درهم)' : 'Valeur échange (MAD)'}
                </label>
                <input type="number" className={`${inputClass} mt-1`}
                  value={saleForm.valeur_echange || ''}
                  onChange={e => setSale('valeur_echange', Number(e.target.value))} />
              </div>
            </div>
          )}

          {/* Payment */}
          <div>
            <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-3 flex items-center gap-2">
              <CreditCard className="w-3.5 h-3.5" />
              {isAr ? 'طريقة الدفع' : 'Paiement'}
            </p>
            <select
              className={selectClass}
              value={saleForm.payment_method}
              onChange={e => setSale('payment_method', e.target.value as PaymentMethod)}
            >
              <option value="نقد">{isAr ? 'نقداً' : 'Espèces (نقد)'}</option>
              <option value="تحويل">{isAr ? 'تحويل بنكي' : 'Virement (تحويل)'}</option>
              <option value="تسبيق">{isAr ? 'تسبيق' : 'Avance (تسبيق)'}</option>
              <option value="إستبدال">{isAr ? 'استبدال' : 'Échange (إستبدال)'}</option>
              <option value="مختلط">{isAr ? 'مختلط' : 'Mixte (مختلط)'}</option>
            </select>

            {saleForm.payment_method === 'تحويل' && (
              <input className={`${inputClass} mt-2`}
                placeholder={isAr ? 'مرجع التحويل *' : 'Référence virement *'}
                value={saleForm.payment_ref}
                onChange={e => setSale('payment_ref', e.target.value)} />
            )}
            {saleForm.payment_method === 'تسبيق' && (
              <input type="number" className={`${inputClass} mt-2`}
                placeholder={isAr ? 'مبلغ التسبيق (درهم)' : 'Montant avance (MAD)'}
                value={saleForm.avance || ''}
                onChange={e => setSale('avance', Number(e.target.value))} />
            )}
            {saleForm.payment_method === 'مختلط' && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <input type="number" className={inputClass}
                  placeholder={isAr ? 'نقد' : 'Espèces'}
                  value={saleForm.montant_especes || ''}
                  onChange={e => setSale('montant_especes', Number(e.target.value))} />
                <input type="number" className={inputClass}
                  placeholder={isAr ? 'تحويل' : 'Virement'}
                  value={saleForm.montant_carte || ''}
                  onChange={e => setSale('montant_carte', Number(e.target.value))} />
              </div>
            )}
          </div>

          {/* Notes */}
          <textarea
            className={`${inputClass} resize-none text-xs`}
            rows={2}
            placeholder={isAr ? 'ملاحظات...' : 'Notes...'}
            value={saleForm.notes}
            onChange={e => setSale('notes', e.target.value)}
          />

          {/* Summary */}
          <div className="bg-white border border-[#E8E5DE] rounded-2xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[#6B6860]">{isAr ? 'مجموع السلة' : 'Total panier'}</span>
              <span className="font-bold text-[#1A1A1A]">{formatMAD(totalVente)}</span>
            </div>
            {saleForm.avance > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[#6B6860]">{isAr ? 'التسبيق' : 'Avance'}</span>
                <span className="text-[#1A1A1A]">- {formatMAD(saleForm.avance)}</span>
              </div>
            )}
            {saleForm.type_operation === 'إستبدال' && saleForm.valeur_echange > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[#6B6860]">{isAr ? 'قيمة الاستبدال' : 'Valeur échange'}</span>
                <span className="text-[#1A1A1A]">- {formatMAD(saleForm.valeur_echange)}</span>
              </div>
            )}
            <div className="flex justify-between items-end pt-2 border-t border-[#E8E5DE]">
              <span className="font-bold text-[#1A1A1A]">{isAr ? 'المتبقي للدفع' : 'Reste à payer'}</span>
              <div className="text-right">
                <p className="font-display font-bold text-xl" style={{ color: primary }}>
                  {formatMAD(fariq)}
                </p>
                <StatusBadge status={statutPaiement} />
              </div>
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || cart.length === 0}
            className="w-full py-4 rounded-2xl font-display font-bold text-lg tracking-wider text-white transition-all active:scale-[0.98] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{
              backgroundColor: primary,
              boxShadow: `0 4px 16px ${primary}40`,
            }}
          >
            {submitting
              ? <><Loader2 className="w-5 h-5 animate-spin" /> {isAr ? 'جارٍ التسجيل...' : 'Traitement...'}</>
              : (isAr ? 'إتمام البيع' : 'Finaliser la vente')
            }
          </button>
        </div>
      </div>

      {/* Override PIN modal */}
      <Modal
        open={overrideOpen}
        onClose={() => { setOverrideOpen(false); setOverridePin('') }}
        title={isAr ? 'تجاوز السعر الأدنى' : 'Dérogation prix minimum'}
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <Lock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                {isAr ? 'السعر أقل من الحد الأدنى' : 'Prix sous le minimum autorisé'}
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                {isAr
                  ? 'يلزم كود PIN من المدير أو المالك'
                  : 'Un manager ou propriétaire doit saisir son code PIN'}
              </p>
            </div>
          </div>
          <Field label={isAr ? 'كود PIN (4 أرقام)' : 'Code PIN (4 chiffres)'}>
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
            <Btn variant="secondary" onClick={() => { setOverrideOpen(false); setOverridePin('') }}>
              {isAr ? 'إلغاء' : 'Annuler'}
            </Btn>
            <Btn
              variant="primary"
              onClick={verifyOverride}
              loading={overrideLoading}
              disabled={overridePin.length !== 4}
              style={{ backgroundColor: primary } as React.CSSProperties}
            >
              {isAr ? 'تأكيد' : 'Confirmer'}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
  // ── Render exchange intake panel ─────────────────────────
  // Inline component for post-sale exchange intake
  function ExchangeIntakePanel() {
    if (!exchangePanel?.open) return null

    async function handleAddToStock() {
      if (!exchangeForm.modele || !exchangeForm.imei) {
        toast.error(isAr ? 'الموديل والرقم التسلسلي مطلوبان' : 'Modèle et IMEI requis')
        return
      }
      setAddingExchange(true)
      try {
        const res = await fetch('/api/phones', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            marque:        exchangeForm.marque || 'Inconnu',
            model:         exchangeForm.modele,
            imei:          exchangeForm.imei,
            prix_achat:    exchangeForm.prix_achat,
            couleur:       exchangeForm.couleur || null,
            stockage:      exchangeForm.capacite || null,
            condition:     'مستعمل',
            source:        'Échange',
            status:        'متوفر',
            location:      'Magasin Principal',
            txn_ref_id:    exchangePanel?.txn_id,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        setAddedPhoneId(json.data.phone_id)
        toast.success(`${isAr ? 'أضيف إلى المخزون' : 'Ajouté au stock'}: ${json.data.phone_id}`)
        setExchangePanel(p => p ? { ...p, open: false } : null)
      } catch (err: unknown) {
        toast.error((err as Error).message)
      } finally {
        setAddingExchange(false)
      }
    }

    return (
      <div className="mt-4 border border-amber-200 bg-amber-50 rounded-xl p-4 animate-fade-in">
        <p className="text-sm font-bold text-amber-800 mb-3">
          {isAr ? 'إضافة الجهاز المستلم إلى المخزون؟' : 'Ajouter l\'appareil repris à l\'inventaire ?'}
        </p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-amber-700 font-medium">{isAr ? 'الماركة' : 'Marque'}</label>
            <input className="w-full mt-1 border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white"
              value={exchangeForm.marque}
              onChange={e => setExchangeForm(p => ({ ...p, marque: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-amber-700 font-medium">{isAr ? 'الموديل' : 'Modèle'} *</label>
            <input className="w-full mt-1 border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white"
              value={exchangeForm.modele}
              onChange={e => setExchangeForm(p => ({ ...p, modele: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-amber-700 font-medium">IMEI *</label>
            <input className="w-full mt-1 border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white font-mono"
              value={exchangeForm.imei}
              onChange={e => setExchangeForm(p => ({ ...p, imei: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-amber-700 font-medium">{isAr ? 'سعر الشراء (درهم)' : 'Prix achat (MAD)'}</label>
            <input type="number" className="w-full mt-1 border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white"
              value={exchangeForm.prix_achat}
              onChange={e => setExchangeForm(p => ({ ...p, prix_achat: Number(e.target.value) }))} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAddToStock}
            disabled={addingExchange}
            className="px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-all disabled:opacity-50"
          >
            {addingExchange
              ? (isAr ? 'جارٍ الإضافة...' : 'Ajout en cours...')
              : (isAr ? 'إضافة إلى المخزون' : 'Ajouter au stock')}
          </button>
          <button
            onClick={() => setExchangePanel(p => p ? { ...p, open: false } : null)}
            className="px-4 py-2 rounded-xl border border-amber-200 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-all"
          >
            {isAr ? 'تجاهل' : 'Ignorer'}
          </button>
        </div>
      </div>
    )
  }
}