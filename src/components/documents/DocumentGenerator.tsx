'use client'
import { useRef, useEffect, useState, useCallback } from 'react'
import { Camera, X } from 'lucide-react'
import { ArchiveTable } from './ArchiveTable'
import { ConfirmSaleModal } from './ConfirmSaleModal'
import { toast } from 'sonner'

type ActiveTab = 'fac' | 'acq' | 'sav' | 'archive'

interface UserProfile {
  id: string
  display_name: string
  store_id: string | null
  role: string
}

interface DocumentGeneratorProps {
  userProfile?: UserProfile
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setField(doc: Document, id: string, value: string) {
  const el = doc.getElementById(id) as HTMLInputElement | HTMLSelectElement | null
  if (el) el.value = value
}

function mapCondition(cond: string | null | undefined): string {
  if (!cond) return 'OCC_BON'
  // Direct match — DB may already store our enum values
  const direct: Record<string, string> = {
    NEUF_SCELLE: 'NEUF_SCELLE', NEUF_DEBALLE: 'NEUF_DEBALLE',
    OCC_EXCELLENT: 'OCC_EXCELLENT', OCC_TRES_BON: 'OCC_TRES_BON',
    OCC_BON: 'OCC_BON', OCC_ACCEPTABLE: 'OCC_ACCEPTABLE',
  }
  if (direct[cond]) return direct[cond]
  const c = cond.toUpperCase()
  if (c.includes('SCELL'))                          return 'NEUF_SCELLE'
  if (c.includes('NEUF') || c.includes('NEW'))      return 'NEUF_DEBALLE'
  if (c.includes('EXCELLENT'))                      return 'OCC_EXCELLENT'
  if ((c.includes('TR') || c.includes('VER')) && c.includes('BON')) return 'OCC_TRES_BON'
  if (c.includes('BON') || c.includes('GOOD'))      return 'OCC_BON'
  return 'OCC_ACCEPTABLE'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DocumentGenerator({ userProfile }: DocumentGeneratorProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('fac')
  const [confirmData, setConfirmData] = useState<any>(null)
  const [scanning, setScanning]   = useState(false)

  const facRef   = useRef<HTMLIFrameElement>(null)
  const acqRef   = useRef<HTMLIFrameElement>(null)
  const savRef   = useRef<HTMLIFrameElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const profile = userProfile ?? {
    id: '', display_name: 'EZ Employee', store_id: null, role: 'employee' as const,
  }
  const storeId = profile.store_id ?? 'EZ-001'

  // ── Scanner ──────────────────────────────────────────────────────────────

  const stopScan = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setScanning(false)
  }, [])

  /** Inject a confirmed IMEI into the active tab's iframe, then lookup + fill all fields */
  const injectAndLookup = useCallback(async (imei: string) => {
    const iframeRef = activeTab === 'fac' ? facRef
                    : activeTab === 'acq' ? acqRef
                    : savRef
    const doc = iframeRef.current?.contentDocument
    const win = iframeRef.current?.contentWindow as any
    if (!doc || !win) return

    // Always inject IMEI first so the field is never empty
    if (activeTab === 'fac') setField(doc, 'fac_imei1', imei)
    else if (activeTab === 'acq') setField(doc, 'rep_imei1', imei)
    else if (activeTab === 'sav') setField(doc, 'sav_imei', imei)

    // DB lookup
    try {
      const res  = await fetch(`/api/documents?lookup_imei=${encodeURIComponent(imei)}`)
      const json = await res.json()
      const p    = json.data   // null when IMEI not in stock

      if (!p) {
        toast.info('IMEI non trouvé dans le stock — remplissez les champs manuellement')
        win.updateEtat?.(); win.calcFacTotals?.(); win.upFac?.()
        win.upRep?.(); win.upSav?.()
        return
      }

      // Inject per tab
      if (activeTab === 'fac') {
        setField(doc, 'fac_marque',   p.marque   || '')
        setField(doc, 'fac_modele',   p.model    || '')   // DB: model (not modele)
        setField(doc, 'fac_stockage', p.stockage || 'N/A')
        setField(doc, 'fac_ram',      p.ram      || 'N/A')
        setField(doc, 'fac_couleur',  p.couleur  || '')
        setField(doc, 'fac_serial',   p.serie    || '')
        setField(doc, 'fac_imei1',    p.imei     || imei)
        setField(doc, 'fac_etat',     mapCondition(p.condition))
        if (p.prix_vente_recommande)
          setField(doc, 'fac_prix_ht', String(p.prix_vente_recommande))
        win.updateEtat?.()
        win.calcFacTotals?.()
        win.upFac?.()

      } else if (activeTab === 'acq') {
        setField(doc, 'rep_marque',   p.marque   || '')
        setField(doc, 'rep_modele',   p.model    || '')
        setField(doc, 'rep_stockage', p.stockage || 'N/A')
        setField(doc, 'rep_ram',      p.ram      || 'N/A')
        setField(doc, 'rep_couleur',  p.couleur  || '')
        setField(doc, 'rep_serial',   p.serie    || '')
        setField(doc, 'rep_imei1',    p.imei     || imei)
        setField(doc, 'rep_etat',     mapCondition(p.condition))
        win.upRep?.()

      } else if (activeTab === 'sav') {
        setField(doc, 'sav_marque',  p.marque || '')
        setField(doc, 'sav_modele',  p.model  || '')
        setField(doc, 'sav_imei',    p.imei   || imei)
        win.upSav?.()
      }

      toast.success(`${p.marque || ''} ${p.model || ''} — données chargées depuis le stock`)
    } catch {
      toast.error('Erreur lors de la recherche IMEI')
      win.updateEtat?.(); win.calcFacTotals?.(); win.upFac?.()
      win.upRep?.(); win.upSav?.()
    }
  }, [activeTab])

  /** Camera scanning effect — runs only while overlay is open */
  useEffect(() => {
    if (!scanning) return
    let active = true
    let animFrame = 0

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        if (!('BarcodeDetector' in window)) {
          toast.error('BarcodeDetector non supporté — utilisez Chrome sur Android')
          stopScan(); return
        }

        const detector = new (window as any).BarcodeDetector({
          formats: ['code_128', 'code_39', 'ean_13', 'qr_code', 'code_93'],
        })

        async function scan() {
          if (!active || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            for (const bc of codes) {
              const raw = bc.rawValue.trim().replace(/\D/g, '')
              if (raw.length === 15) {
                stopScan()
                await injectAndLookup(raw)
                return
              }
            }
          } catch { /* ignore per-frame errors */ }
          animFrame = requestAnimationFrame(scan)
        }
        scan()
      } catch {
        toast.error("Impossible d'accéder à la caméra")
        stopScan()
      }
    }

    start()
    return () => {
      active = false
      cancelAnimationFrame(animFrame)
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [scanning, stopScan, injectAndLookup])

  // ── FAC print handler ────────────────────────────────────────────────────

  const handleFacPrint = useCallback(async (data: any) => {
    try {
      // Extract signature from canvas
      const signatureData = (() => {
        try {
          const canvas = facRef.current?.contentDocument
            ?.getElementById('fac-sig-canvas') as HTMLCanvasElement | null
          const d = canvas?.toDataURL('image/png')
          return d && d.length > 200 ? d : null
        } catch { return null }
      })()

      // Lookup phone_id from IMEI (required by confirm_document_sale RPC)
      let phone_id = ''
      if (data.imei1) {
        try {
          const lr   = await fetch(`/api/documents?lookup_imei=${encodeURIComponent(data.imei1)}`)
          const ld   = await lr.json()
          phone_id   = ld.data?.phone_id ?? ''
        } catch { /* non-blocking */ }
      }

      const deviceLabel = [data.marque, data.modele].filter(Boolean).join(' ')
      const clientName  = data.client_type === 'PRO' ? data.client_rs : data.client_nom
      const clientTel   = data.client_type === 'PRO' ? data.client_tel_pro : data.client_tel

      const res = await fetch('/api/documents', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_type:     'FAC',                          // ← correct field name
          phone_id:     phone_id || null,
          client_name:  clientName  || null,
          client_tel:   clientTel   || null,
          client_cin:   data.client_cin || null,
          device_label: deviceLabel || null,
          imei:         data.imei1  || null,            // ← correct field name
          montant:      data.montant ?? null,
          doc_data: {
            marque: data.marque, modele: data.modele, stockage: data.stockage,
            ram: data.ram, couleur: data.couleur, etat: data.etat,
            batterie: data.batterie, imei2: data.imei2, serial: data.serial,
            nature: data.nature, reglement: data.reglement, garantie: data.garantie,
            client_type: data.client_type, prod_mode: data.prod_mode,
            signature_data: signatureData,
          },
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result  = await res.json()
      const docRef  = result.data?.doc_ref             // ← correct path
      const docId   = result.data?.doc_id
      if (!docRef) throw new Error(result.error || 'Aucune référence retournée')

      // Trigger iframe print
      facRef.current?.contentWindow?.postMessage({ type: 'FAC_REF_READY', ref: docRef }, '*')

      // Show ConfirmSaleModal after print dialog opens
      setTimeout(() => {
        setConfirmData({
          doc_id:       docId ?? docRef,
          doc_ref:      docRef,
          phone_id:     phone_id,
          client_name:  clientName  || null,
          client_tel:   clientTel   || null,
          device_label: deviceLabel || null,
          imei:         data.imei1  || null,
          montant:      data.montant ?? 0,
        })
      }, 800)
    } catch (err: any) {
      toast.error('Erreur FAC: ' + (err?.message ?? 'Inconnue'))
    }
  }, [storeId, profile.display_name])

  // ── ACQ print handler ────────────────────────────────────────────────────

  const handleAcqPrint = useCallback(async (data: any) => {
    try {
      const signatureData = (() => {
        try {
          const canvas = acqRef.current?.contentDocument
            ?.getElementById('rep-sig-canvas') as HTMLCanvasElement | null
          const d = canvas?.toDataURL('image/png')
          return d && d.length > 200 ? d : null
        } catch { return null }
      })()

      const deviceLabel = [data.marque, data.modele].filter(Boolean).join(' ')

      const res = await fetch('/api/documents', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_type:       data.mode,                    // 'RCH' or 'ECH'
          client_name:    data.client_nom || null,
          client_tel:     data.client_tel || null,
          client_cin:     data.cin_ref    || null,
          device_label:   deviceLabel     || null,
          imei:           data.imei1      || null,
          montant:        data.montant    ?? null,
          linked_doc_ref: data.facture_liee || null,
          doc_data: {
            mode: data.mode, marque: data.marque, modele: data.modele,
            stockage: data.stockage, ram: data.ram, couleur: data.couleur,
            etat: data.etat, imei2: data.imei2, serial: data.serial,
            defauts: data.defauts, employee: data.employee,
            ck_apple: data.ck_apple, ck_google: data.ck_google,
            ck_samsung: data.ck_samsung, ck_xiaomi: data.ck_xiaomi,
            ck_reset: data.ck_reset, signature_data: signatureData,
          },
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result = await res.json()
      const docRef = result.data?.doc_ref
      if (!docRef) throw new Error(result.error || 'Aucune référence retournée')

      acqRef.current?.contentWindow?.postMessage({ type: 'ACQ_REF_READY', ref: docRef }, '*')
      toast.success(`Document archivé: ${docRef}`)
    } catch (err: any) {
      toast.error('Erreur ACQ: ' + (err?.message ?? 'Inconnue'))
    }
  }, [storeId, profile.display_name])

  // ── SAV print handler ────────────────────────────────────────────────────

  const handleSavPrint = useCallback(async (payload: any) => {
    try {
      const signatureData = (() => {
        try {
          const canvas = savRef.current?.contentDocument
            ?.getElementById('sav-sig-canvas') as HTMLCanvasElement | null
          const d = canvas?.toDataURL('image/png')
          return d && d.length > 200 ? d : null
        } catch { return null }
      })()

      const mode: 'PEC' | 'RST' | 'BOTH' = payload.mode
      let pecRef: string | null = null
      let rstRef: string | null = null
      const pecDeviceLabel = [payload.pec?.marque, payload.pec?.modele].filter(Boolean).join(' ')

      if (mode === 'PEC' || mode === 'BOTH') {
        const res = await fetch('/api/documents', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            doc_type:       'PEC',
            client_name:    payload.pec.client_nom || null,
            client_tel:     payload.pec.client_tel || null,
            device_label:   pecDeviceLabel         || null,
            imei:           payload.pec.imei       || null,
            linked_doc_ref: payload.pec.facture_liee || null,
            doc_data: { ...payload.pec, signature_data: signatureData },
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status} (PEC)`)
        const r = await res.json()
        pecRef   = r.data?.doc_ref
        if (!pecRef) throw new Error(r.error || 'PEC: aucune référence')

        // Record SAV_OPEN for warranty extension
        if (payload.pec.facture_liee) {
          fetch('/api/warranty/events', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              facture_ref: payload.pec.facture_liee,
              event_type:  'SAV_OPEN',
              event_date:  payload.pec.date,
              store_id:    storeId,
            }),
          }).catch(() => {})
        }
      }

      if (mode === 'RST' || mode === 'BOTH') {
        const res = await fetch('/api/documents', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            doc_type:       'RST',
            client_name:    payload.pec?.client_nom   || null,
            client_tel:     payload.pec?.client_tel   || null,
            device_label:   pecDeviceLabel             || null,
            imei:           payload.rst.imei || payload.pec?.imei || null,
            linked_doc_ref: pecRef           || null,
            doc_data: { ...payload.rst, signature_data: signatureData },
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status} (RST)`)
        const r = await res.json()
        rstRef   = r.data?.doc_ref
        if (!rstRef) throw new Error(r.error || 'RST: aucune référence')
      }

      savRef.current?.contentWindow?.postMessage({ type: 'SAV_REF_READY', pecRef, rstRef }, '*')
      toast.success(`Document(s) archivé(s): ${[pecRef, rstRef].filter(Boolean).join(', ')}`)
    } catch (err: any) {
      toast.error('Erreur SAV: ' + (err?.message ?? 'Inconnue'))
    }
  }, [storeId, profile.display_name])

  // ── postMessage listener ─────────────────────────────────────────────────

  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (!e.data?.type) return
      if (e.data.type === 'FAC_PRINT_REQUEST') handleFacPrint(e.data.data)
      if (e.data.type === 'ACQ_PRINT_REQUEST') handleAcqPrint(e.data.data)
      if (e.data.type === 'SAV_PRINT_REQUEST') handleSavPrint(e.data)
    }
    window.addEventListener('message', handle)
    return () => window.removeEventListener('message', handle)
  }, [handleFacPrint, handleAcqPrint, handleSavPrint])

  // ── Tabs config ──────────────────────────────────────────────────────────

  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'fac',     label: 'Facture de Vente' },
    { id: 'acq',     label: 'Bon de Reprise / Acquisition' },
    { id: 'sav',     label: 'SAV — Prise en Charge & Restitution' },
    { id: 'archive', label: 'Archives' },
  ]

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a]">

      {/* ── Tab navigation + Scan button ─────────────────────────────────── */}
      <nav className="flex-shrink-0 border-b border-[#2a2a2a] bg-[#0a0a0a] flex items-center overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 text-xs font-medium border-b-2 transition-colors
                        whitespace-nowrap flex-shrink-0 ${
              activeTab === tab.id
                ? 'border-[#C9A440] text-[#C9A440]'
                : 'border-transparent text-gray-500 hover:text-gray-200 hover:border-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}

        {/* Scan IMEI — visible on document tabs only */}
        {activeTab !== 'archive' && (
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="ml-auto mr-3 flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5
                       text-xs border border-[#2a2a2a] rounded text-gray-400
                       hover:text-[#C9A440] hover:border-[#C9A440]/40 transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />
            Scan IMEI
          </button>
        )}
      </nav>

      {/* ── Iframe content area ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden relative">
        <iframe
          ref={facRef} src="/print/fac.html" title="Facture de vente"
          style={{ position:'absolute', inset:0, width:'100%', height:'100%', border:'none',
            display: activeTab === 'fac' ? 'block' : 'none' }}
        />
        <iframe
          ref={acqRef} src="/print/acq.html" title="Bon d'acquisition"
          style={{ position:'absolute', inset:0, width:'100%', height:'100%', border:'none',
            display: activeTab === 'acq' ? 'block' : 'none' }}
        />
        <iframe
          ref={savRef} src="/print/sav.html" title="SAV"
          style={{ position:'absolute', inset:0, width:'100%', height:'100%', border:'none',
            display: activeTab === 'sav' ? 'block' : 'none' }}
        />
        {activeTab === 'archive' && (
          <div className="absolute inset-0 overflow-auto bg-[#0a0a0a]">
            <ArchiveTable />
          </div>
        )}
      </div>

      {/* ── Camera scanner overlay ───────────────────────────────────────── */}
      {scanning && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-4 border-b border-white/10 flex-shrink-0">
            <div>
              <h3 className="text-white font-medium text-sm">Scanner IMEI</h3>
              <p className="text-white/40 text-xs mt-0.5">
                Pointez vers le code-barres · 15 chiffres attendus
              </p>
            </div>
            <button
              type="button"
              onClick={stopScan}
              className="p-2 text-white/40 hover:text-white transition-colors rounded-lg hover:bg-white/5"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 relative overflow-hidden">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline muted autoPlay
            />

            {/* Targeting frame */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-72 h-28">
                <span className="absolute top-0    left-0  w-7 h-7 border-t-2 border-l-2 border-[#C9A440]" />
                <span className="absolute top-0    right-0 w-7 h-7 border-t-2 border-r-2 border-[#C9A440]" />
                <span className="absolute bottom-0 left-0  w-7 h-7 border-b-2 border-l-2 border-[#C9A440]" />
                <span className="absolute bottom-0 right-0 w-7 h-7 border-b-2 border-r-2 border-[#C9A440]" />
                <div className="absolute inset-x-0 top-1/2 h-px bg-[#C9A440]/50 animate-pulse" />
              </div>
            </div>

            <p className="absolute bottom-10 inset-x-0 text-center text-white/50 text-sm pointer-events-none">
              Alignez le code-barres dans le cadre doré
            </p>
          </div>
        </div>
      )}

      {/* ── Confirm sale modal (FAC only) ────────────────────────────────── */}
      {confirmData && (
        <ConfirmSaleModal
          isOpen={true}
          onClose={() => setConfirmData(null)}
          onSuccess={(txn_id: string) => {
            setConfirmData(null)
            toast.success(`Transaction enregistrée — ${txn_id}`)
          }}
          doc_id={confirmData.doc_id}
          doc_ref={confirmData.doc_ref}
          phone_id={confirmData.phone_id}
          client_name={confirmData.client_name}
          client_tel={confirmData.client_tel}
          device_label={confirmData.device_label}
          imei={confirmData.imei}
          montant={confirmData.montant}
        />
      )}
    </div>
  )
}