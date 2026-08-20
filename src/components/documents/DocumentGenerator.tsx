'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  FileText, Package, Wrench, Archive,
  Scan, X, Printer, Loader2,
  User, Phone, CreditCard, ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import { ConfirmSaleModal } from './ConfirmSaleModal'
import { ArchiveTable }     from './ArchiveTable'
import { AcquisitionTab }   from './AcquisitionTab'
import { SavTab }           from './SavTab'

// ── Types ─────────────────────────────────────────────────────────────────────

type ActiveTab = 'fac' | 'reprise' | 'sav' | 'archive'

interface PhoneData {
  phone_id:              string
  imei:                  string
  marque:                string
  model:                 string
  stockage:              string
  ram:                   string
  couleur:               string
  condition:             string
  prix_vente_recommande: number
  prix_vente_minimum:    number
  warranty_months:       number
}

interface FacForm {
  phone_id:        string
  imei:            string
  marque:          string
  model:           string
  stockage:        string
  ram:             string
  couleur:         string
  condition:       string
  warranty_months: number
  client_type:     'particulier' | 'professionnel'
  client_name:     string
  client_tel:      string
  client_cin:      string
  nature:          'directe' | 'reprise'
  prix_vente:      number
  remise:          number
  accessories:     string
  defauts:         string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_FAC: FacForm = {
  phone_id: '', imei: '', marque: '', model: '', stockage: '',
  ram: '', couleur: '', condition: 'Occasion', warranty_months: 1,
  client_type: 'particulier', client_name: '', client_tel: '', client_cin: '',
  nature: 'directe', prix_vente: 0, remise: 0, accessories: '', defauts: '',
}

const WARRANTY_MAP: Record<string, number> = {
  'Neuf': 12, 'Reconditionné': 3, 'Occasion': 1, 'Pour pièces': 0,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const addMonths = (d: Date, months: number): Date => {
  const r = new Date(d)
  r.setMonth(r.getMonth() + Math.floor(months))
  if (months % 1 > 0) r.setDate(r.getDate() + Math.round((months % 1) * 30))
  return r
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString('fr-MA', { day: '2-digit', month: '2-digit', year: 'numeric' })

// ── Component ─────────────────────────────────────────────────────────────────

export function DocumentGenerator() {
  const [activeTab,    setActiveTab]    = useState<ActiveTab>('fac')
  const [facForm,      setFacForm]      = useState<FacForm>(DEFAULT_FAC)
  const [imeiInput,    setImeiInput]    = useState('')
  const [lookingUp,    setLookingUp]    = useState(false)
  const [printing,     setPrinting]     = useState(false)
  const [pendingDoc,   setPendingDoc]   = useState<{ doc_id: string; doc_ref: string } | null>(null)
  const [showConfirm,  setShowConfirm]  = useState(false)
  const [qrDataUrl,    setQrDataUrl]    = useState('')

  // Sync warranty months when condition changes
  useEffect(() => {
    const m = WARRANTY_MAP[facForm.condition]
    if (m !== undefined) setFacForm(p => ({ ...p, warranty_months: m }))
  }, [facForm.condition])

  // ── IMEI Lookup ─────────────────────────────────────────────────────────────

  const lookupIMEI = useCallback(async (raw: string) => {
    const imei = raw.trim()
    if (imei.length < 15) { toast.error('IMEI invalide — minimum 15 chiffres'); return }
    setLookingUp(true)
    try {
      const res  = await fetch(`/api/documents?lookup_imei=${imei}`)
      const json = await res.json()
      if (json.status !== 'success') throw new Error()
      const phone: PhoneData | null = json.data
      if (!phone) {
        toast.error('Téléphone introuvable', { description: 'Vérifiez l\'IMEI ou ajoutez-le d\'abord au stock' })
        return
      }
      setFacForm(p => ({
        ...p,
        phone_id:        phone.phone_id,
        imei:            phone.imei,
        marque:          phone.marque,
        model:           phone.model,
        stockage:        phone.stockage,
        ram:             phone.ram,
        couleur:         phone.couleur,
        condition:       phone.condition,
        warranty_months: WARRANTY_MAP[phone.condition] ?? 1,
        prix_vente:      phone.prix_vente_recommande || 0,
      }))
      setImeiInput(imei)
      toast.success(`${phone.marque} ${phone.model} chargé`)
    } catch { toast.error('Erreur lors de la recherche IMEI') }
    finally   { setLookingUp(false) }
  }, [])

  // ── Print FAC ───────────────────────────────────────────────────────────────

  const handlePrintFac = async () => {
    if (!facForm.phone_id)                { toast.error('Scannez d\'abord l\'IMEI du téléphone'); return }
    if (!facForm.client_name)             { toast.error('Le nom du client est obligatoire');        return }
    if (!facForm.prix_vente || facForm.prix_vente <= 0) { toast.error('Le prix de vente est obligatoire');     return }

    setPrinting(true)
    try {
      const today       = new Date()
      const wEnd        = facForm.warranty_months > 0 ? addMonths(today, facForm.warranty_months) : null
      const net         = facForm.prix_vente - facForm.remise
      const deviceLabel = `${facForm.marque} ${facForm.model} ${facForm.stockage}`.trim()

      // 1. Save document → generate reference
      const saveRes  = await fetch('/api/documents', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_type:        'FAC',
          phone_id:        facForm.phone_id,
          client_name:     facForm.client_name,
          client_tel:      facForm.client_tel  || null,
          client_cin:      facForm.client_cin   || null,
          device_label:    deviceLabel,
          imei:            facForm.imei,
          montant:         net,
          warranty_months: facForm.warranty_months,
          warranty_start:  today.toISOString().split('T')[0],
          warranty_end:    wEnd?.toISOString().split('T')[0] ?? null,
          doc_data:        facForm,
        }),
      })
      const saveJson = await saveRes.json()
      if (saveJson.status !== 'success') throw new Error(saveJson.error ?? 'Erreur sauvegarde')

      const { doc_id, doc_ref } = saveJson.data as { doc_id: string; doc_ref: string }
      setPendingDoc({ doc_id, doc_ref })

      // 2. Generate QR code
      const qrPayload = [doc_ref, fmtDate(today), facForm.client_name, facForm.client_tel, facForm.imei, net].join('|')
      const qr = await QRCode.toDataURL(qrPayload, {
        width: 150, margin: 1, color: { dark: '#000000', light: '#ffffff' },
      })
      setQrDataUrl(qr)

      // 3. Print (small delay lets React flush the print template with the ref + QR)
      setTimeout(() => {
        window.print()
        setTimeout(() => { setShowConfirm(true); setPrinting(false) }, 800)
      }, 150)

    } catch (err: any) {
      toast.error('Erreur', { description: err.message })
      setPrinting(false)
    }
  }

  const net        = facForm.prix_vente - facForm.remise
  const today      = new Date()
  const warrantyEnd = facForm.warranty_months > 0 ? addMonths(today, facForm.warranty_months) : null

  // ── Render ─────────────────────────────────────────────────────────────────

  const tabs: { id: ActiveTab; label: string; labelAr: string; Icon: React.ElementType }[] = [
    { id: 'fac',     label: 'Facture',     labelAr: 'فاتورة',  Icon: FileText },
    { id: 'reprise', label: 'Acquisition', labelAr: 'اقتناء',  Icon: Package  },
    { id: 'sav',     label: 'SAV',         labelAr: 'صيانة',   Icon: Wrench   },
    { id: 'archive', label: 'Archives',    labelAr: 'الأرشيف', Icon: Archive  },
  ]

  return (
    <>
      {/* Print page CSS — injected once */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body  { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {/* ── SCREEN UI ──────────────────────────────────────────────────────── */}
      <div className="space-y-6">

        {/* Tab bar */}
        <div className="print:hidden flex gap-1 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
          {tabs.map(({ id, label, labelAr, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium
                          transition-all ${
                activeTab === id
                  ? 'bg-[#C9A440] text-black shadow-sm'
                  : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
              <span className="text-xs opacity-50" dir="rtl">{labelAr}</span>
            </button>
          ))}
        </div>

        {/* ── FACTURE TAB ────────────────────────────────────────────────── */}
        {activeTab === 'fac' && (
          <div className="print:hidden grid grid-cols-1 xl:grid-cols-2 gap-6">

            {/* LEFT — Form */}
            <div className="space-y-4">

              {/* ── Appareil ────────────────────────────────────────────── */}
              <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-4">
                  Appareil · الجهاز
                </p>

                {/* IMEI input */}
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={imeiInput}
                    onChange={e => setImeiInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && lookupIMEI(imeiInput)}
                    placeholder="Scanner ou saisir l'IMEI..."
                    className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl
                               font-mono text-sm text-white placeholder-white/20 focus:outline-none
                               focus:border-[#C9A440]/50 transition-colors"
                  />
                  <button
                    onClick={() => lookupIMEI(imeiInput)}
                    disabled={lookingUp}
                    className="flex items-center gap-2 px-4 py-2.5 bg-[#C9A440]/10
                               hover:bg-[#C9A440]/20 border border-[#C9A440]/30 text-[#C9A440]
                               rounded-xl transition-all disabled:opacity-40 text-sm"
                  >
                    {lookingUp
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Scan    className="w-4 h-4" />}
                    {lookingUp ? 'Recherche...' : 'Chercher'}
                  </button>
                  {facForm.phone_id && (
                    <button
                      onClick={() => { setFacForm(DEFAULT_FAC); setImeiInput('') }}
                      title="Réinitialiser"
                      className="p-2.5 text-white/30 hover:text-white/60 border border-white/10 rounded-xl transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Empty state */}
                {!facForm.phone_id && (
                  <div className="flex items-center gap-3 p-4 bg-white/[0.02] border border-dashed
                                  border-white/10 rounded-xl text-white/25 text-sm">
                    <Scan className="w-5 h-5 shrink-0" />
                    Scannez le code-barres IMEI du téléphone pour auto-remplir les champs
                  </div>
                )}

                {/* Device fields (auto-filled, all editable) */}
                {facForm.phone_id && (
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        { key: 'marque',   label: 'Marque'   },
                        { key: 'model',    label: 'Modèle'   },
                        { key: 'stockage', label: 'Stockage' },
                        { key: 'couleur',  label: 'Couleur'  },
                      ] as { key: keyof FacForm; label: string }[]
                    ).map(({ key, label }) => (
                      <div key={key}>
                        <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                          {label}
                        </label>
                        <input
                          type="text"
                          value={facForm[key] as string}
                          onChange={e => setFacForm(p => ({ ...p, [key]: e.target.value }))}
                          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg
                                     text-white text-sm focus:outline-none focus:border-[#C9A440]/50 transition-colors"
                        />
                      </div>
                    ))}

                    <div>
                      <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                        État
                      </label>
                      <select
                        value={facForm.condition}
                        onChange={e => setFacForm(p => ({ ...p, condition: e.target.value }))}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg
                                   text-white text-sm focus:outline-none focus:border-[#C9A440]/50 transition-colors"
                      >
                        {['Neuf', 'Occasion', 'Reconditionné', 'Pour pièces'].map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                        Garantie (mois)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={facForm.warranty_months}
                        onChange={e => setFacForm(p => ({ ...p, warranty_months: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg
                                   text-white text-sm focus:outline-none focus:border-[#C9A440]/50 transition-colors"
                      />
                    </div>
                  </div>
                )}
              </section>

              {/* ── Client ──────────────────────────────────────────────── */}
              <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-4">
                  Client · العميل
                </p>

                <div className="flex gap-2 mb-4">
                  {(['particulier', 'professionnel'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setFacForm(p => ({ ...p, client_type: t }))}
                      className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${
                        facForm.client_type === t
                          ? 'border-[#C9A440] bg-[#C9A440]/10 text-[#C9A440]'
                          : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'
                      }`}
                    >
                      {t === 'particulier' ? 'Particulier' : 'Professionnel'}
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                      <User className="inline w-3 h-3 mr-1" />
                      {facForm.client_type === 'particulier' ? 'Nom complet' : 'Raison sociale'}
                    </label>
                    <input
                      type="text"
                      value={facForm.client_name}
                      onChange={e => setFacForm(p => ({ ...p, client_name: e.target.value }))}
                      placeholder={facForm.client_type === 'particulier' ? 'Mohamed Alami' : 'Société XYZ SARL'}
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                 text-white text-sm placeholder-white/15 focus:outline-none
                                 focus:border-[#C9A440]/50 transition-colors"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                        <Phone className="inline w-3 h-3 mr-1" />
                        Téléphone
                      </label>
                      <input
                        type="tel"
                        value={facForm.client_tel}
                        onChange={e => setFacForm(p => ({ ...p, client_tel: e.target.value }))}
                        placeholder="06 XX XX XX XX"
                        className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                   text-white text-sm placeholder-white/15 focus:outline-none
                                   focus:border-[#C9A440]/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                        <CreditCard className="inline w-3 h-3 mr-1" />
                        {facForm.client_type === 'particulier' ? 'CIN' : 'ICE'}
                      </label>
                      <input
                        type="text"
                        value={facForm.client_cin}
                        onChange={e => setFacForm(p => ({ ...p, client_cin: e.target.value }))}
                        className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                   text-white text-sm placeholder-white/15 focus:outline-none
                                   focus:border-[#C9A440]/50 transition-colors"
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* ── Prix ────────────────────────────────────────────────── */}
              <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-4">
                  Prix · الثمن
                </p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                      Prix de vente (MAD)
                    </label>
                    <input
                      type="number" min="0"
                      value={facForm.prix_vente || ''}
                      onChange={e => setFacForm(p => ({ ...p, prix_vente: parseFloat(e.target.value) || 0 }))}
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                 text-white text-sm focus:outline-none focus:border-[#C9A440]/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                      Remise (MAD)
                    </label>
                    <input
                      type="number" min="0"
                      value={facForm.remise || ''}
                      onChange={e => setFacForm(p => ({ ...p, remise: parseFloat(e.target.value) || 0 }))}
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                 text-white text-sm focus:outline-none focus:border-[#C9A440]/50 transition-colors"
                    />
                  </div>
                </div>
                {facForm.prix_vente > 0 && (
                  <div className="flex items-center justify-between px-4 py-3
                                  bg-[#C9A440]/10 border border-[#C9A440]/20 rounded-xl">
                    <span className="text-[#C9A440]/60 text-xs uppercase tracking-wider">Net à payer</span>
                    <span className="text-[#C9A440] font-semibold text-base">
                      {net.toLocaleString('fr-MA')} MAD
                    </span>
                  </div>
                )}
              </section>

              {/* ── Extras ──────────────────────────────────────────────── */}
              <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-4">
                  Extras
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                      Accessoires inclus
                    </label>
                    <input
                      type="text"
                      value={facForm.accessories}
                      onChange={e => setFacForm(p => ({ ...p, accessories: e.target.value }))}
                      placeholder="Boîte, chargeur, câble, écouteurs..."
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                 text-white text-sm placeholder-white/15 focus:outline-none
                                 focus:border-[#C9A440]/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-1">
                      Défauts constatés
                    </label>
                    <textarea
                      value={facForm.defauts}
                      onChange={e => setFacForm(p => ({ ...p, defauts: e.target.value }))}
                      rows={2}
                      placeholder="Rayure sur le dos, pixel mort... (optionnel)"
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                                 text-white text-sm placeholder-white/15 focus:outline-none
                                 focus:border-[#C9A440]/50 transition-colors resize-none"
                    />
                  </div>
                </div>
              </section>

              {/* ── Print CTA ───────────────────────────────────────────── */}
              <button
                onClick={handlePrintFac}
                disabled={printing || !facForm.phone_id || !facForm.client_name || facForm.prix_vente <= 0}
                className="w-full flex items-center justify-center gap-3 py-4 bg-[#C9A440]
                           hover:bg-[#d4aa48] text-black font-semibold rounded-xl transition-all
                           disabled:opacity-40 disabled:cursor-not-allowed text-base"
              >
                {printing
                  ? <><Loader2 className="w-5 h-5 animate-spin" />Préparation...</>
                  : <><Printer className="w-5 h-5" />Imprimer la facture</>}
              </button>
            </div>

            {/* RIGHT — Live preview */}
            <div className="hidden xl:block">
              <div className="sticky top-6">
                <p className="text-[10px] text-white/30 uppercase tracking-widest mb-3">
                  Aperçu
                </p>
                <div className="bg-white rounded-xl shadow-2xl overflow-hidden"
                     style={{ aspectRatio: '210/297' }}>
                  <div className="w-full h-full overflow-auto scale-[0.6] origin-top-left"
                       style={{ width: '166.67%', height: '166.67%' }}>
                    <FacturePrintPreview form={facForm} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── REPRISE TAB ────────────────────────────────────────────────── */}
        {activeTab === 'reprise' && <AcquisitionTab />}

        {/* ── SAV TAB ────────────────────────────────────────────────────── */}
        {activeTab === 'sav' && <SavTab />}

        {/* ── ARCHIVE TAB ────────────────────────────────────────────────── */}
        {activeTab === 'archive' && <ArchiveTable />}
      </div>

      {/* ── ConfirmSaleModal ────────────────────────────────────────────────── */}
      {pendingDoc && (
        <ConfirmSaleModal
          isOpen={showConfirm}
          onClose={() => setShowConfirm(false)}
          onSuccess={(txn_id) => {
            setShowConfirm(false)
            setPendingDoc(null)
            setFacForm(DEFAULT_FAC)
            setImeiInput('')
            setQrDataUrl('')
            toast.success('Vente enregistrée en caisse', { description: `Transaction ${txn_id}` })
          }}
          doc_id={pendingDoc.doc_id}
          doc_ref={pendingDoc.doc_ref}
          phone_id={facForm.phone_id}
          client_name={facForm.client_name}
          client_tel={facForm.client_tel}
          device_label={`${facForm.marque} ${facForm.model} ${facForm.stockage}`.trim()}
          imei={facForm.imei}
          montant={net}
          warranty_start={today.toISOString().split('T')[0]}
          warranty_expiry={warrantyEnd?.toISOString().split('T')[0]}
        />
      )}

      {/* ── PRINT TEMPLATE (invisible on screen, renders on print) ─────────── */}
      <div className="hidden print:block">
        <FacturePrintTemplate
          form={facForm}
          docRef={pendingDoc?.doc_ref ?? ''}
          qrDataUrl={qrDataUrl}
          today={today}
          warrantyEnd={warrantyEnd}
        />
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FacturePrintPreview — lightweight live preview (screen only)
// ─────────────────────────────────────────────────────────────────────────────

function FacturePrintPreview({ form }: { form: FacForm }) {
  const today      = new Date()
  const wEnd       = form.warranty_months > 0 ? addMonths(today, form.warranty_months) : null
  const net        = form.prix_vente - form.remise

  const s: Record<string, React.CSSProperties> = {
    wrap:    { fontFamily: 'Arial, sans-serif', fontSize: '8pt', padding: '8mm', color: '#111', background: '#fff', minHeight: '100%' },
    hdr:     { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #C9A440', paddingBottom: '4mm', marginBottom: '4mm' },
    logo:    { fontSize: '14pt', fontWeight: 800, color: '#C9A440', letterSpacing: '1px' },
    sub:     { fontSize: '6.5pt', color: '#777', marginTop: '1mm' },
    title:   { fontSize: '10pt', fontWeight: 700, textAlign: 'right' },
    box:     { border: '1px solid #e0e0e0', borderRadius: '2mm', padding: '3mm', marginBottom: '3mm', fontSize: '7.5pt' },
    boxHdr:  { fontWeight: 700, color: '#C9A440', borderBottom: '1px solid #eee', paddingBottom: '1.5mm', marginBottom: '1.5mm', fontSize: '7pt' },
    grid2:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1mm' },
    label:   { color: '#888' },
    netRow:  { display: 'flex', justifyContent: 'space-between', background: '#C9A440', padding: '2.5mm 3mm', fontWeight: 700, borderRadius: '0 0 2mm 2mm', fontSize: '9pt' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.hdr}>
        <div>
          <div style={s.logo}>ELECTRO ZAKI</div>
          <div style={s.sub}>Meknès · Tél: 05 35 XX XX XX</div>
          <div style={s.sub}>ICE: 001234567000000</div>
        </div>
        <div>
          <div style={s.title}>FACTURE DE VENTE</div>
          <div style={{ ...s.sub, textAlign: 'right' }} dir="rtl">فاتورة بيع</div>
          <div style={{ ...s.sub, textAlign: 'right', marginTop: '2mm' }}>
            <strong>Réf:</strong> <span style={{ color: '#C9A440' }}>EN COURS...</span>
          </div>
          <div style={{ ...s.sub, textAlign: 'right' }}>
            <strong>Date:</strong> {fmtDate(today)}
          </div>
        </div>
      </div>

      {form.client_name && (
        <div style={s.box}>
          <div style={s.boxHdr}>CLIENT · العميل</div>
          <div style={{ fontWeight: 600 }}>{form.client_name}</div>
          {form.client_tel && <div style={{ color: '#555' }}>Tél: {form.client_tel}</div>}
          {form.client_cin && <div style={{ color: '#555' }}>{form.client_type === 'particulier' ? 'CIN' : 'ICE'}: {form.client_cin}</div>}
        </div>
      )}

      {form.phone_id && (
        <div style={s.box}>
          <div style={s.boxHdr}>APPAREIL · الجهاز</div>
          <div style={s.grid2}>
            {[
              ['Marque',   form.marque],
              ['Modèle',   form.model],
              ['Stockage', form.stockage],
              ['Couleur',  form.couleur],
              ['État',     form.condition],
              ['IMEI',     form.imei],
            ].map(([k, v]) => (
              <div key={k}><span style={s.label}>{k}: </span>{v}</div>
            ))}
          </div>
          {form.accessories && <div style={{ marginTop: '1mm', color: '#444' }}>Accessoires: {form.accessories}</div>}
          {form.defauts     && <div style={{ marginTop: '1mm', color: '#c44', fontSize: '7pt' }}>Défauts: {form.defauts}</div>}
        </div>
      )}

      {form.prix_vente > 0 && (
        <div style={{ border: '1px solid #C9A440', borderRadius: '2mm', overflow: 'hidden', marginBottom: '3mm' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2mm 3mm', fontSize: '7.5pt' }}>
            <span>Prix:</span><span>{form.prix_vente.toLocaleString('fr-MA')} MAD</span>
          </div>
          {form.remise > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2mm 3mm', fontSize: '7.5pt', color: '#c44' }}>
              <span>Remise:</span><span>− {form.remise.toLocaleString('fr-MA')} MAD</span>
            </div>
          )}
          <div style={s.netRow}>
            <span>NET À PAYER:</span>
            <span>{net.toLocaleString('fr-MA')} MAD</span>
          </div>
        </div>
      )}

      {wEnd && (
        <div style={{ background: '#fffef5', border: '1px solid #e8d88a', borderRadius: '2mm', padding: '2mm 3mm', fontSize: '7pt', color: '#776010', textAlign: 'center' }}>
          <ShieldCheck style={{ display: 'inline', width: '10px', height: '10px', marginRight: '2px' }} />
          Garantie {form.warranty_months >= 1 ? `${form.warranty_months} mois` : `${Math.round(form.warranty_months * 30)}j`} — expire le <strong>{fmtDate(wEnd)}</strong>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FacturePrintTemplate — full A4 recto + verso (print only)
// ─────────────────────────────────────────────────────────────────────────────

interface PrintProps {
  form:        FacForm
  docRef:      string
  qrDataUrl:   string
  today:       Date
  warrantyEnd: Date | null
}

function FacturePrintTemplate({ form, docRef, qrDataUrl, today, warrantyEnd }: PrintProps) {
  const net = form.prix_vente - form.remise

  const page: React.CSSProperties = {
    width: '210mm', minHeight: '297mm', padding: '12mm 14mm',
    fontFamily: 'Arial, sans-serif', fontSize: '9pt', color: '#111',
    background: '#fff', boxSizing: 'border-box', pageBreakAfter: 'always',
  }

  return (
    <>
      {/* ── RECTO ─────────────────────────────────────────────────────────── */}
      <div style={page}>

        {/* Store header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #C9A440', paddingBottom: '5mm', marginBottom: '5mm' }}>
          <div>
            <div style={{ fontSize: '22pt', fontWeight: 800, color: '#C9A440', letterSpacing: '2px' }}>ELECTRO ZAKI</div>
            <div style={{ fontSize: '8pt', color: '#666', marginTop: '1mm' }}>
              Zone Industrielle Meknès · Tél: 05 35 XX XX XX · WhatsApp: 06 XX XX XX XX
            </div>
            <div style={{ fontSize: '7.5pt', color: '#666' }}>
              ICE: 001234567000000 · IF: 12345678 · TP: 12345678 · RC: 12345
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '14pt', fontWeight: 700 }}>FACTURE DE VENTE</div>
            <div style={{ fontSize: '11pt', color: '#555' }} dir="rtl">فاتورة بيع</div>
            <div style={{ marginTop: '2mm', fontSize: '8.5pt' }}>
              <strong>N°:</strong> <span style={{ color: '#C9A440', fontWeight: 700 }}>{docRef || '—'}</span>
            </div>
            <div style={{ fontSize: '8.5pt' }}>
              <strong>Date:</strong> {fmtDate(today)}
            </div>
          </div>
        </div>

        {/* Client + Warranty grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4mm', marginBottom: '4mm' }}>
          <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '4mm' }}>
            <div style={{ fontWeight: 700, fontSize: '8pt', color: '#C9A440', borderBottom: '1px solid #eee', paddingBottom: '2mm', marginBottom: '2mm' }}>
              CLIENT · العميل
            </div>
            <div style={{ fontWeight: 600 }}>{form.client_name || '—'}</div>
            {form.client_tel && <div style={{ color: '#555', fontSize: '8pt' }}>Tél: {form.client_tel}</div>}
            {form.client_cin && (
              <div style={{ color: '#555', fontSize: '8pt' }}>
                {form.client_type === 'particulier' ? 'CIN' : 'ICE'}: {form.client_cin}
              </div>
            )}
          </div>
          {warrantyEnd && (
            <div style={{ border: '1.5px solid #C9A440', borderRadius: '2mm', padding: '4mm', background: '#fffef8' }}>
              <div style={{ fontWeight: 700, fontSize: '8pt', color: '#C9A440', borderBottom: '1px solid #e8d88a', paddingBottom: '2mm', marginBottom: '2mm' }}>
                GARANTIE · الضمان
              </div>
              <div style={{ fontSize: '8pt' }}>
                <div>Durée: <strong>{form.warranty_months >= 1 ? `${form.warranty_months} mois` : `${Math.round(form.warranty_months * 30)} jours`}</strong></div>
                <div>Début: {fmtDate(today)}</div>
                <div>Fin: <strong style={{ color: '#C9A440' }}>{fmtDate(warrantyEnd)}</strong></div>
              </div>
            </div>
          )}
        </div>

        {/* Device table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4mm', fontSize: '8.5pt' }}>
          <thead>
            <tr style={{ background: '#C9A440' }}>
              {['Désignation', 'Marque', 'Modèle', 'Stockage', 'IMEI 1', 'État'].map(h => (
                <th key={h} style={{ padding: '3mm 2.5mm', textAlign: 'left', fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
              <td style={{ padding: '3mm 2.5mm' }}>Téléphone mobile</td>
              <td style={{ padding: '3mm 2.5mm' }}>{form.marque}</td>
              <td style={{ padding: '3mm 2.5mm' }}>{form.model}</td>
              <td style={{ padding: '3mm 2.5mm' }}>{form.stockage}</td>
              <td style={{ padding: '3mm 2.5mm', fontFamily: 'monospace', fontSize: '7.5pt' }}>{form.imei}</td>
              <td style={{ padding: '3mm 2.5mm' }}>{form.condition}</td>
            </tr>
          </tbody>
        </table>

        {/* Accessories + Defauts */}
        {(form.accessories || form.defauts) && (
          <div style={{ display: 'grid', gridTemplateColumns: form.accessories && form.defauts ? '1fr 1fr' : '1fr', gap: '3mm', marginBottom: '4mm', fontSize: '8pt' }}>
            {form.accessories && (
              <div style={{ border: '1px solid #ddd', borderRadius: '2mm', padding: '3mm' }}>
                <div style={{ fontWeight: 700, marginBottom: '1mm' }}>Accessoires inclus</div>
                <div style={{ color: '#444' }}>{form.accessories}</div>
              </div>
            )}
            {form.defauts && (
              <div style={{ border: '1px solid #f9a', borderRadius: '2mm', padding: '3mm' }}>
                <div style={{ fontWeight: 700, marginBottom: '1mm', color: '#c33' }}>Défauts constatés</div>
                <div style={{ color: '#444' }}>{form.defauts}</div>
              </div>
            )}
          </div>
        )}

        {/* Pricing */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6mm' }}>
          <div style={{ width: '75mm', border: '1.5px solid #C9A440', borderRadius: '2mm', overflow: 'hidden', fontSize: '8.5pt' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2.5mm 3.5mm' }}>
              <span>Prix de vente:</span><span>{form.prix_vente.toLocaleString('fr-MA')} MAD</span>
            </div>
            {form.remise > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2.5mm 3.5mm', color: '#c33', borderTop: '1px solid #f0f0f0' }}>
                <span>Remise:</span><span>− {form.remise.toLocaleString('fr-MA')} MAD</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3mm 3.5mm', background: '#C9A440', fontWeight: 700, fontSize: '10pt' }}>
              <span>NET À PAYER:</span><span>{net.toLocaleString('fr-MA')} MAD</span>
            </div>
          </div>
        </div>

        {/* Signatures + QR */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '8mm' }}>
          <div>
            <div style={{ fontSize: '7.5pt', color: '#777', marginBottom: '12mm' }}>Signature du client · توقيع العميل</div>
            <div style={{ width: '65mm', borderBottom: '1px solid #bbb' }} />
          </div>
          <div style={{ textAlign: 'center' }}>
            {qrDataUrl && <img src={qrDataUrl} alt="QR" style={{ width: '22mm', height: '22mm', display: 'block', margin: '0 auto' }} />}
            <div style={{ fontSize: '6pt', color: '#aaa', marginTop: '1mm' }}>Visa électronique</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '7.5pt', color: '#777', marginBottom: '12mm' }}>Cachet du magasin · ختم المحل</div>
            <div style={{ width: '65mm', borderBottom: '1px solid #bbb' }} />
          </div>
        </div>
      </div>

      {/* ── VERSO (Conditions de Garantie) ─────────────────────────────────── */}
      <div style={{ ...page, pageBreakAfter: 'auto' }}>
        <div style={{ textAlign: 'center', borderBottom: '3px solid #C9A440', paddingBottom: '4mm', marginBottom: '5mm' }}>
          <div style={{ fontSize: '13pt', fontWeight: 700 }}>CONDITIONS DE GARANTIE</div>
          <div style={{ fontSize: '11pt', color: '#666' }} dir="rtl">شروط الضمان</div>
          <div style={{ fontSize: '7.5pt', color: '#999', marginTop: '1mm' }}>Ref: {docRef}</div>
        </div>

        <div style={{ columns: 2, columnGap: '8mm', fontSize: '7.5pt', lineHeight: '1.55' }}>
          {GARANTIE_ARTICLES.map(({ n, fr, ar }) => (
            <div key={n} style={{ breakInside: 'avoid', marginBottom: '4mm', paddingBottom: '3mm', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ fontWeight: 700, color: '#C9A440', marginBottom: '1mm' }}>Art. {n}</div>
              <div style={{ color: '#222', marginBottom: '1mm' }}>{fr}</div>
              <div style={{ color: '#555', textAlign: 'right' }} dir="rtl">{ar}</div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '2px solid #C9A440', paddingTop: '3mm', marginTop: 'auto', textAlign: 'center', fontSize: '7.5pt', color: '#777' }}>
          <strong style={{ color: '#C9A440' }}>ELECTRO ZAKI</strong> · Meknès · 05 35 XX XX XX
          &nbsp;·&nbsp; SAV: 06 XX XX XX XX
        </div>
      </div>
    </>
  )
}

// ── Legal articles data ───────────────────────────────────────────────────────

const GARANTIE_ARTICLES = [
  {
    n: 1,
    fr: 'La garantie couvre exclusivement les défauts de fabrication et non les dommages résultant d\'une utilisation inappropriée, chutes, infiltrations d\'eau ou interventions non autorisées.',
    ar: 'يغطي الضمان عيوب الصنع حصرًا، ولا يشمل الأضرار الناتجة عن سوء الاستخدام أو السقوط أو تسرب الماء أو التدخلات غير المرخصة.',
  },
  {
    n: 2,
    fr: 'Toute modification, réparation ou tentative d\'ouverture du produit par une tierce partie non autorisée entraîne l\'annulation immédiate de la garantie.',
    ar: 'يُلغى الضمان فورًا عند أي تعديل أو إصلاح أو محاولة فتح الجهاز من قِبل طرف غير مرخص.',
  },
  {
    n: 3,
    fr: 'La durée de garantie est indiquée sur le recto de la facture et calculée à partir de la date d\'achat figurant sur ce document.',
    ar: 'مدة الضمان مذكورة في وجه الفاتورة وتُحسب انطلاقًا من تاريخ الشراء المبيّن في هذه الوثيقة.',
  },
  {
    n: 4,
    fr: 'En cas de prise en charge SAV, la durée d\'immobilisation du produit en atelier est automatiquement ajoutée à la période de garantie restante.',
    ar: 'في حال الإصلاح تحت الضمان، تُضاف مدة الإصلاح إلى فترة الضمان المتبقية تلقائيًا.',
  },
  {
    n: 5,
    fr: 'Les accessoires (câbles, chargeurs, écouteurs) bénéficient d\'une garantie de 7 jours à compter de la date d\'achat.',
    ar: 'تستفيد الملحقات (كابلات، شواحن، سماعات) من ضمان مدته 7 أيام من تاريخ الشراء.',
  },
  {
    n: 6,
    fr: 'La garantie ne couvre pas: rayures, casses d\'écran, oxydation, virus logiciels, perte de données, dommages esthétiques.',
    ar: 'لا يشمل الضمان: الخدوش، كسر الشاشة، التآكل، الفيروسات، فقدان البيانات، والأضرار الجمالية.',
  },
  {
    n: 7,
    fr: 'Pour toute demande de SAV, le client doit présenter la présente facture originale. Sans justificatif, la prise en charge sous garantie ne peut être effectuée.',
    ar: 'لطلب الإصلاح تحت الضمان، يجب تقديم هذه الفاتورة الأصلية. بدون وثيقة، لا يمكن القبول تحت الضمان.',
  },
  {
    n: 8,
    fr: 'Electro Zaki se réserve le droit de remplacer le produit défectueux par un produit équivalent ou de rembourser le montant d\'achat en cas d\'irréparabilité constatée.',
    ar: 'يحتفظ إليكترو زكي بالحق في استبدال المنتج المعيب بمنتج مماثل أو استرداد مبلغ الشراء في حال عدم قابليته للإصلاح.',
  },
  {
    n: 9,
    fr: 'Les données personnelles collectées sont traitées conformément à la Loi n°09-08 relative à la protection des données à caractère personnel.',
    ar: 'تُعالَج البيانات الشخصية وفقًا للقانون رقم 09-08 المتعلق بحماية البيانات الشخصية.',
  },
  {
    n: 10,
    fr: 'Tout litige sera soumis aux juridictions compétentes de Meknès conformément à la Loi 31-08 sur la protection du consommateur.',
    ar: 'يُحسم أي نزاع أمام المحاكم المختصة بمكناس وفقًا للقانون 31-08 لحماية المستهلك.',
  },
]