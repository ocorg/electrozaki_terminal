'use client'
import { useRef, useEffect, useState, useCallback } from 'react'
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

export function DocumentGenerator({ userProfile }: DocumentGeneratorProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('fac')
  const [confirmData, setConfirmData] = useState<any>(null)
  const [iframesReady, setIframesReady] = useState({ fac: false, acq: false, sav: false })

  const facRef = useRef<HTMLIFrameElement>(null)
  const acqRef = useRef<HTMLIFrameElement>(null)
  const savRef = useRef<HTMLIFrameElement>(null)

  const profile = userProfile ?? { id: '', display_name: 'EZ Employee', store_id: null, role: 'employee' as const }
  const storeId = profile.store_id ?? 'EZ-001'

  /* ── Signature extraction from iframe canvas ── */
  const getSignature = useCallback(
    (iframeRef: React.RefObject<HTMLIFrameElement>, canvasId: string): string | null => {
      try {
        const doc = iframeRef.current?.contentDocument
        if (!doc) return null
        const canvas = doc.getElementById(canvasId) as HTMLCanvasElement | null
        if (!canvas) return null
        const data = canvas.toDataURL('image/png')
        // Detect blank canvas (empty 1×1 or default blank PNG prefix)
        if (!data || data.length < 200) return null
        return data
      } catch {
        return null
      }
    },
    []
  )

  /* ── FAC print handler ── */
  const handleFacPrint = useCallback(
    async (data: any) => {
      try {
        const signatureData = getSignature(facRef, 'fac-sig-canvas')

        const res = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'FAC',
            store_id: storeId,
            employee_name: profile.display_name,
            signature_data: signatureData,
            ...data,
          }),
        })

        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const result = await res.json()
        if (!result.doc_ref) throw new Error(result.error || 'Aucune référence retournée')

        // Send ref to iframe → triggers executeFacPrint(ref) → window.print()
        facRef.current?.contentWindow?.postMessage(
          { type: 'FAC_REF_READY', ref: result.doc_ref },
          '*'
        )

        // Show confirm modal slightly after print dialog opens
        setTimeout(() => {
          setConfirmData({
            doc_ref: result.doc_ref,
            store_id: storeId,
            montant: data.montant ?? 0,
            imei1: data.imei1 ?? '',
            marque: data.marque ?? '',
            modele: data.modele ?? '',
            etat: data.etat ?? '',
            garantie: data.garantie ?? '',
            client_nom: data.client_nom ?? '',
            client_tel: data.client_tel ?? '',
            date: data.date ?? '',
          })
        }, 800)
      } catch (err: any) {
        toast.error('Erreur FAC: ' + (err?.message ?? 'Inconnue'))
      }
    },
    [storeId, profile, getSignature]
  )

  /* ── ACQ print handler ── */
  const handleAcqPrint = useCallback(
    async (data: any) => {
      try {
        const signatureData = getSignature(acqRef, 'rep-sig-canvas')

        const res = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: data.mode, // 'RCH' or 'ECH'
            store_id: storeId,
            employee_name: profile.display_name,
            signature_data: signatureData,
            ...data,
          }),
        })

        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const result = await res.json()
        if (!result.doc_ref) throw new Error(result.error || 'Aucune référence retournée')

        acqRef.current?.contentWindow?.postMessage(
          { type: 'ACQ_REF_READY', ref: result.doc_ref },
          '*'
        )

        toast.success(`Document archivé: ${result.doc_ref}`)
      } catch (err: any) {
        toast.error('Erreur ACQ: ' + (err?.message ?? 'Inconnue'))
      }
    },
    [storeId, profile, getSignature]
  )

  /* ── SAV print handler ── */
  const handleSavPrint = useCallback(
    async (payload: any) => {
      try {
        const signatureData = getSignature(savRef, 'sav-sig-canvas')
        const mode: 'PEC' | 'RST' | 'BOTH' = payload.mode

        let pecRef: string | null = null
        let rstRef: string | null = null

        if (mode === 'PEC' || mode === 'BOTH') {
          const res = await fetch('/api/documents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'PEC',
              store_id: storeId,
              employee_name: profile.display_name,
              signature_data: signatureData,
              ...payload.pec,
            }),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status} (PEC)`)
          const r = await res.json()
          if (!r.doc_ref) throw new Error(r.error || 'PEC: aucune référence')
          pecRef = r.doc_ref
        }

        if (mode === 'RST' || mode === 'BOTH') {
          const res = await fetch('/api/documents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'RST',
              store_id: storeId,
              employee_name: profile.display_name,
              signature_data: signatureData,
              ...payload.rst,
            }),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status} (RST)`)
          const r = await res.json()
          if (!r.doc_ref) throw new Error(r.error || 'RST: aucune référence')
          rstRef = r.doc_ref

          // Record SAV_OPEN event for warranty extension
          if (payload.pec?.facture_liee) {
            await fetch('/api/warranty/events', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                facture_ref: payload.pec.facture_liee,
                event_type: 'SAV_OPEN',
                event_date: payload.pec.date,
                store_id: storeId,
              }),
            }).catch(() => {}) // non-blocking
          }
        }

        savRef.current?.contentWindow?.postMessage(
          { type: 'SAV_REF_READY', pecRef, rstRef },
          '*'
        )

        const refs = [pecRef, rstRef].filter(Boolean).join(', ')
        toast.success(`Document(s) archivé(s): ${refs}`)
      } catch (err: any) {
        toast.error('Erreur SAV: ' + (err?.message ?? 'Inconnue'))
      }
    },
    [storeId, profile, getSignature]
  )

  /* ── Global postMessage listener ── */
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!e.data?.type) return

      switch (e.data.type) {
        case 'FAC_PRINT_REQUEST':
          handleFacPrint(e.data.data)
          break
        case 'ACQ_PRINT_REQUEST':
          handleAcqPrint(e.data.data)
          break
        case 'SAV_PRINT_REQUEST':
          handleSavPrint(e.data)
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleFacPrint, handleAcqPrint, handleSavPrint])

  /* ── Tabs config ── */
  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'fac', label: 'Facture de Vente' },
    { id: 'acq', label: 'Bon de Reprise / Acquisition' },
    { id: 'sav', label: 'SAV — Prise en Charge & Restitution' },
    { id: 'archive', label: 'Archives' },
  ]

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a]">
      {/* Tab navigation */}
      <nav className="flex-shrink-0 border-b border-[#2a2a2a] bg-[#0a0a0a] flex overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
              activeTab === tab.id
                ? 'border-[#C9A440] text-[#C9A440]'
                : 'border-transparent text-gray-500 hover:text-gray-200 hover:border-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Iframe tab content area */}
      <div className="flex-1 overflow-hidden relative">
        {/* FAC iframe — always mounted, hidden when not active */}
        <iframe
          ref={facRef}
          src="/print/fac.html"
          title="Facture de vente"
          onLoad={() => setIframesReady((p) => ({ ...p, fac: true }))}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            display: activeTab === 'fac' ? 'block' : 'none',
          }}
        />

        {/* ACQ iframe */}
        <iframe
          ref={acqRef}
          src="/print/acq.html"
          title="Bon d'acquisition"
          onLoad={() => setIframesReady((p) => ({ ...p, acq: true }))}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            display: activeTab === 'acq' ? 'block' : 'none',
          }}
        />

        {/* SAV iframe */}
        <iframe
          ref={savRef}
          src="/print/sav.html"
          title="SAV"
          onLoad={() => setIframesReady((p) => ({ ...p, sav: true }))}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            display: activeTab === 'sav' ? 'block' : 'none',
          }}
        />

        {/* Archives tab — React component */}
        {activeTab === 'archive' && (
          <div className="absolute inset-0 overflow-auto bg-[#0a0a0a]">
            <ArchiveTable />
          </div>
        )}
      </div>

      {/* Confirm sale modal — FAC only */}
      {confirmData && (
        <ConfirmSaleModal
          doc_ref={confirmData.doc_ref}
          montant={confirmData.montant}
          imei={confirmData.imei1}
          onClose={() => setConfirmData(null)}
        />
      )}
    </div>
  )
}