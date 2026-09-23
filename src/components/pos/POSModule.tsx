'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useApi } from '@/lib/data/api'
import { useCategories } from '@/lib/hooks/useCategories'
import { useLanguageStore } from '@/lib/stores/language'
import { t } from '@/lib/i18n/t'
import { usePortal } from '@/lib/context/portal'
import { formatMAD, computeFariq, computeStatutPaiement, isBelowMinimum, computePromoPrice, round2 } from '@/lib/utils'
import { Modal, Field, inputClass, selectClass, Btn, PageHeader } from '@/components/shared'
import { StatusBadge } from '@/components/shared'
import { showSuccess, showError } from '@/lib/utils/toasts'
import type { Phone, Laptop, PaymentMethod, OperationType } from '@/types/database'
import ScanButton from '@/components/scanner/ScanButton'
import ComboBox from '@/components/phones/ComboBox'
import RetourModal          from '@/components/pos/RetourModal'
import CashDropModal        from '@/components/pos/CashDropModal'
import QtyPickerModal       from '@/components/pos/QtyPickerModal'
import OverridePinModal     from '@/components/pos/OverridePinModal'
import ExchangeIntakePanel, { type ExchangePanelState } from '@/components/pos/ExchangeIntakePanel'
import { ReceiptPrint, type ReceiptData } from '@/components/print/ReceiptGenerator'
import { usePhoneCatalog } from '@/lib/hooks/usePhoneCatalog'
import { BrandLogo } from '@/components/shared/BrandLogo'
import {
  Search, ShoppingCart, User, CreditCard, ArrowLeftRight,
  X, AlertTriangle, Loader2, CheckCircle,
  Smartphone, Laptop as LaptopIcon, Package, Plus, Minus,
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
  qty:              number
}

interface SaleForm {
  client_nom:               string
  client_tel:               string
  type_operation:           OperationType
  payment_method:           PaymentMethod
  avance_sub_method:        'especes' | 'virement' | ''
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
  type_operation:    'vente',
  payment_method:    'especes',
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
  storeId:     string
  hasLaptops?: boolean
}

const GRID_PAGE = 48

function getAccPrice(item: DeviceResult): number {
  const raw = (item as unknown as Record<string, unknown>)
  return (raw.prix_vente_recommande as number) ?? 0
}

function LiveClock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  )
  useEffect(() => {
    const id = setInterval(() =>
      setTime(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    , 1000)
    return () => clearInterval(id)
  }, [])
  return <p className="text-xs font-mono font-bold text-[#6B6860] tabular-nums">{time}</p>
}

// ─── Component ───────────────────────────────────────────────
export default function POSModule({ storeId, hasLaptops = true }: POSModuleProps) {
  const { user }                       = useUser()
  const { accessories: accCategories } = useCategories()
  const { language }                   = useLanguageStore()
  const portal                         = usePortal()
  const isAr                           = language === 'ar'

  const sortedAccCategories = [...accCategories].sort((a, b) =>
    (isAr ? a.ar : a.fr).localeCompare(isAr ? b.ar : b.fr, isAr ? 'ar' : 'fr')
  )
  const primary      = portal.primaryColor
  // canSeeAchat : seuls manager/owner voient prix_achat et la marge
  // prix_vente_recommandé visible à tous les rôles (staff inclus)
  const canSeeAchat = user?.role === 'gerant' || user?.role === 'proprietaire'

  const [search,    setSearch]    = useState('')
  const [cart,      setCart]      = useState<CartItem[]>([])
  const [saleForm,  setSaleForm]  = useState<SaleForm>({ ...EMPTY_SALE })
  const { brands, seriesFor, modelsFor, couleursFor } = usePhoneCatalog()

  const [overrideOpen,         setOverrideOpen]         = useState(false)
  const [overrideItem,         setOverrideItem]         = useState<CartItem | null>(null)
  const [overrideReason,       setOverrideReason]       = useState('')
  const [overrideAuthorizedBy, setOverrideAuthorizedBy] = useState<string | null>(null)

  const [submitting,  setSubmitting]  = useState(false)
  const [retourOpen,  setRetourOpen]  = useState(false)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)

  const [qtyPicker, setQtyPicker] = useState<{ device: DeviceResult; qty: number } | null>(null)

  const [exchangePanel, setExchangePanel] = useState<ExchangePanelState & { open: boolean } | null>(null)
  const [successTxn,    setSuccessTxn]    = useState<string | null>(null)

  const [activeCategory, setActiveCategory] = useState('phones')

  const [clientSuggestions,  setClientSuggestions]  = useState<{ client_id: string; nom: string; telephone: string }[]>([])
  const [showClientDrop,     setShowClientDrop]      = useState(false)
  const [selectedClientId,   setSelectedClientId]    = useState<string | null>(null)
  // All the store's clients (small list): name suggestions appear as you type
  const clientsQ = useApi<{ client_id: string; nom: string; telephone: string; telephone_2?: string | null }[]>(`/api/clients?store_id=${storeId}`)

  const [cashDropOpen,  setCashDropOpen]  = useState(false)
  const [priceInputs,   setPriceInputs]   = useState<Record<string, string>>({})

  // ── Stock: the store's whole available stock, cached and kept current by live
  // change events. Search and category browsing then run instantly in the browser.
  const phonesQ = useApi<Phone[]>(`/api/phones?status=disponible&store_id=${storeId}&limit=500`)
  const accQ    = useApi<Record<string, unknown>[]>(`/api/accessories?store_id=${storeId}`)
  const lapQ    = useApi<Laptop[]>(hasLaptops ? `/api/laptops?status=disponible&store_id=${storeId}` : null)
  // Sold on this device: hidden right away, before the refreshed stock arrives
  const [soldIds, setSoldIds] = useState<Set<string>>(() => new Set())

  const stock = useMemo(() => {
    const phones: DeviceResult[] = (phonesQ.data ?? []).map(p => ({
      ...p,
      _type:        'phone' as const,
      _displayName: `${p.marque} ${p.model}${p.stockage ? ' ' + p.stockage : ''}${p.couleur ? ' · ' + p.couleur : ''}`,
      _id:          p.phone_id,
    }))
    const accessories: DeviceResult[] = (accQ.data ?? []).map(a => ({
      ...a,
      _type:        'accessory' as const,
      _id:          a.acc_id as string,
      _displayName: [a.nom, a.marque ? `· ${a.marque}` : ''].filter(Boolean).join(' '),
    }) as unknown as DeviceResult)
    const laptops: DeviceResult[] = (lapQ.data ?? []).map(l => ({
      ...l,
      _type:        'laptop' as const,
      _displayName: `${l.marque} ${l.model}${l.stockage ? ' ' + l.stockage : ''}`,
      _id:          l.laptop_id,
    }))
    return { phones, accessories, laptops }
  }, [phonesQ.data, accQ.data, lapQ.data])

  // ── Search: phones + accessories + laptops (IMEI, serial, barcode, brand, model, name)
  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2) return []
    const tokens = q.split(/\s+/)
    const hit = (fields: unknown[]) => {
      const text = fields.filter(Boolean).join(' ').toLowerCase()
      return tokens.every(tok => text.includes(tok))
    }
    const raw = (d: DeviceResult) => d as unknown as Record<string, unknown>
    return [
      ...stock.phones.filter(d => hit([raw(d).marque, raw(d).model, raw(d).stockage, raw(d).couleur, raw(d).imei, raw(d).imei_2])),
      ...stock.accessories.filter(d => hit([raw(d).nom, raw(d).marque, raw(d).barcode])),
      ...stock.laptops.filter(d => hit([raw(d).marque, raw(d).model, raw(d).stockage, raw(d).serial])),
    ].filter(d => !soldIds.has(d._id))
  }, [search, stock, soldIds])

  // ── Grid: category browse
  const gridItems = useMemo(() => {
    let items: DeviceResult[] = []
    if (activeCategory === 'phones') items = stock.phones
    else if (activeCategory === 'laptops') items = stock.laptops
    else if (activeCategory.startsWith('acc_')) {
      const cat = activeCategory.slice(4)
      items = stock.accessories.filter(a => (a as unknown as Record<string, unknown>).categorie === cat)
    }
    return items.filter(d => !soldIds.has(d._id))
  }, [activeCategory, stock, soldIds])
  const gridLoading =
    activeCategory === 'phones'  ? phonesQ.isLoading :
    activeCategory === 'laptops' ? lapQ.isLoading    : accQ.isLoading

  // ── Cart helpers ──────────────────────────────────────────
  function addToCart(device: DeviceResult) {
    if (device._type !== 'accessory') {
      if (cart.find(c => c._id === device._id)) {
        showError(isAr ? 'موجود في السلة' : 'Déjà dans le panier'); return
      }
      const prix = (device as Phone).prix_vente_recommande ?? 0
      setCart(prev => [...prev, { ...device, prix_vente_saisi: prix, qty: 1 }])
      setSearch('')
      showSuccess(t(isAr, 'common.addedToCart'))
      return
    }
    const existingQty = cart.find(c => c._id === device._id)?.qty ?? 1
    setQtyPicker({ device, qty: existingQty })
    setSearch('')
  }

  function confirmQtyPicker() {
    if (!qtyPicker) return
    const { device, qty } = qtyPicker
    const prix   = getAccPrice(device)
    const inCart = cart.find(c => c._id === device._id)
    if (inCart) {
      setCart(prev => prev.map(c => c._id === device._id ? { ...c, qty } : c))
    } else {
      setCart(prev => [...prev, { ...device, prix_vente_saisi: prix, qty }])
    }
    setQtyPicker(null)
    showSuccess(t(isAr, 'common.addedToCart'))
  }

  function removeFromCart(id: string) {
    setCart(prev => prev.filter(c => c._id !== id))
  }

  // onChange — always update the raw string; only sync to cart when valid
  function handlePriceChange(id: string, raw: string) {
    setPriceInputs(p => ({ ...p, [id]: raw }))
    if (raw === '') return                          // allow field to show empty while typing
    const prix = Number(raw)
    if (isNaN(prix) || prix < 0) return
    setCart(prev => prev.map(c => c._id === id ? { ...c, prix_vente_saisi: prix } : c))
  }

  // onBlur — clear raw state so cart value takes over; then check minimum
  function handlePriceBlur(id: string, raw: string) {
    setPriceInputs(p => { const n = { ...p }; delete n[id]; return n })
    if (!raw) {
      setCart(prev => prev.map(c => c._id === id ? { ...c, prix_vente_saisi: 0 } : c))
      return
    }
    const prix = Number(raw)
    if (isNaN(prix) || prix <= 0) return
    const item = cart.find(c => c._id === id)
    if (!item) return
    const min = (item as Phone).prix_vente_minimum
    if (isBelowMinimum(prix, min) && user?.role === 'employe') {
      setOverrideItem({ ...item, prix_vente_saisi: prix })
      setOverrideOpen(true)
    }
  }

  // ── Override authorized callback (called by OverridePinModal) ─
  function handleOverrideAuthorized(userId: string | null, reason: string) {
    setOverrideAuthorizedBy(userId)
    setOverrideReason(reason)
    if (overrideItem) {
      setCart(prev => prev.map(c =>
        c._id === overrideItem._id ? { ...c, prix_vente_saisi: overrideItem.prix_vente_saisi } : c
      ))
    }
    setOverrideOpen(false)
    setOverrideItem(null)
  }

  function setSale(k: keyof SaleForm, v: unknown) {
    setSaleForm(prev => ({ ...prev, [k]: v }))
  }

  function handleClientNameChange(value: string) {
    setSale('client_nom', value)
    setSelectedClientId(null)
    const q = value.trim().toLowerCase()
    if (!q) { setClientSuggestions([]); setShowClientDrop(false); return }
    const digits = q.replace(/\s/g, '')
    setClientSuggestions((clientsQ.data ?? []).filter(c =>
      c.nom?.toLowerCase().includes(q) ||
      (/\d/.test(digits) && [c.telephone, c.telephone_2].some(tel => tel?.replace(/\s/g, '').includes(digits)))
    ).slice(0, 20))
    setShowClientDrop(true)
  }

  function selectClientSuggestion(c: { client_id: string; nom: string; telephone: string }) {
    setSaleForm(prev => ({ ...prev, client_nom: c.nom, client_tel: c.telephone }))
    setSelectedClientId(c.client_id)
    setClientSuggestions([])
    setShowClientDrop(false)
  }

  const totalVente     = cart.reduce((s, c) => s + c.prix_vente_saisi * (c.qty ?? 1), 0)
  const fariq          = computeFariq(totalVente, saleForm.avance, saleForm.type_operation === 'echange' ? saleForm.valeur_echange : 0)
  const displayFariq   = (saleForm.payment_method === 'avance' || saleForm.payment_method === 'credit') ? fariq : 0
  const statutPaiement = computeStatutPaiement(displayFariq)
  // What the client hands over: the cart minus the trade-in value (a 5 000 phone
  // with a 2 000 trade-in = 3 000 to pay); negative when the trade-in is worth more
  const valeurEchange  = saleForm.type_operation === 'echange' ? saleForm.valeur_echange : 0
  const netAPayer      = totalVente - valeurEchange
  const aEncaisser     =
    saleForm.payment_method === 'credit' ? 0
    : saleForm.payment_method === 'avance' ? saleForm.avance
    : Math.max(netAPayer, 0)
  const montantRendu   =
    saleForm.payment_method === 'especes' && saleForm.montant_especes > 0 && saleForm.montant_especes > netAPayer
      ? saleForm.montant_especes - netAPayer
      : saleForm.payment_method === 'mixte' && (saleForm.montant_especes + saleForm.montant_carte) > 0 && (saleForm.montant_especes + saleForm.montant_carte) > netAPayer
      ? (saleForm.montant_especes + saleForm.montant_carte) - netAPayer
      : 0

  // ── Submit ────────────────────────────────────────────────
  async function handleSubmit() {
    if (cart.length === 0) { showError(isAr ? 'السلة فارغة' : 'Panier vide'); return }
    if (saleForm.payment_method === 'virement' && !saleForm.payment_ref) {
      showError(isAr ? 'مرجع التحويل مطلوب' : 'Référence virement obligatoire'); return
    }
    if (saleForm.payment_method === 'avance' && saleForm.avance > 0 && !saleForm.avance_sub_method) {
      showError(isAr ? 'يرجى تحديد طريقة دفع التسبيق' : "Précisez le mode de paiement de l'avance"); return
    }
    if (saleForm.payment_method === 'credit' && !saleForm.client_nom.trim()) {
      showError(isAr ? 'اسم العميل مطلوب للبيع الآجل' : 'Nom du client obligatoire pour une vente à crédit'); return
    }

    setSubmitting(true)
    try {
      let clientId: string | undefined = selectedClientId ?? undefined
      if (!clientId && (saleForm.client_nom.trim() || saleForm.client_tel.trim())) {
        const cRes  = await fetch('/api/clients', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nom: saleForm.client_nom || saleForm.client_tel, telephone: saleForm.client_tel, store_id: storeId }),
        })
        clientId = (await cRes.json()).data?.client_id
      }

      let lastTxnId: string | null = null
      // Cart items post as separate transaction rows (no shared sale_id in the schema), so
      // per-sale totals (avance / montant_especes / montant_carte / valeur_echange) must be
      // PRORATED across rows by each item's share of the cart — stamping the full amount on
      // every row would make caisse count the same cash multiple times for one payment.
      let allocAvance = 0, allocEspeces = 0, allocCarte = 0, allocEchange = 0
      for (let i = 0; i < cart.length; i++) {
        const item   = cart[i]
        const isLast = i === cart.length - 1
        const itemPv = item.prix_vente_saisi * (item.qty ?? 1)
        const share  = totalVente > 0 ? itemPv / totalVente : 0

        const itemAvance  = isLast ? round2(saleForm.avance          - allocAvance ) : round2(saleForm.avance          * share)
        const itemEspeces = isLast ? round2(saleForm.montant_especes - allocEspeces) : round2(saleForm.montant_especes * share)
        const itemCarte   = isLast ? round2(saleForm.montant_carte   - allocCarte  ) : round2(saleForm.montant_carte   * share)
        const itemEchange = isLast ? round2(saleForm.valeur_echange  - allocEchange) : round2(saleForm.valeur_echange  * share)
        allocAvance  += itemAvance
        allocEspeces += itemEspeces
        allocCarte   += itemCarte
        allocEchange += itemEchange

        const res  = await fetch('/api/transactions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            store_id:        storeId,
            device_type:     item._type === 'phone' ? 'telephone' : item._type === 'laptop' ? 'laptop' : 'accessoire',
            device_id:       item._id,
            client_id:       clientId,
            type_operation:  saleForm.type_operation,
            qty:             item.qty ?? 1,
            prix_vente:      itemPv,
            payment_method:  saleForm.payment_method === 'avance' ? (saleForm.avance_sub_method as PaymentMethod) : saleForm.payment_method,
            avance:          itemAvance  || 0,
            payment_ref:     saleForm.payment_ref     || undefined,
            montant_especes: itemEspeces || 0,
            montant_carte:   itemCarte   || 0,
            valeur_echange:  saleForm.type_operation === 'echange' ? itemEchange : 0,
            marque_echange:  saleForm.marque_echange  || undefined,
            model_echange:   saleForm.model_echange   || undefined,
            imei_echange:    saleForm.imei_echange    || undefined,
            description_echange: saleForm.description_echange || undefined,
            warranty_start:  new Date().toISOString().split('T')[0],
            notes:           saleForm.notes           || undefined,
            montant_rendu:   montantRendu > 0 ? montantRendu : 0,
            override_required: overrideAuthorizedBy != null ? true : undefined,
            override_by:       overrideAuthorizedBy ?? undefined,
            override_reason:   overrideAuthorizedBy != null ? overrideReason : undefined,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        lastTxnId = json.data.txn_id
      }

      setSuccessTxn(lastTxnId)
      setReceiptData({
        store_name: portal.storeName, txn_id: lastTxnId ?? '—',
        date_vente: new Date().toISOString(), cashier_name: user?.display_name ?? '—',
        items: cart.map(item => ({
          name: item._displayName, qty: item.qty ?? 1,
          unit_price: item.prix_vente_saisi, line_total: item.prix_vente_saisi * (item.qty ?? 1),
          imei: (item as Phone).imei ?? undefined,
        })),
        total: totalVente,
        avance:         saleForm.avance        > 0 ? saleForm.avance        : undefined,
        valeur_echange: saleForm.valeur_echange > 0 ? saleForm.valeur_echange : undefined,
        fariq, payment_method: saleForm.payment_method,
        montant_especes: saleForm.montant_especes || undefined,
        montant_carte:   saleForm.montant_carte   || undefined,
        montant_rendu:   montantRendu > 0 ? montantRendu : undefined,
      })
      showSuccess(isAr ? 'تمت عملية البيع ✓' : 'Vente enregistrée ✓')

      // Register debt in Credits module for آجل and تسبيق sales with remaining balance
      const debtAmount = Math.max(0, totalVente - (saleForm.avance || 0))
      if (
        clientId &&
        debtAmount > 0 &&
        (saleForm.payment_method === 'credit' || saleForm.payment_method === 'avance')
      ) {
        fetch('/api/credit-imports', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id:    clientId,
            store_id:     storeId,
            montant_du:   debtAmount,
            description:  cart.map(i => i._displayName).join(' + ').slice(0, 200),
            date_origine: new Date().toISOString().split('T')[0],
            notes:        `POS — ${saleForm.payment_method === 'credit' ? 'Vente à crédit' : 'Avance partielle'} — Réf: ${lastTxnId}`,
          }),
        }).catch(() => { /* non-blocking — sale already recorded */ })
      }

      // Remove sold phones/laptops from grid instantly — no re-fetch needed
      const sold = new Set(cart.filter(i => i._type !== 'accessory').map(i => i._id))
      if (sold.size > 0) setSoldIds(prev => new Set([...Array.from(prev), ...Array.from(sold)]))

      if (saleForm.valeur_echange > 0) {
        setExchangePanel({
          open:                    true,
          txn_id:                  lastTxnId || '',
          valeur_echange:          saleForm.valeur_echange,
          marque_echange:          saleForm.marque_echange          ?? '',
          model_echange:           saleForm.model_echange           ?? '',
          imei_echange:            saleForm.imei_echange            ?? '',
          couleur_echange:         saleForm.couleur_echange         ?? '',
          stockage_echange:        saleForm.stockage_echange        ?? '',
          battery_echange:         saleForm.battery_echange,
          ram_echange:             saleForm.ram_echange             ?? '',
          prix_vente_echange:      saleForm.prix_vente_echange,
          prix_min_echange:        saleForm.prix_min_echange,
          echange_vers_reparation: saleForm.echange_vers_reparation ?? false,
        })
      }
      setCart([]); setPriceInputs({}); setSaleForm({ ...EMPTY_SALE }); setOverrideAuthorizedBy(null); setOverrideReason(''); setSelectedClientId(null); setClientSuggestions([])
    } catch (err: unknown) {
      showError((err as Error).message)
    } finally { setSubmitting(false) }
  }

  // ── Category list ──────────────────────────────────────────

  function getCategoryColor(idx: number, total: number): string {
    const hue        = Math.round((idx / total) * 360)
    const saturation = 65
    const lightness  = idx % 2 === 0 ? 38 : 44   // slight alternation keeps adjacent hues visually distinct
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`
  }

  const categoryList = [
    { key: 'phones',  label: isAr ? 'هواتف'  : 'Téléphones', icon: <Smartphone className="w-3.5 h-3.5" /> },
    ...(hasLaptops ? [{ key: 'laptops', label: isAr ? 'لابتوب' : 'Laptops', icon: <LaptopIcon className="w-3.5 h-3.5" /> }] : []),
    ...sortedAccCategories.map(cat => ({
      key: `acc_${cat.code}`, label: isAr ? cat.ar : cat.fr, icon: <Package className="w-3.5 h-3.5" />,
    })),
  ]

  // ── Unified display source ─────────────────────────────────
  const isSearching   = search.length >= 2
  const allItems      = isSearching ? results   : gridItems
  // The grid renders in pages: a smaller page keeps the POS instant to open
  const [shown, setShown] = useState(GRID_PAGE)
  useEffect(() => setShown(GRID_PAGE), [activeCategory, search])
  const displayItems  = allItems.slice(0, shown)
  const displayLoading = !isSearching && gridLoading

  // ── Main layout ───────────────────────────────────────────
  return (
    <div className="h-full flex flex-col lg:flex-row overflow-hidden animate-fade-in relative" dir={isAr ? 'rtl' : 'ltr'}>

      {/* ── SUCCESS OVERLAY — grid stays mounted, no re-fetch on dismiss ── */}
      {successTxn && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/90 backdrop-blur-sm">
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
              <Btn variant="primary" onClick={() => setReceiptOpen(true)} style={{ backgroundColor: primary } as React.CSSProperties}>
                <Printer className="w-4 h-4" />
                {isAr ? 'طباعة الفاتورة' : 'Imprimer reçu'}
              </Btn>
              {receiptOpen && receiptData && <ReceiptPrint data={receiptData} onClose={() => setReceiptOpen(false)} />}
            </div>
          </div>
        </div>
      )}

      {/* ── CATEGORY SIDEBAR — vertical, lg+ only ────────── */}
      {!isSearching && (
        <div className="hidden lg:flex flex-col w-32 flex-shrink-0 border-r border-[#E8E5DE] bg-white overflow-hidden">
          <div className="px-3 py-3 border-b border-[#E8E5DE] flex-shrink-0">
            <p className="text-[9px] font-bold text-[#B0ADA6] uppercase tracking-widest text-center">
              {isAr ? 'الفئات' : 'Catégories'}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto py-1 px-1.5">
            {categoryList.map((cat, idx) => {
              const cc       = getCategoryColor(idx, categoryList.length)
              const isActive = activeCategory === cat.key
              return (
                <button key={cat.key} onClick={() => setActiveCategory(cat.key)}
                  className="w-full flex flex-col items-center gap-1 px-1 py-3 rounded-xl text-[10px] font-bold transition-all text-center leading-tight mb-0.5"
                  style={{
                    backgroundColor: isActive ? `${cc}18` : 'transparent',
                    color:           isActive ? cc : '#9CA3AF',
                    borderLeft:  !isAr ? (isActive ? `3px solid ${cc}` : '3px solid transparent') : undefined,
                    borderRight:  isAr ? (isActive ? `3px solid ${cc}` : '3px solid transparent') : undefined,
                  }}>
                  <span style={{ color: cc, opacity: isActive ? 1 : 0.5 }}>{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── LEFT panel ───────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-[#E8E5DE]">

        {/* Zone A */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E8E5DE] flex-shrink-0 bg-white">
          <p className="font-bold text-sm tracking-widest" style={{ color: primary, fontFamily: "'Barlow Condensed', sans-serif" }}>
            {portal.storeName.toUpperCase()}
          </p>
          <LiveClock />
        </div>

        {/* Zone B — Search */}
        <div className="px-5 pt-4 pb-2 flex-shrink-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0ADA6]" />
              <input
                className="w-full pl-9 pr-10 py-3 bg-white border-2 border-[#E8E5DE] rounded-xl text-sm placeholder:text-[#B0ADA6] focus:outline-none transition-all"
                placeholder={isAr ? 'IMEI، ماركة، موديل، إكسسوار...' : 'IMEI, marque, modèle, accessoire...'}
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
                onFocus={e => { e.target.style.borderColor = primary; e.target.style.boxShadow = `0 0 0 3px ${primary}20` }}
                onBlur={e =>  { e.target.style.borderColor = '#E8E5DE'; e.target.style.boxShadow = 'none' }}
              />
              {search ? (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B0ADA6] hover:text-[#1A1A1A]">
                  <X className="w-4 h-4" />
                </button>
              ) : null}
            </div>
            <ScanButton onScan={v => setSearch(v)} hint="Scannez un IMEI ou code-barres" mode="barcode" color={primary} />
          </div>
        </div>

        {/* Zone C — Mobile-only category pills */}
        {!isSearching && (
          <div className="lg:hidden px-5 py-2 flex-shrink-0">
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {categoryList.map((cat, idx) => {
                const cc       = getCategoryColor(idx, categoryList.length)
                const isActive = activeCategory === cat.key
                return (
                  <button key={cat.key} onClick={() => setActiveCategory(cat.key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-all flex-shrink-0"
                    style={{
                      backgroundColor: isActive ? cc : 'white',
                      borderColor:     cc,
                      color:           isActive ? 'white' : cc,
                    }}>
                    {cat.icon}{cat.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Zone D — Unified product grid (search results OR category browse) */}
        <div className="flex-1 overflow-y-auto px-5 pb-2">
          {displayLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 text-[#B0ADA6]" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : isSearching && results.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <Search className="w-8 h-8 text-[#B0ADA6] mb-2 opacity-40" />
              <p className="text-sm text-[#B0ADA6]">{t(isAr, 'common.noResults')}</p>
            </div>
          ) : !isSearching && gridItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <Package className="w-8 h-8 text-[#B0ADA6] mb-2 opacity-40" />
              <p className="text-sm text-[#B0ADA6]">{isAr ? 'لا توجد منتجات متاحة' : 'Aucun produit disponible'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-1">
              {displayItems.map(item => (
                <button key={item._id} onClick={() => addToCart(item)}
                  className="bg-white border border-[#E8E5DE] rounded-2xl p-3 text-left hover:shadow-md transition-all active:scale-[0.98]"
                  onMouseEnter={e => (e.currentTarget.style.borderColor = primary)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#E8E5DE')}>
                  <div className="mb-2">
                    {(item as unknown as { marque?: string }).marque
                      ? <BrandLogo marque={(item as unknown as { marque?: string }).marque!} size="md" />
                      : <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${primary}12` }}>
                          <Package className="w-5 h-5" style={{ color: primary }} />
                        </div>
                    }
                  </div>
                  <p className="text-xs font-bold text-[#1A1A1A] leading-tight truncate">{item._displayName}</p>
                  <p className="text-[10px] text-[#B0ADA6] mt-0.5 truncate">
                    {item._type === 'accessory'
                      ? (t(isAr, 'common.accessory'))
                      : ((item as Phone).imei ? (item as Phone).imei?.slice(-6) : (t(isAr, 'common.available')))}
                  </p>
                  <p className="text-sm font-bold mt-2" style={{ color: primary }}>
                    {formatMAD(item._type === 'accessory' ? getAccPrice(item) : (item as Phone).prix_vente_recommande ?? 0)}
                  </p>
                </button>
              ))}
              {allItems.length > shown && (
                <button onClick={() => setShown(n => n + GRID_PAGE)}
                  className="col-span-full py-3 text-sm font-medium text-[#6B6860] hover:bg-white rounded-xl transition-all">
                  {isAr ? `عرض المزيد (${allItems.length - shown})` : `Afficher plus (${allItems.length - shown})`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Zone E — Cart strip */}
        <div className="flex-shrink-0 border-t border-[#E8E5DE] bg-white">
          <div className="px-5 py-3 max-h-48 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex items-center gap-3 text-[#B0ADA6] py-1">
                <ShoppingCart className="w-4 h-4" />
                <p className="text-xs">{isAr ? 'السلة فارغة — اضغط على بطاقة لإضافتها' : 'Panier vide — tapez une carte pour ajouter'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((item, idx) => (
                  <div key={item._id} className="flex items-center gap-3 bg-[#F8F7F4] border border-[#E8E5DE] rounded-xl px-3 py-2">
                    <span className="text-xs font-bold text-[#B0ADA6] w-5 text-center flex-shrink-0">{idx + 1}</span>
                    {(item as unknown as { marque?: string }).marque
                      ? <BrandLogo marque={(item as unknown as { marque?: string }).marque!} size="sm" />
                      : <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${primary}12` }}>
                          <Package className="w-3.5 h-3.5" style={{ color: primary }} />
                        </div>
                    }
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs font-bold text-[#1A1A1A] truncate">{item._displayName}</p>
                        {(item as Phone).promo_type && (item as Phone).promo_montant && (
                          <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: '#FAF5E8', color: '#C9A440', border: '1px solid #E8D494' }}>
                            {(item as Phone).promo_type === 'pourcentage'
                              ? `PROMO -${(item as Phone).promo_montant}%`
                              : `PROMO -${(item as Phone).promo_montant} MAD`}
                          </span>
                        )}
                      </div>
                      {(item as Phone).imei && (
                        <p className="text-[10px] text-[#B0ADA6] font-mono truncate">{(item as Phone).imei}</p>
                      )}
                      {(item as Phone).promo_type && (item as Phone).promo_montant && (item as Phone).prix_vente_recommande && (
                        <p className="text-[9px] font-bold mt-0.5" style={{ color: '#C9A440' }}>
                          {isAr ? 'السعر المقترح بعد الخصم:' : 'Prix suggéré après promo :'}{' '}
                          {formatMAD(computePromoPrice((item as Phone).prix_vente_recommande ?? 0, (item as Phone).promo_type, (item as Phone).promo_montant) ?? 0)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {item._type === 'accessory' && (
                        <div className="flex items-center gap-0.5">
                          <button type="button"
                            onClick={() => setCart(prev => prev.map(c => c._id === item._id ? { ...c, qty: Math.max(1, (c.qty ?? 1) - 1) } : c))}
                            className="w-6 h-6 rounded-lg border border-[#E8E5DE] flex items-center justify-center text-[#6B6860] hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition-all">
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-6 text-center text-xs font-bold text-[#1A1A1A] tabular-nums">{item.qty ?? 1}</span>
                          <button type="button"
                            onClick={() => setCart(prev => prev.map(c => c._id === item._id ? { ...c, qty: (c.qty ?? 1) + 1 } : c))}
                            className="w-6 h-6 rounded-lg border border-[#E8E5DE] flex items-center justify-center text-[#6B6860] hover:bg-[#F2F0EB] transition-all">
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      <input type="number" min={0} step={0.01} inputMode="decimal"
                        className="w-24 border border-[#E8E5DE] rounded-lg px-2 py-1 text-xs font-bold text-right bg-white focus:outline-none"
                        value={priceInputs[item._id] !== undefined ? priceInputs[item._id] : (item.prix_vente_saisi || '')}
                        onChange={e => handlePriceChange(item._id, e.target.value)}
                        onBlur={e   => handlePriceBlur(item._id, e.target.value)}
                        style={{ borderColor: isBelowMinimum(item.prix_vente_saisi, (item as Phone).prix_vente_minimum) ? '#F59E0B' : undefined }} />
                      {canSeeAchat && (item as Phone).prix_achat && (
                        <span className={`text-[10px] font-bold w-16 text-right flex-shrink-0 ${item.prix_vente_saisi - ((item as Phone).prix_achat || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {formatMAD(item.prix_vente_saisi - ((item as Phone).prix_achat || 0))}
                        </span>
                      )}
                      <button onClick={() => removeFromCart(item._id)}
                        className="p-1 rounded-lg text-[#B0ADA6] hover:text-red-500 hover:bg-red-50 transition-all">
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

      {/* ── RIGHT panel ──────────────────────────────────────── */}
      <div className="w-full lg:w-96 flex flex-col bg-[#F8F7F4] border-t lg:border-t-0 border-[#E8E5DE] overflow-y-auto">
        <div className="p-5 space-y-5">

          {/* Operation type */}
          <div>
            <p className="text-xs font-bold text-[#6B6860] uppercase tracking-widest mb-3 flex items-center gap-2">
              <ArrowLeftRight className="w-3.5 h-3.5" />
              {isAr ? 'نوع العملية' : "Type d'opération"}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {(['vente', 'echange'] as OperationType[]).map(op => (
                <button key={op} onClick={() => setSale('type_operation', op)}
                  className="py-2.5 rounded-xl text-xs font-bold border transition-all"
                  style={{
                    backgroundColor: saleForm.type_operation === op ? primary : 'white',
                    borderColor:     saleForm.type_operation === op ? primary : '#E8E5DE',
                    color:           saleForm.type_operation === op ? 'white' : '#6B6860',
                  }}>
                  {op === 'vente' ? (t(isAr, 'common.sale')) : (isAr ? 'إستبدال' : 'Échange')}
                </button>
              ))}
              <button onClick={() => setRetourOpen(true)}
                className="py-2.5 rounded-xl text-xs font-bold border transition-all"
                style={{ backgroundColor: 'white', borderColor: '#FCA5A5', color: '#EF4444' }}>
                {t(isAr, 'common.returnNoun')}
              </button>
            </div>
          </div>

          {/* Exchange block */}
          {saleForm.type_operation === 'echange' && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3 animate-fade-in">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-widest">{isAr ? 'الجهاز المستبدل' : 'Appareil échangé'}</p>
              <ComboBox options={brands} value={saleForm.marque_echange}
                onChange={v => { setSale('marque_echange', v); setSale('model_echange', ''); setSale('couleur_echange', '') }}
                placeholder={t(isAr, 'common.brand')} />
              <ComboBox options={modelsFor(saleForm.marque_echange)} value={saleForm.model_echange}
                onChange={v => { setSale('model_echange', v); setSale('couleur_echange', '') }}
                placeholder={!saleForm.marque_echange ? "Choisissez d'abord la marque" : (t(isAr, 'common.model'))}
                disabled={!saleForm.marque_echange} />
              <div className="grid grid-cols-2 gap-2">
                <ComboBox options={couleursFor(saleForm.model_echange)} value={saleForm.couleur_echange ?? ''}
                  onChange={v => setSale('couleur_echange', v)}
                  placeholder={!saleForm.model_echange ? "Modèle d'abord" : 'Couleur'} disabled={!saleForm.model_echange} />
                <ComboBox options={['32GB','64GB','128GB','256GB','512GB','1TB']} value={saleForm.stockage_echange ?? ''}
                  onChange={v => setSale('stockage_echange', v)} placeholder="Stockage" />
              </div>
              {saleForm.marque_echange?.toLowerCase().includes('apple') ? (
                <div>
                  <label className="text-xs text-blue-700 font-medium">Batterie (%)</label>
                  <input type="number" min={0} max={100} className={`${inputClass} mt-1`} placeholder="85"
                    value={saleForm.battery_echange ?? ''} onChange={e => setSale('battery_echange', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
              ) : (
                <div>
                  <label className="text-xs text-blue-700 font-medium">RAM</label>
                  <input className={`${inputClass} mt-1`} placeholder="4GB…"
                    value={saleForm.ram_echange ?? ''} onChange={e => setSale('ram_echange', e.target.value)} />
                </div>
              )}
              <div>
                <label className="text-xs text-blue-700 font-medium">IMEI</label>
                <div className="flex gap-2 mt-1">
                  <input className={inputClass} placeholder="356XXXXXXXXXXXXX" type="text" inputMode="numeric"
                    value={saleForm.imei_echange}
                    onChange={e => setSale('imei_echange', e.target.value.replace(/\D/g, '').slice(0, 15))} />
                  <ScanButton onScan={v => setSale('imei_echange', v)} hint="Scannez l'IMEI de l'appareil repris" color={primary} mode="barcode" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-blue-700 font-medium">{isAr ? 'سعر البيع المقترح' : 'Prix vente (MAD)'}</label>
                  <input type="number" className={`${inputClass} mt-1`} placeholder="0"
                    value={saleForm.prix_vente_echange ?? ''} onChange={e => setSale('prix_vente_echange', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="text-xs text-blue-700 font-medium">{isAr ? 'السعر الأدنى' : 'Prix minimum (MAD)'}</label>
                  <input type="number" className={`${inputClass} mt-1`} placeholder="0"
                    value={saleForm.prix_min_echange ?? ''} onChange={e => setSale('prix_min_echange', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
              </div>
              <div>
                <label className="text-xs text-blue-700 font-medium">{isAr ? 'قيمة الاستبدال (تُخصم من الإجمالي)' : 'Valeur échange déduite (MAD)'}</label>
                <input type="number" className={`${inputClass} mt-1`}
                  value={saleForm.valeur_echange || ''} onChange={e => setSale('valeur_echange', Number(e.target.value))} />
              </div>
              <div>
                <label className="text-xs text-blue-700 font-medium block mb-1">{isAr ? 'ملاحظات عن الجهاز' : "Notes sur l'appareil repris"}</label>
                <textarea className={`${inputClass} resize-none text-xs`} rows={2}
                  placeholder={isAr ? 'حالة الجهاز، الخدوش...' : 'État, rayures, problèmes connus...'}
                  value={saleForm.description_echange} onChange={e => setSale('description_echange', e.target.value)} />
              </div>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <div onClick={() => setSale('echange_vers_reparation', !saleForm.echange_vers_reparation)}
                  className={`w-10 h-5 rounded-full transition-colors flex-shrink-0 flex items-center px-0.5 ${saleForm.echange_vers_reparation ? 'bg-amber-500' : 'bg-[#D4D1CC]'}`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${saleForm.echange_vers_reparation ? 'translate-x-5' : 'translate-x-0'}`} />
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
                { v: 'especes',    fr: 'Espèces',  ar: 'نقداً'       },
                { v: 'virement', fr: 'Virement',  ar: 'تحويل بنكي' },
                { v: 'avance', fr: 'Avance',    ar: 'تسبيق'      },
                { v: 'mixte', fr: 'Mixte',     ar: 'مختلط'      },
                { v: 'credit',   fr: 'À crédit',  ar: 'آجل'        },
              ] as { v: PaymentMethod; fr: string; ar: string }[]).map(({ v, fr, ar }) => (
                <button key={v} type="button" onClick={() => setSale('payment_method', v)}
                  className="py-2 rounded-xl text-xs font-bold border transition-all"
                  style={{
                    backgroundColor: saleForm.payment_method === v ? primary : 'white',
                    borderColor:     saleForm.payment_method === v ? primary : '#E8E5DE',
                    color:           saleForm.payment_method === v ? 'white' : '#6B6860',
                  }}>
                  {isAr ? ar : fr}
                </button>
              ))}
            </div>

            {saleForm.payment_method === 'credit' && (
              <div className="mt-2 p-3 bg-purple-50 border border-purple-200 rounded-xl">
                <p className="text-xs font-medium text-purple-700">
                  {isAr ? 'سيُسجَّل المبلغ كاملاً كذمة على العميل — لا شيء يُحصَّل الآن' : "La totalité sera enregistrée comme créance client — rien n'est encaissé maintenant"}
                </p>
              </div>
            )}
            {saleForm.payment_method === 'virement' && (
              <input className={`${inputClass} mt-2`} placeholder={t(isAr, 'common.transferReference')}
                value={saleForm.payment_ref} onChange={e => setSale('payment_ref', e.target.value)} />
            )}
            {saleForm.payment_method === 'avance' && (
              <div className="mt-2 space-y-2">
                <input type="number" min={0} step={0.01} inputMode="decimal" className={inputClass}
                  placeholder={isAr ? 'مبلغ التسبيق (درهم)' : 'Montant avance (MAD)'}
                  value={saleForm.avance || ''} onChange={e => setSale('avance', Number(e.target.value))} />
                <div>
                  <p className="text-[10px] font-bold text-[#6B6860] uppercase tracking-widest mb-1.5">
                    {isAr ? 'طريقة دفع التسبيق *' : "Paiement de l'avance *"}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['especes', 'virement'] as const).map(method => (
                      <button key={method} type="button" onClick={() => setSale('avance_sub_method', method)}
                        className="py-2 rounded-xl text-xs font-bold border transition-all"
                        style={{
                          backgroundColor: saleForm.avance_sub_method === method ? primary : 'white',
                          borderColor:     saleForm.avance_sub_method === method ? primary : '#E8E5DE',
                          color:           saleForm.avance_sub_method === method ? 'white' : '#6B6860',
                        }}>
                        {method === 'especes' ? (t(isAr, 'common.cashAdverbial')) : (t(isAr, 'common.bankTransfer'))}
                      </button>
                    ))}
                  </div>
                  {saleForm.avance > 0 && !saleForm.avance_sub_method && (
                    <p className="text-[10px] text-amber-600 mt-1 font-medium">
                      {isAr ? '⚠ يرجى تحديد كيفية دفع التسبيق' : "⚠ Précisez comment l'avance a été réglée"}
                    </p>
                  )}
                </div>
              </div>
            )}
            {saleForm.payment_method === 'mixte' && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <input type="number" min={0} step={0.01} inputMode="decimal" className={inputClass}
                  placeholder={t(isAr, 'common.cash')}
                  value={saleForm.montant_especes || ''} onChange={e => setSale('montant_especes', Number(e.target.value))} />
                <input type="number" min={0} step={0.01} inputMode="decimal" className={inputClass}
                  placeholder={t(isAr, 'common.transfer')}
                  value={saleForm.montant_carte || ''} onChange={e => setSale('montant_carte', Number(e.target.value))} />
              </div>
            )}

            {/* Inline client — آجل or تسبيق only */}
            {(saleForm.payment_method === 'credit' || saleForm.payment_method === 'avance') && (
              <div className="mt-3 p-3 bg-white border border-[#E8E5DE] rounded-xl space-y-2 animate-fade-in">
                <p className="text-[10px] font-bold text-[#6B6860] uppercase tracking-widest flex items-center gap-1.5">
                  <User className="w-3 h-3" />
                  {t(isAr, 'common.client')}
                  {saleForm.payment_method === 'credit' && (
                    <span className="text-purple-600 font-bold normal-case tracking-normal">
                      {'— '}{isAr ? 'مطلوب' : 'requis'}
                    </span>
                  )}
                  {selectedClientId && (
                    <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 normal-case tracking-normal">
                      ✓ {t(isAr, 'common.existing')}
                    </span>
                  )}
                </p>
                {/* Name with live autocomplete */}
                <div className="relative">
                  <input className={inputClass}
                    placeholder={saleForm.payment_method === 'credit' ? (t(isAr, 'common.nameRequired')) : (isAr ? 'الاسم (اختياري)' : 'Nom (optionnel)')}
                    value={saleForm.client_nom}
                    onChange={e => handleClientNameChange(e.target.value)}
                    onBlur={() => setTimeout(() => setShowClientDrop(false), 150)}
                    autoComplete="off" />
                  {showClientDrop && clientSuggestions.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-[#E8E5DE] rounded-xl shadow-xl overflow-hidden max-h-44 overflow-y-auto">
                      {clientSuggestions.map(c => (
                        <button key={c.client_id} type="button"
                          onMouseDown={() => selectClientSuggestion(c)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F8F7F4] transition-all text-left border-b border-[#F2F0EB] last:border-0">
                          <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${primary}15` }}>
                            <User className="w-3 h-3" style={{ color: primary }} />
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
                <input className={inputClass} placeholder="06XXXXXXXX"
                  value={saleForm.client_tel}
                  onChange={e => { setSale('client_tel', e.target.value.replace(/\D/g, '').slice(0, 10)); setSelectedClientId(null) }}
                  type="tel" maxLength={10} />
              </div>
            )}
          </div>

          {/* Notes */}
          <textarea className={`${inputClass} resize-none text-xs`} rows={2}
            placeholder={t(isAr, 'common.notesPlaceholder')}
            value={saleForm.notes} onChange={e => setSale('notes', e.target.value)} />

          {/* Summary */}
          <div className="bg-white border border-[#E8E5DE] rounded-2xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[#6B6860]">{isAr ? 'مجموع السلة' : 'Total panier'}</span>
              <span className="font-bold text-[#1A1A1A]">{formatMAD(totalVente)}</span>
            </div>
            {saleForm.avance > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[#6B6860]">{t(isAr, 'common.avance')}</span>
                <span className="text-[#1A1A1A]">- {formatMAD(saleForm.avance)}</span>
              </div>
            )}
            {saleForm.type_operation === 'echange' && saleForm.valeur_echange > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[#6B6860]">{isAr ? 'قيمة الاستبدال' : 'Valeur échange'}</span>
                <span className="text-[#1A1A1A]">- {formatMAD(saleForm.valeur_echange)}</span>
              </div>
            )}
            {saleForm.type_operation === 'echange' && netAPayer < 0 && (
              <div className="flex justify-between text-sm font-bold text-amber-700">
                <span>{isAr ? 'يُرجَع للعميل' : 'À rendre au client'}</span>
                <span>{formatMAD(-netAPayer)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold">
              <span className="text-[#1A1A1A]">{isAr ? 'المبلغ المُحصَّل الآن' : 'À encaisser maintenant'}</span>
              <span className="text-[#1A1A1A]">{formatMAD(aEncaisser)}</span>
            </div>
            {montantRendu > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[#6B6860]">{isAr ? 'المبلغ المُسلَّم' : 'Espèces remises'}</span>
                <span className="text-[#1A1A1A]">{formatMAD(saleForm.payment_method === 'especes' ? saleForm.montant_especes : saleForm.montant_especes + saleForm.montant_carte)}</span>
              </div>
            )}
            <div className="flex justify-between items-end pt-2 border-t border-[#E8E5DE]">
              <span className="font-bold text-[#1A1A1A]">{isAr ? 'المتبقي للدفع' : 'Reste à payer'}</span>
              <div className="text-right">
                <p className="font-display font-bold text-xl" style={{ color: primary }}>{formatMAD(displayFariq)}</p>
                <StatusBadge domain="payment_status" code={statutPaiement} lang={isAr ? 'ar' : 'fr'} />
                {montantRendu > 0 && (
                  <div className="mt-1 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-bold text-emerald-700">
                    {isAr ? `المونطان رونديو: ${formatMAD(montantRendu)}` : `Rendu: ${formatMAD(montantRendu)}`}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Submit */}
          <button onClick={handleSubmit} disabled={cart.length === 0 || submitting}
            className="w-full py-3 rounded-2xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: primary, color: 'white' }}>
            {submitting ? (t(isAr, 'common.saving')) : (isAr ? 'تأكيد البيع' : 'Confirmer la vente')}
          </button>

          {/* Reset */}
          <button type="button"
            onClick={() => { setCart([]); setPriceInputs({}); setSaleForm({ ...EMPTY_SALE }); setOverrideAuthorizedBy(null); setOverrideReason(''); setSelectedClientId(null); setClientSuggestions([]) }}
            className="w-full py-2.5 rounded-2xl text-xs font-bold border border-[#E8E5DE] text-[#B0ADA6] hover:border-red-300 hover:text-red-400 transition-all">
            {isAr ? '× مسح الكل' : '× Réinitialiser'}
          </button>

          {/* Cash Drop */}
          <button type="button" onClick={() => setCashDropOpen(true)}
            className="w-full py-2.5 rounded-2xl text-xs font-bold border border-[#E8E5DE] text-[#6B6860] hover:border-emerald-400 hover:text-emerald-600 transition-all flex items-center justify-center gap-1.5">
            <span>＋</span>
            {t(isAr, 'common.manualCashDeposit')}
          </button>

          <CashDropModal
            open={cashDropOpen}
            onClose={() => setCashDropOpen(false)}
            storeId={storeId}
            isAr={isAr}
            primary={primary}
          />
        </div>
      </div>

      {exchangePanel?.open && (
        <div className="fixed inset-0 z-40 flex items-end lg:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5">
              <ExchangeIntakePanel
                key={exchangePanel.txn_id}
                exchangePanel={exchangePanel}
                storeId={storeId}
                isAr={isAr}
                onSuccess={_phoneId => setExchangePanel(p => p ? { ...p, open: false } : null)}
                onClose={() => setExchangePanel(p => p ? { ...p, open: false } : null)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Retour modal */}
      <RetourModal open={retourOpen} onClose={() => setRetourOpen(false)} storeId={storeId} primary={primary}
        onRetourDone={() => { setCart([]); setSaleForm({ ...EMPTY_SALE }) }} />

      <OverridePinModal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        overrideItem={overrideItem}
        isAr={isAr}
        primary={primary}
        onAuthorized={handleOverrideAuthorized}
      />

      <QtyPickerModal
        device={qtyPicker ? { _id: qtyPicker.device._id, _displayName: qtyPicker.device._displayName, price: getAccPrice(qtyPicker.device) } : null}
        qty={qtyPicker?.qty ?? 1}
        onQtyChange={qty => setQtyPicker(p => p ? { ...p, qty } : p)}
        onConfirm={confirmQtyPicker}
        onClose={() => setQtyPicker(null)}
        primary={primary}
        isAr={isAr}
      />

    </div>
  )
}