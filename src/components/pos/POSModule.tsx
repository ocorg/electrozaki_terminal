'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useCategories } from '@/lib/hooks/useCategories'
import { useLanguageStore } from '@/lib/stores/language'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, computeFariq, computeStatutPaiement, isBelowMinimum } from '@/lib/utils'
import { Modal, Field, inputClass, selectClass, Btn, PageHeader } from '@/components/shared'
import { StatusBadge } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import type { Phone, Laptop, PaymentMethod, OperationType } from '@/types/database'
import ScanButton from '@/components/scanner/ScanButton'
import ComboBox from '@/components/phones/ComboBox'
import RetourModal from '@/components/pos/RetourModal'
import { ReceiptPrint, type ReceiptData } from '@/components/print/ReceiptGenerator'
import { usePhoneCatalog } from '@/lib/hooks/usePhoneCatalog'
import {
  Search, ShoppingCart, User, CreditCard, ArrowLeftRight,
  X, Plus, AlertTriangle, Loader2, CheckCircle,
  Smartphone, Laptop as LaptopIcon, Package, Lock,
  Printer, RotateCcw, Wallet
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
  client_nom:               string
  client_tel:               string
  type_operation:           OperationType
  payment_method:           PaymentMethod
  avance_sub_method:        'نقد' | 'تحويل' | ''
  montant_especes:          number
  montant_carte:            number
  avance:                   number
  payment_ref:              string
  valeur_echange:           number
  marque_echange:           string
  model_echange:            string
  imei_echange:             string
  description_echange:      string
  notes:                    string
  couleur_echange?:         string
  stockage_echange?:        string
  battery_echange?:         number
  ram_echange?:             string
  prix_vente_echange?:      number
  prix_min_echange?:        number
  echange_vers_reparation?: boolean
}

const EMPTY_SALE: SaleForm = {
  client_nom: '', client_tel: '',
  type_operation:   'بيع',
  payment_method:   'نقد',
  avance_sub_method: '',
  montant_especes: 0, montant_carte: 0,
  avance: 0, payment_ref: '',
  valeur_echange: 0, marque_echange: '', model_echange: '',
  imei_echange: '', description_echange: '', notes: '',
  couleur_echange: '', stockage_echange: '',
  battery_echange: undefined, ram_echange: '',
  prix_vente_echange: undefined, prix_min_echange: undefined,
  echange_vers_reparation: false,
}

interface POSModuleProps {
  storeId:    string
  hasLaptops?: boolean   // EZ = true, HP = false
}

function LiveClock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('fr-FR', {
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  )

  useEffect(() => {
    const id = setInterval(() =>
      setTime(
        new Date().toLocaleTimeString('fr-FR', {
          hour:   '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      )
    , 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <p className="text-xs font-mono font-bold text-[#6B6860] tabular-nums">
      {time}
    </p>
  )
}

// ─── Component ───────────────────────────────────────────────
export default function POSModule({ storeId, hasLaptops = true }: POSModuleProps) {
  const { user }                      = useUser()
  const { accessories: accCategories } = useCategories()
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
  const { brands, seriesFor, modelsFor, couleursFor } = usePhoneCatalog()

  const [overrideOpen, setOverrideOpen]         = useState(false)
  const [overridePin, setOverridePin]           = useState('')
  const [overrideItem, setOverrideItem]         = useState<CartItem | null>(null)
  const [overrideLoading, setOverrideLoading]   = useState(false)
  const [overrideReason, setOverrideReason]     = useState('')
  const [overrideAuthorizedBy, setOverrideAuthorizedBy] = useState<string | null>(null)

  const [submitting, setSubmitting]   = useState(false)
  const [retourOpen, setRetourOpen] = useState(false)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  // Exchange intake panel (shown after successful sale with exchange)
  const [exchangePanel, setExchangePanel] = useState<{
    open:                    boolean
    txn_id:                  string
    valeur_echange:          number
    marque_echange:          string
    model_echange:           string
    imei_echange:            string
    couleur_echange:         string
    stockage_echange:        string
    battery_echange?:        number
    ram_echange:             string
    prix_vente_echange?:     number
    prix_min_echange?:       number
    echange_vers_reparation: boolean
  } | null>(null)
  const [exchangeForm, setExchangeForm] = useState({
    modele: '', imei: '', marque: '', prix_achat: 0, couleur: '', capacite: '',
  })
  const [addingExchange, setAddingExchange] = useState(false)
  const [addedPhoneId, setAddedPhoneId] = useState<string | null>(null)
  const [successTxn, setSuccessTxn]   = useState<string | null>(null)
  const searchRef = useRef<ReturnType<typeof setTimeout>>()

  const [activeCategory, setActiveCategory] = useState('phones')
  const [gridItems,      setGridItems]      = useState<DeviceResult[]>([])
  const [gridLoading,    setGridLoading]    = useState(false)

  // ── Client lookup ──────────────────────────────────────────
  type ClientSuggestion = {
    client_id: string
    nom: string
    telephone: string
    telephone_2?: string | null
    adresse?: string | null
  }
  const [clientSuggestions,    setClientSuggestions]    = useState<ClientSuggestion[]>([])
  const [showClientDropdown,   setShowClientDropdown]   = useState(false)
  const [clientSearching,      setClientSearching]      = useState(false)
  const [selectedClientId,     setSelectedClientId]     = useState<string | null>(null)
  const [clientCredit,         setClientCredit]         = useState<number>(0)
  const [creditApplied,        setCreditApplied]        = useState<number>(0)
  const [creditModalOpen,      setCreditModalOpen]      = useState(false)
  const [creditInputValue,     setCreditInputValue]     = useState('')
  const [cashDropOpen,         setCashDropOpen]         = useState(false)
  const [cashDropAmount,       setCashDropAmount]       = useState('')
  const [cashDropReason,       setCashDropReason]       = useState('')
  const [cashDropSubmitting,   setCashDropSubmitting]   = useState(false)
  const clientSearchRef = useRef<ReturnType<typeof setTimeout>>()

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

  // ── Grid category fetch ────────────────────────────────────
  useEffect(() => {
    if (search) return
    setGridLoading(true)

    async function loadGrid() {
      try {
        if (activeCategory === 'phones') {
          const res  = await fetch(`/api/phones?status=متوفر&store_id=${storeId}&limit=24`)
          const json = await res.json()
          setGridItems(
            (json.data || []).map((p: Phone) => ({
              ...p,
              _type:        'phone' as const,
              _id:          p.phone_id,
              _displayName: [p.marque, p.model, p.stockage, p.couleur ? `· ${p.couleur}` : '']
                .filter(Boolean).join(' '),
            }))
          )
        } else if (activeCategory === 'laptops') {
          const res  = await fetch(`/api/laptops?status=متوفر&store_id=${storeId}&limit=24`)
          const json = await res.json()
          setGridItems(
            (json.data || []).map((l: Laptop) => ({
              ...l,
              _type:        'laptop' as const,
              _id:          l.laptop_id,
              _displayName: [l.marque, l.model, l.stockage].filter(Boolean).join(' '),
            }))
          )
        } else if (activeCategory.startsWith('acc_')) {
          const cat  = activeCategory.replace('acc_', '')
          const res  = await fetch(
            `/api/accessories?store_id=${storeId}&categorie=${encodeURIComponent(cat)}`
          )
          const json = await res.json()
          setGridItems(
            (json.data || []).map((a: Record<string, unknown>) => ({
              ...a,
              _type:        'accessory' as const,
              _id:          a.acc_id as string,
              _displayName: [a.nom, a.marque ? `· ${a.marque}` : ''].filter(Boolean).join(' '),
            }))
          )
        }
      } catch {
        // silent — grid just stays empty
      } finally {
        setGridLoading(false)
      }
    }

    loadGrid()
  }, [activeCategory, storeId, search])

  // ── Cart helpers ──────────────────────────────────────────
  function addToCart(device: DeviceResult) {
    if (cart.find(c => c._id === device._id)) {
      showError(isAr ? 'موجود في السلة' : 'Déjà dans le panier')
      return
    }
    const prix = (device as Phone).prix_vente_recommande || 0
    setCart(prev => [...prev, { ...device, prix_vente_saisi: prix }])
    setSearch('')
    setResults([])
    showSuccess(isAr ? 'أضيف للسلة' : 'Ajouté au panier')
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
      showError(isAr ? 'يلزم كود PIN من 4 أرقام' : 'Code PIN 4 chiffres requis')
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
      if (!overrideReason.trim()) throw new Error(isAr ? 'سبب التجاوز مطلوب' : 'Motif de dérogation obligatoire')
      setOverrideAuthorizedBy(json.user_id ?? null)
      if (overrideItem) {
        setCart(prev => prev.map(c =>
          c._id === overrideItem._id
            ? { ...c, prix_vente_saisi: overrideItem.prix_vente_saisi }
            : c
        ))
      }
      showSuccess(isAr ? 'تمت الموافقة ✓' : 'Dérogation autorisée ✓')
      setOverrideOpen(false)
      setOverridePin('')
      setOverrideItem(null)
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally {
      setOverrideLoading(false)
    }
  }

  // ── Client name change with debounced lookup ───────────────
  function handleClientNameChange(value: string) {
    setSale('client_nom', value)
    setSelectedClientId(null)
    if (!value.trim() || value.length < 1) {
      setClientSuggestions([])
      setShowClientDropdown(false)
      return
    }
    clearTimeout(clientSearchRef.current)
    setClientSearching(true)
    clientSearchRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/clients?search=${encodeURIComponent(value)}&store_id=${storeId}`)
        const json = await res.json()
        setClientSuggestions(json.data || [])
        setShowClientDropdown(true)
      } catch {
        setClientSuggestions([])
      } finally {
        setClientSearching(false)
      }
    }, 200)
  }

  function selectClientSuggestion(c: ClientSuggestion) {
    setSaleForm(prev => ({
      ...prev,
      client_nom: c.nom,
      client_tel: c.telephone,
    }))
    setSelectedClientId(c.client_id)
    setClientSuggestions([])
    setShowClientDropdown(false)
    setCreditApplied(0)
    // Fetch client's outstanding credit balance
    fetch(`/api/clients?search=${encodeURIComponent(c.telephone)}&store_id=${storeId}`)
      .then(r => r.json())
      .then(json => {
        const found = (json.data || []).find((cl: { client_id: string; solde_impaye?: number }) => cl.client_id === c.client_id)
        setClientCredit(found?.solde_impaye ?? 0)
      })
      .catch(() => setClientCredit(0))
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
  const displayFariq   = (saleForm.payment_method === 'تسبيق' || saleForm.payment_method === 'آجل') ? fariq : 0
  const statutPaiement = computeStatutPaiement(displayFariq)
  const montantRendu   = saleForm.payment_method === 'نقد' && saleForm.montant_especes > totalVente
    ? saleForm.montant_especes - totalVente
    : saleForm.payment_method === 'مختلط' && (saleForm.montant_especes + saleForm.montant_carte) > totalVente
    ? (saleForm.montant_especes + saleForm.montant_carte) - totalVente
    : 0

  // ── Submit sale ───────────────────────────────────────────
  async function handleSubmit() {
    if (cart.length === 0) { showError(isAr ? 'السلة فارغة' : 'Panier vide'); return }
    if (!saleForm.client_tel) { showError(isAr ? 'هاتف العميل مطلوب' : 'Téléphone client obligatoire'); return }
    if (saleForm.payment_method === 'تحويل' && !saleForm.payment_ref) {
      showError(isAr ? 'مرجع التحويل مطلوب' : 'Référence virement obligatoire')
      return
    }
    if (saleForm.payment_method === 'تسبيق' && saleForm.avance > 0 && !saleForm.avance_sub_method) {
      showError(isAr ? 'يرجى تحديد طريقة دفع التسبيق (نقد أو تحويل)' : 'Précisez le mode de paiement de l\'avance (espèces ou virement)')
      return
    }
    if (saleForm.payment_method === 'آجل' && !saleForm.client_nom.trim()) {
      showError(isAr ? 'اسم العميل مطلوب للبيع الآجل' : 'Nom du client obligatoire pour une vente à crédit')
      return
    }

    setSubmitting(true)
    try {
      // Use existing client_id if auto-filled, otherwise create / find
      let clientId: string | undefined = selectedClientId ?? undefined
      if (!clientId) {
        const cRes  = await fetch('/api/clients', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            nom:       saleForm.client_nom || saleForm.client_tel,
            telephone: saleForm.client_tel,
            store_id:  storeId,
          }),
        })
        const cJson = await cRes.json()
        clientId    = cJson.data?.client_id
      }

      let lastTxnId: string | null = null

      for (const item of cart) {
        const txnData = {
          store_id:       storeId,
          device_type:    item._type === 'phone' ? 'هاتف' : item._type === 'laptop' ? 'لابتوب' : 'إكسسوار',
          device_id:      item._id,
          client_id:      clientId,
          type_operation: saleForm.type_operation,
          prix_vente:     item.prix_vente_saisi,
          payment_method: saleForm.payment_method === 'تسبيق'
            ? (saleForm.avance_sub_method as PaymentMethod)
            : saleForm.payment_method,
          avance:         saleForm.avance || 0,
          payment_ref:    saleForm.payment_ref   || undefined,
          montant_especes: saleForm.montant_especes || 0,
          montant_carte:  saleForm.montant_carte  || 0,
          valeur_echange: saleForm.type_operation === 'إستبدال' ? saleForm.valeur_echange : 0,
          marque_echange: saleForm.marque_echange || undefined,
          model_echange:  saleForm.model_echange  || undefined,
          imei_echange:   saleForm.imei_echange   || undefined,
          description_echange: saleForm.description_echange || undefined,
          warranty_start:    new Date().toISOString().split('T')[0],
          notes:             saleForm.notes || undefined,
          montant_rendu:     montantRendu > 0 ? montantRendu : 0,
          override_required: overrideAuthorizedBy != null ? true : undefined,
          override_by:       overrideAuthorizedBy ?? undefined,
          override_reason:   overrideAuthorizedBy != null ? overrideReason : undefined,
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
      setReceiptData({
        store_name:      portal.storeName,
        txn_id:          lastTxnId ?? '—',
        date_vente:      new Date().toISOString(),
        cashier_name:    user?.display_name ?? '—',
        items: cart.map(item => ({
          name:       item._displayName,
          qty:        1,
          unit_price: item.prix_vente_saisi,
          line_total: item.prix_vente_saisi,
          imei:       (item as Phone).imei ?? undefined,
        })),
        total:           totalVente,
        avance:          saleForm.avance       > 0 ? saleForm.avance       : undefined,
        valeur_echange:  saleForm.valeur_echange > 0 ? saleForm.valeur_echange : undefined,
        fariq,
        payment_method:  saleForm.payment_method,
        montant_especes: saleForm.montant_especes || undefined,
        montant_carte:   saleForm.montant_carte   || undefined,
        montant_rendu:   montantRendu > 0 ? montantRendu : undefined,
      })
      showSuccess(isAr ? 'تمت عملية البيع ✓' : 'Vente enregistrée ✓')

      // Check if exchange device needs intake
      if (saleForm.valeur_echange > 0) {
        setExchangePanel({
        open:                   true,
        txn_id:                 lastTxnId || '',
        valeur_echange:         saleForm.valeur_echange,
        marque_echange:         saleForm.marque_echange         ?? '',
        model_echange:          saleForm.model_echange          ?? '',
        imei_echange:           saleForm.imei_echange           ?? '',
        couleur_echange:        saleForm.couleur_echange        ?? '',
        stockage_echange:       saleForm.stockage_echange       ?? '',
        battery_echange:        saleForm.battery_echange,
        ram_echange:            saleForm.ram_echange            ?? '',
        prix_vente_echange:     saleForm.prix_vente_echange,
        prix_min_echange:       saleForm.prix_min_echange,
        echange_vers_reparation: saleForm.echange_vers_reparation ?? false,
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
      // If credit was applied, record the credit payment
      if (creditApplied > 0 && selectedClientId) {
        try {
          await fetch('/api/credits', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              client_id:      selectedClientId,
              store_id:       storeId,
              txn_id:         lastTxnId,
              montant:        creditApplied,
              payment_method: 'نقد',
              notes:          `Crédit appliqué sur vente ${lastTxnId}`,
            }),
          })
        } catch { /* non-blocking — sale is already recorded */ }
      }

      setCart([])
      setSaleForm({ ...EMPTY_SALE })
      setOverrideAuthorizedBy(null)
      setOverrideReason('')
      setSelectedClientId(null)
      setClientCredit(0)
      setCreditApplied(0)
    } catch (err: unknown) {
      showError((err as Error).message)
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
            onClick={() => setReceiptOpen(true)}
            style={{ backgroundColor: primary } as React.CSSProperties}
          >
            <Printer className="w-4 h-4" />
            {isAr ? 'طباعة الفاتورة' : 'Imprimer reçu'}
          </Btn>

          {receiptOpen && receiptData && (
            <ReceiptPrint
              data={receiptData}
              onClose={() => setReceiptOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  )

  // ── Render exchange intake panel ─────────────────────────
  // Inline component for post-sale exchange intake
  function ExchangeIntakePanel() {
    if (!exchangePanel?.open) return null

    async function handleAddToStock() {
      if (!exchangeForm.modele || !exchangeForm.imei) {
        showError(isAr ? 'الموديل والرقم التسلسلي مطلوبان' : 'Modèle et IMEI requis')
        return
      }
      setAddingExchange(true)
      try {
        const res = await fetch('/api/phones', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
              store_id:              storeId,
              marque:                exchangeForm.marque || 'Inconnu',
              model:                 exchangeForm.modele,
              imei:                  exchangeForm.imei,
              prix_achat:            exchangeForm.prix_achat,
              prix_vente_recommande: exchangePanel?.prix_vente_echange     ?? null,
              prix_vente_minimum:    exchangePanel?.prix_min_echange        ?? null,
              couleur:               exchangePanel?.couleur_echange         || exchangeForm.couleur  || null,
              stockage:              exchangePanel?.stockage_echange        || exchangeForm.capacite || null,
              battery_level:         exchangePanel?.battery_echange         ?? null,
              ram:                   exchangePanel?.ram_echange             || null,
              condition:             'مستعمل',
              source:                'Échange',
              status:                exchangePanel?.echange_vers_reparation ? 'إصلاح' : 'متوفر',
              location:              'Magasin Principal',
              txn_ref_id:            exchangePanel?.txn_id,
            }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        setAddedPhoneId(json.data.phone_id)
        showSuccess(`${isAr ? 'أضيف إلى المخزون' : 'Ajouté au stock'}: ${json.data.phone_id}`)
        setExchangePanel(p => p ? { ...p, open: false } : null)
      } catch (err: unknown) {
        showError((err as Error).message)
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

  // ── Main POS layout ───────────────────────────────────────
  return (
    <div className="h-full flex flex-col lg:flex-row overflow-hidden animate-fade-in"
         dir={isAr ? 'rtl' : 'ltr'}>

      {/* ── LEFT: Zones A–E ─────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-[#E8E5DE]">

        {/* Zone A — Slim top bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E8E5DE] flex-shrink-0 bg-white">
          <p
            className="font-bold text-sm tracking-widest"
            style={{ color: primary, fontFamily: "'Barlow Condensed', sans-serif" }}
          >
            {portal.storeName.toUpperCase()}
          </p>
          <LiveClock />
        </div>

        {/* Zone B — Search bar */}
        <div className="px-5 pt-4 pb-2 flex-shrink-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
              <input
                className="w-full pl-9 pr-10 py-3 bg-white border-2 border-[#E8E5DE] rounded-xl text-sm placeholder:text-[#B0ADA6] focus:outline-none transition-all"
                placeholder={isAr ? 'IMEI، ماركة، موديل، باركود...' : 'IMEI, marque, modèle, code-barres...'}
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
                onFocus={e => {
                  e.target.style.borderColor = primary
                  e.target.style.boxShadow   = `0 0 0 3px ${primary}20`
                }}
                onBlur={e => {
                  e.target.style.borderColor = '#E8E5DE'
                  e.target.style.boxShadow   = 'none'
                }}
              />
              {searching ? (
                <Loader2
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]"
                  style={{ animation: 'spin 1s linear infinite' }}
                />
              ) : search ? (
                <button
                  onClick={() => { setSearch(''); setResults([]) }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B0ADA6] hover:text-[#1A1A1A]"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : null}
            </div>
            <ScanButton
              onScan={v => setSearch(v)}
              hint="Scannez un IMEI pour trouver l'appareil"
              mode="barcode"
              color={primary}
            />
          </div>

          {/* Inline search results */}
          {search && results.length > 0 && (
            <div className="mt-2 bg-white border border-[#E8E5DE] rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
              {results.map(device => (
                <button
                  key={device._id}
                  onClick={() => addToCart(device)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F8F7F4] transition-all text-left border-b border-[#F2F0EB] last:border-0"
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${primary}15` }}
                  >
                    {device._type === 'phone'   ? <Smartphone className="w-4 h-4" style={{ color: primary }} />
                    : device._type === 'laptop' ? <LaptopIcon  className="w-4 h-4" style={{ color: primary }} />
                    :                             <Package     className="w-4 h-4" style={{ color: primary }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A] truncate">
                      {device._displayName}
                    </p>
                    <p className="text-xs text-[#B0ADA6]">
                      {(device as Phone).imei || '—'}
                      {' · '}
                      <span className="text-emerald-600">
                        {isAr ? 'متوفر' : 'Disponible'}
                      </span>
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

          {search.length >= 2 && !searching && results.length === 0 && (
            <p className="text-xs text-[#B0ADA6] mt-2 text-center">
              {isAr ? 'لا توجد نتائج' : 'Aucun résultat'}
            </p>
          )}
        </div>

        {/* Zone C — Category pills (hidden during active search) */}
        {!search && (
          <div className="px-5 py-2 flex-shrink-0">
            <div
              className="flex gap-2 overflow-x-auto pb-1"
              style={{ scrollbarWidth: 'none' }}
            >
              {[
                { key: 'phones',    label: isAr ? 'هواتف'  : 'Téléphones', icon: <Smartphone className="w-3 h-3" /> },
                ...(hasLaptops ? [{ key: 'laptops', label: isAr ? 'لابتوب' : 'Laptops', icon: <LaptopIcon className="w-3 h-3" /> }] : []),
                ...accCategories.map(cat => ({
                  key:   `acc_${cat.ar}`,
                  label: isAr ? cat.ar : cat.fr,
                  icon:  <Package className="w-3 h-3" />,
                })),
              ].map(cat => (
                <button
                  key={cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-all flex-shrink-0"
                  style={{
                    backgroundColor: activeCategory === cat.key ? primary  : 'white',
                    borderColor:     activeCategory === cat.key ? primary  : '#E8E5DE',
                    color:           activeCategory === cat.key ? 'white'  : '#6B6860',
                  }}
                >
                  {cat.icon}
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Zone D — Product grid (hidden during active search) */}
        {!search && (
          <div className="flex-1 overflow-y-auto px-5 pb-2">
            {gridLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2
                  className="w-6 h-6 text-[#B0ADA6]"
                  style={{ animation: 'spin 1s linear infinite' }}
                />
              </div>
            ) : gridItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <Package className="w-8 h-8 text-[#B0ADA6] mb-2 opacity-40" />
                <p className="text-sm text-[#B0ADA6]">
                  {isAr ? 'لا توجد منتجات متاحة' : 'Aucun produit disponible'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-1">
                {gridItems.map(item => (
                  <button
                    key={item._id}
                    onClick={() => addToCart(item)}
                    className="bg-white border border-[#E8E5DE] rounded-2xl p-3 text-left hover:shadow-md transition-all active:scale-[0.98]"
                    onMouseEnter={e => (e.currentTarget.style.borderColor = primary)}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = '#E8E5DE')}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center mb-2"
                      style={{ backgroundColor: `${primary}12` }}
                    >
                      {item._type === 'phone'   ? <Smartphone className="w-5 h-5" style={{ color: primary }} />
                      : item._type === 'laptop' ? <LaptopIcon  className="w-5 h-5" style={{ color: primary }} />
                      :                           <Package     className="w-5 h-5" style={{ color: primary }} />}
                    </div>
                    <p className="text-xs font-bold text-[#1A1A1A] leading-tight truncate">
                      {item._displayName}
                    </p>
                    <p className="text-[10px] text-[#B0ADA6] mt-0.5 truncate">
                      {(item as Phone).imei
                        ? (item as Phone).imei?.slice(-6)
                        : isAr ? 'متوفر' : 'Disponible'}
                    </p>
                    {canSeePrices && (
                      <p className="text-sm font-bold mt-2" style={{ color: primary }}>
                        {formatMAD((item as Phone).prix_vente_recommande || 0)}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Zone E — Cart strip (always visible) */}
        <div className="flex-shrink-0 border-t border-[#E8E5DE] bg-white">
          <div className="px-5 py-3 max-h-48 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex items-center gap-3 text-[#B0ADA6] py-1">
                <ShoppingCart className="w-4 h-4" />
                <p className="text-xs">
                  {isAr
                    ? 'السلة فارغة — اضغط على بطاقة لإضافتها'
                    : 'Panier vide — tapez une carte pour ajouter'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((item, idx) => (
                  <div
                    key={item._id}
                    className="flex items-center gap-3 bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl px-3 py-2"
                  >
                    <span className="text-xs font-bold text-[#B0ADA6] w-5 text-center flex-shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-[#1A1A1A] truncate">
                        {item._displayName}
                      </p>
                      {(item as Phone).imei && (
                        <p className="text-[10px] text-[#B0ADA6] font-mono truncate">
                          {(item as Phone).imei}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        inputMode="decimal"
                        className="w-24 border border-[#E8E5DE] rounded-lg px-2 py-1 text-xs font-bold text-right bg-white focus:outline-none"
                        value={item.prix_vente_saisi || ''}
                        onChange={e => updatePrice(item._id, Number(e.target.value))}
                        style={{
                          borderColor: isBelowMinimum(
                            item.prix_vente_saisi,
                            (item as Phone).prix_vente_minimum
                          ) ? '#F59E0B' : undefined,
                        }}
                      />
                      {canSeePrices && (item as Phone).prix_achat && (
                        <span className={`text-[10px] font-bold w-16 text-right flex-shrink-0 ${
                          item.prix_vente_saisi - ((item as Phone).prix_achat || 0) >= 0
                            ? 'text-emerald-600'
                            : 'text-red-500'
                        }`}>
                          {formatMAD(item.prix_vente_saisi - ((item as Phone).prix_achat || 0))}
                        </span>
                      )}
                      <button
                        onClick={() => removeFromCart(item._id)}
                        className="p-1 rounded-lg text-[#B0ADA6] hover:text-red-500 hover:bg-red-50 transition-all"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
      {/* ── RIGHT panel starts here — leave completely untouched ── */}
      <div className="w-full lg:w-96 flex flex-col bg-[#F8F7F4] border-t lg:border-t-0 border-[#E8E5DE] overflow-y-auto">
        <div className="p-5 space-y-5">

          {/* Client */}
          <div>
            <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-3 flex items-center gap-2">
              <User className="w-3.5 h-3.5" />
              {isAr ? 'العميل' : 'Client'}
              {selectedClientId && (
                <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 normal-case tracking-normal">
                  ✓ {isAr ? 'موجود' : 'Existant'}
                </span>
              )}
            </p>
            <div className="space-y-2">
              {/* Name field with live suggestion dropdown */}
              <div className="relative">
                <input
                  className={inputClass}
                  placeholder={isAr ? 'الاسم (اختياري)' : 'Nom (optionnel)'}
                  value={saleForm.client_nom}
                  onChange={e => handleClientNameChange(e.target.value)}
                  onBlur={() => setTimeout(() => setShowClientDropdown(false), 150)}
                  autoComplete="off"
                />
                {clientSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#B0ADA6] animate-spin" />
                )}
                {showClientDropdown && clientSuggestions.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-[#E8E5DE] rounded-xl shadow-xl overflow-hidden max-h-48 overflow-y-auto">
                    {clientSuggestions.map(c => (
                      <button
                        key={c.client_id}
                        type="button"
                        onMouseDown={() => selectClientSuggestion(c)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F8F7F4] transition-all text-left border-b border-[#F2F0EB] last:border-0"
                      >
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                             style={{ backgroundColor: `${primary}15` }}>
                          <User className="w-3.5 h-3.5" style={{ color: primary }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-[#1A1A1A] truncate">{c.nom}</p>
                          <p className="text-[10px] text-[#B0ADA6] font-mono">{c.telephone}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                className={inputClass}
                placeholder={isAr ? '06XXXXXXXX *' : '06XXXXXXXX *'}
                value={saleForm.client_tel}
                onChange={e => { setSale('client_tel', e.target.value.replace(/\D/g, '').slice(0, 10)); setSelectedClientId(null) }}
                type="tel"
                maxLength={10}
              />
            </div>

            {/* Credit notice */}
            {clientCredit > 0 && (
              <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <Wallet className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-amber-800">
                      {isAr ? 'لدى هذا العميل ذمة:' : 'Solde impayé :'}{' '}
                      <span>{formatMAD(clientCredit)}</span>
                    </p>
                    {creditApplied > 0 && (
                      <p className="text-[10px] text-amber-700 mt-0.5">
                        {isAr ? `مُطبَّق على البيع: ${formatMAD(creditApplied)}` : `Crédit appliqué : ${formatMAD(creditApplied)}`}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setCreditInputValue(String(Math.min(clientCredit, totalVente))); setCreditModalOpen(true) }}
                  className="flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition-all">
                  {creditApplied > 0
                    ? (isAr ? 'تعديل' : 'Modifier')
                    : (isAr ? 'تطبيق' : 'Appliquer')}
                </button>
              </div>
            )}
          </div>

          {/* Operation type */}
          <div>
            <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-3 flex items-center gap-2">
              <ArrowLeftRight className="w-3.5 h-3.5" />
              {isAr ? 'نوع العملية' : "Type d'opération"}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {(['بيع', 'إستبدال'] as OperationType[]).map(op => (
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
                  {op === 'بيع' ? (isAr ? 'بيع' : 'Vente') : (isAr ? 'إستبدال' : 'Échange')}
                </button>
              ))}
              <button
                onClick={() => setRetourOpen(true)}
                className="py-2.5 rounded-xl text-xs font-bold border transition-all"
                style={{ backgroundColor: 'white', borderColor: '#FCA5A5', color: '#EF4444' }}
              >
                {isAr ? 'إرجاع' : 'Retour'}
              </button>
            </div>
          </div>

          {/* Exchange block */}
          {saleForm.type_operation === 'إستبدال' && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3 animate-fade-in">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-widest">
                {isAr ? 'الجهاز المستبدل' : 'Appareil échangé'}
              </p>

              {/* Marque — dependent dropdown */}
              <ComboBox
                options={brands}
                value={saleForm.marque_echange}
                onChange={v => { setSale('marque_echange', v); setSale('model_echange', ''); setSale('couleur_echange', '') }}
                placeholder={isAr ? 'الماركة' : 'Marque'}
              />

              {/* Modèle — filtered by marque */}
              <ComboBox
                options={modelsFor(saleForm.marque_echange)}
                value={saleForm.model_echange}
                onChange={v => { setSale('model_echange', v); setSale('couleur_echange', '') }}
                placeholder={!saleForm.marque_echange ? 'Choisissez d\'abord la marque' : (isAr ? 'الموديل' : 'Modèle')}
                disabled={!saleForm.marque_echange}
              />

              {/* Couleur + Stockage */}
              <div className="grid grid-cols-2 gap-2">
                <ComboBox
                  options={couleursFor(saleForm.model_echange)}
                  value={saleForm.couleur_echange ?? ''}
                  onChange={v => setSale('couleur_echange', v)}
                  placeholder={!saleForm.model_echange ? 'Modèle d\'abord' : 'Couleur'}
                  disabled={!saleForm.model_echange}
                />
                <ComboBox
                  options={['32GB','64GB','128GB','256GB','512GB','1TB']}
                  value={saleForm.stockage_echange ?? ''}
                  onChange={v => setSale('stockage_echange', v)}
                  placeholder="Stockage"
                />
              </div>

              {/* Battery (Apple) or RAM (others) */}
              {saleForm.marque_echange?.toLowerCase().includes('apple') ? (
                <div>
                  <label className="text-xs text-blue-700 font-medium">Batterie (%)</label>
                  <input type="number" min={0} max={100} className={`${inputClass} mt-1`}
                    placeholder="85"
                    value={saleForm.battery_echange ?? ''} onChange={e => setSale('battery_echange', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
              ) : (
                <div>
                  <label className="text-xs text-blue-700 font-medium">RAM</label>
                  <input className={`${inputClass} mt-1`} placeholder="4GB…"
                    value={saleForm.ram_echange ?? ''} onChange={e => setSale('ram_echange', e.target.value)} />
                </div>
              )}

              {/* IMEI with scanner */}
              <div>
                <label className="text-xs text-blue-700 font-medium">IMEI</label>
                <div className="flex gap-2 mt-1">
                  <input className={inputClass} placeholder="356XXXXXXXXXXXXX"
                    type="text" inputMode="numeric" pattern="[0-9]*"
                    value={saleForm.imei_echange}
                    onChange={e => setSale('imei_echange', e.target.value.replace(/\D/g, '').slice(0, 15))} />
                  <ScanButton onScan={v => setSale('imei_echange', v)}
                    hint="Scannez l'IMEI de l'appareil repris" color={primary} mode="barcode" />
                </div>
              </div>

              {/* Prix vente recommandé + minimum */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-blue-700 font-medium">
                    {isAr ? 'سعر البيع المقترح' : 'Prix vente (MAD)'}
                  </label>
                  <input type="number" className={`${inputClass} mt-1`} placeholder="0"
                    value={saleForm.prix_vente_echange ?? ''} onChange={e => setSale('prix_vente_echange', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="text-xs text-blue-700 font-medium">
                    {isAr ? 'السعر الأدنى' : 'Prix minimum (MAD)'}
                  </label>
                  <input type="number" className={`${inputClass} mt-1`} placeholder="0"
                    value={saleForm.prix_min_echange ?? ''} onChange={e => setSale('prix_min_echange', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
              </div>

              {/* Valeur échange */}
              <div>
                <label className="text-xs text-blue-700 font-medium">
                  {isAr ? 'قيمة الاستبدال (تُخصم من الإجمالي)' : 'Valeur échange déduite (MAD)'}
                </label>
                <input type="number" className={`${inputClass} mt-1`}
                  value={saleForm.valeur_echange || ''}
                  onChange={e => setSale('valeur_echange', Number(e.target.value))} />
              </div>

              {/* Notes sur l'appareil repris */}
              <div>
                <label className="text-xs text-blue-700 font-medium block mb-1">
                  {isAr ? 'ملاحظات عن الجهاز' : "Notes sur l'appareil repris"}
                </label>
                <textarea className={`${inputClass} resize-none text-xs`} rows={2}
                  placeholder={isAr ? 'حالة الجهاز، الخدوش، المشاكل...' : 'État, rayures, problèmes connus...'}
                  value={saleForm.description_echange}
                  onChange={e => setSale('description_echange', e.target.value)} />
              </div>

              {/* Send to repair toggle */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <div
                  onClick={() => setSale('echange_vers_reparation', !saleForm.echange_vers_reparation)}
                  className={`w-10 h-5 rounded-full transition-colors flex-shrink-0 flex items-center px-0.5 ${
                    saleForm.echange_vers_reparation ? 'bg-amber-500' : 'bg-[#D4D1CC]'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    saleForm.echange_vers_reparation ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </div>
                <span className="text-xs font-medium text-blue-700">
                  {isAr ? 'إرسال للإصلاح قبل الوضع في المخزون' : 'Envoyer en réparation avant mise en stock'}
                </span>
              </label>
            </div>
          )}

          {/* Payment */}
          <div>
            <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-3 flex items-center gap-2">
              <CreditCard className="w-3.5 h-3.5" />
              {isAr ? 'طريقة الدفع' : 'Paiement'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: 'نقد',    fr: 'Espèces',  ar: 'نقداً'        },
                { v: 'تحويل', fr: 'Virement',  ar: 'تحويل بنكي'  },
                { v: 'تسبيق', fr: 'Avance',    ar: 'تسبيق'       },
                { v: 'مختلط', fr: 'Mixte',     ar: 'مختلط'       },
                { v: 'آجل',   fr: 'À crédit',  ar: 'آجل'         },
              ] as { v: PaymentMethod; fr: string; ar: string }[]).map(({ v, fr, ar }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSale('payment_method', v)}
                  className="py-2 rounded-xl text-xs font-bold border transition-all"
                  style={{
                    backgroundColor: saleForm.payment_method === v ? primary : 'white',
                    borderColor:     saleForm.payment_method === v ? primary : '#E8E5DE',
                    color:           saleForm.payment_method === v ? 'white' : '#6B6860',
                  }}
                >
                  {isAr ? ar : fr}
                </button>
              ))}
            </div>

            {saleForm.payment_method === 'آجل' && (
              <div className="mt-2 p-3 bg-purple-50 border border-purple-200 rounded-xl">
                <p className="text-xs font-medium text-purple-700">
                  {isAr
                    ? 'سيُسجَّل المبلغ كاملاً كذمة على العميل — لا شيء يُحصَّل الآن'
                    : 'La totalité sera enregistrée comme créance client — rien n\'est encaissé maintenant'}
                </p>
              </div>
            )}

            {saleForm.payment_method === 'تحويل' && (
              <input className={`${inputClass} mt-2`}
                placeholder={isAr ? 'مرجع التحويل *' : 'Référence virement *'}
                value={saleForm.payment_ref}
                onChange={e => setSale('payment_ref', e.target.value)} />
            )}
            {saleForm.payment_method === 'تسبيق' && (
              <div className="mt-2 space-y-2">
                <input type="number" min={0} step={0.01} inputMode="decimal" className={inputClass}
                  placeholder={isAr ? 'مبلغ التسبيق (درهم)' : 'Montant avance (MAD)'}
                  value={saleForm.avance || ''}
                  onChange={e => setSale('avance', Number(e.target.value))} />
                <div>
                  <p className="text-[10px] font-bold text-[#6B6860] uppercase tracking-widest mb-1.5">
                    {isAr ? 'طريقة دفع التسبيق *' : 'Paiement de l\'avance *'}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['نقد', 'تحويل'] as const).map(method => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setSale('avance_sub_method', method)}
                        className="py-2 rounded-xl text-xs font-bold border transition-all"
                        style={{
                          backgroundColor: saleForm.avance_sub_method === method ? primary : 'white',
                          borderColor:     saleForm.avance_sub_method === method ? primary : '#E8E5DE',
                          color:           saleForm.avance_sub_method === method ? 'white' : '#6B6860',
                        }}
                      >
                        {method === 'نقد'
                          ? (isAr ? 'نقداً' : 'Espèces')
                          : (isAr ? 'تحويل بنكي' : 'Virement')}
                      </button>
                    ))}
                  </div>
                  {saleForm.avance > 0 && !saleForm.avance_sub_method && (
                    <p className="text-[10px] text-amber-600 mt-1 font-medium">
                      {isAr ? '⚠ يرجى تحديد كيفية دفع التسبيق' : '⚠ Précisez comment l\'avance a été réglée'}
                    </p>
                  )}
                </div>
              </div>
            )}
            {saleForm.payment_method === 'مختلط' && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <input type="number" min={0} step={0.01} inputMode="decimal" className={inputClass}
                  placeholder={isAr ? 'نقد' : 'Espèces'}
                  value={saleForm.montant_especes || ''}
                  onChange={e => setSale('montant_especes', Number(e.target.value))} />
                <input type="number" min={0} step={0.01} inputMode="decimal" className={inputClass}
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
            {montantRendu > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[#6B6860]">{isAr ? 'المبلغ المُسلَّم' : 'Espèces remises'}</span>
                <span className="text-[#1A1A1A]">{formatMAD(saleForm.payment_method === 'نقد' ? saleForm.montant_especes : saleForm.montant_especes + saleForm.montant_carte)}</span>
              </div>
            )}
            <div className="flex justify-between items-end pt-2 border-t border-[#E8E5DE]">
              <span className="font-bold text-[#1A1A1A]">{isAr ? 'المتبقي للدفع' : 'Reste à payer'}</span>
              <div className="text-right">
                <p className="font-display font-bold text-xl" style={{ color: primary }}>
                  {formatMAD(displayFariq)}
                </p>
                <StatusBadge status={statutPaiement} />
                {montantRendu > 0 && (
                  <div className="mt-1 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-bold text-emerald-700">
                    {isAr ? `المونطان رونديو: ${formatMAD(montantRendu)}` : `Rendu: ${formatMAD(montantRendu)}`}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={cart.length === 0 || submitting}
            className="w-full py-3 rounded-2xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: primary, color: 'white' }}
          >
            {submitting
              ? (isAr ? 'جارٍ الحفظ...' : 'Enregistrement...')
              : (isAr ? 'تأكيد البيع' : 'Confirmer la vente')}
          </button>
          <button
            type="button"
            onClick={() => {
              setCart([])
              setSaleForm({ ...EMPTY_SALE })
              setSelectedClientId(null)
              setOverrideAuthorizedBy(null)
              setOverrideReason('')
            }}
            className="w-full py-2.5 rounded-2xl text-xs font-bold border border-[#E8E5DE] text-[#B0ADA6] hover:border-red-300 hover:text-red-400 transition-all"
          >
            {isAr ? '× مسح الكل' : '× Réinitialiser'}
          </button>

          {/* Cash Drop */}
          <button
            type="button"
            onClick={() => setCashDropOpen(true)}
            className="w-full py-2.5 rounded-2xl text-xs font-bold border border-[#E8E5DE] text-[#6B6860] hover:border-emerald-400 hover:text-emerald-600 transition-all flex items-center justify-center gap-1.5"
          >
            <span>＋</span>
            {isAr ? 'إيداع نقدي' : 'Encaissement manuel'}
          </button>

          {/* Cash Drop Modal */}
          {cashDropOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
                <p className="text-sm font-bold text-[#1A1A1A]">
                  {isAr ? 'إيداع نقدي' : 'Encaissement manuel'}
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
                      {isAr ? 'المبلغ (درهم) *' : 'Montant (MAD) *'}
                    </label>
                    <input
                      type="number"
                      className="w-full px-3 py-2.5 text-sm border border-[#E8E5DE] rounded-xl focus:outline-none focus:border-emerald-400"
                      placeholder="0.00"
                      value={cashDropAmount}
                      onChange={e => setCashDropAmount(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#6B6860] uppercase tracking-widest block mb-1">
                      {isAr ? 'السبب *' : 'Motif *'}
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2.5 text-sm border border-[#E8E5DE] rounded-xl focus:outline-none focus:border-emerald-400"
                      placeholder={isAr ? 'مثال: دفع دين قديم' : 'Ex: remboursement dette ancienne'}
                      value={cashDropReason}
                      onChange={e => setCashDropReason(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => { setCashDropOpen(false); setCashDropAmount(''); setCashDropReason('') }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-[#E8E5DE] text-[#6B6860] hover:bg-[#F8F7F4] transition-all"
                  >
                    {isAr ? 'إلغاء' : 'Annuler'}
                  </button>
                  <button
                    type="button"
                    disabled={cashDropSubmitting || !cashDropAmount || !cashDropReason.trim()}
                    onClick={async () => {
                      if (!cashDropAmount || !cashDropReason.trim()) return
                      setCashDropSubmitting(true)
                      try {
                        const res = await fetch('/api/cash-drops', {
                          method:  'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body:    JSON.stringify({
                            amount:   Number(cashDropAmount),
                            reason:   cashDropReason.trim(),
                            store_id: storeId,
                          }),
                        })
                        if (!res.ok) throw new Error((await res.json()).error)
                        showSuccess(isAr ? 'تم تسجيل الإيداع ✓' : 'Encaissement enregistré ✓')
                        setCashDropOpen(false)
                        setCashDropAmount('')
                        setCashDropReason('')
                      } catch (err: unknown) {
                        showError((err as Error).message)
                      } finally {
                        setCashDropSubmitting(false)
                      }
                    }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                    style={{ backgroundColor: primary }}
                  >
                    {cashDropSubmitting ? '...' : (isAr ? 'تأكيد' : 'Confirmer')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      

      {/* Exchange intake panel */}
      {exchangePanel?.open && (
        <div className="fixed inset-0 z-40 flex items-end lg:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5">
              <ExchangeIntakePanel />
            </div>
          </div>
        </div>
      )}

      {/* Retour modal */}
      <RetourModal
        open={retourOpen}
        onClose={() => setRetourOpen(false)}
        storeId={storeId}
        primary={primary}
        onRetourDone={() => {
          setCart([])
          setSaleForm({ ...EMPTY_SALE })
        }}
      />

      {/* Credit apply modal */}
      <Modal
        open={creditModalOpen}
        onClose={() => { setCreditModalOpen(false); setCreditInputValue('') }}
        title={isAr ? 'تطبيق رصيد الذمة على البيع' : 'Appliquer le crédit sur la vente'}
        size="sm"
      >
        <div className="space-y-4">
          <div className="p-3 bg-[#F8F7F4] rounded-xl space-y-1">
            <p className="text-xs text-[#6B6860]">
              {isAr ? 'الرصيد المتاح:' : 'Solde disponible :'}{' '}
              <span className="font-bold text-[#1A1A1A]">{formatMAD(clientCredit)}</span>
            </p>
            <p className="text-xs text-[#6B6860]">
              {isAr ? 'إجمالي البيع:' : 'Total vente :'}{' '}
              <span className="font-bold text-[#1A1A1A]">{formatMAD(totalVente)}</span>
            </p>
          </div>
          <Field label={isAr ? 'المبلغ المُطبَّق (درهم)' : 'Montant à appliquer (MAD)'}>
            <input
              type="number"
              min={0}
              max={Math.min(clientCredit, totalVente)}
              step={0.01}
              inputMode="decimal"
              className={inputClass}
              value={creditInputValue}
              onChange={e => setCreditInputValue(e.target.value)}
              autoFocus
            />
            <p className="text-[10px] text-[#B0ADA6] mt-1">
              {isAr
                ? `الحد الأقصى: ${formatMAD(Math.min(clientCredit, totalVente))}`
                : `Maximum : ${formatMAD(Math.min(clientCredit, totalVente))}`}
            </p>
          </Field>
          <div className="flex gap-2">
            <button
              onClick={() => { setCreditModalOpen(false); setCreditInputValue('') }}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-[#E8E5DE] text-[#6B6860] hover:bg-[#F8F7F4] transition-all">
              {isAr ? 'إلغاء' : 'Annuler'}
            </button>
            {creditApplied > 0 && (
              <button
                onClick={() => { setCreditApplied(0); setCreditInputValue(''); setCreditModalOpen(false) }}
                className="px-4 py-2.5 rounded-xl text-sm font-bold border border-red-200 text-red-600 hover:bg-red-50 transition-all">
                {isAr ? 'إلغاء التطبيق' : 'Retirer'}
              </button>
            )}
            <button
              onClick={() => {
                const v = parseFloat(creditInputValue)
                if (!v || v <= 0) { showError(isAr ? 'مبلغ غير صالح' : 'Montant invalide'); return }
                const max = Math.min(clientCredit, totalVente)
                if (v > max) { showError(`Maximum: ${formatMAD(max)}`); return }
                setCreditApplied(v)
                setCreditModalOpen(false)
                setCreditInputValue('')
              }}
              className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition-all">
              {isAr ? 'تطبيق' : 'Appliquer'}
            </button>
          </div>
        </div>
      </Modal>

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
          <Field label={isAr ? 'سبب التجاوز *' : 'Motif de dérogation *'}>
            <input
              type="text"
              className={inputClass}
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              placeholder={isAr ? 'مثال: موافقة العميل، مبيع بالجملة...' : 'Ex: Accord client, vente en gros...'}
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
  
}