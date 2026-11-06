'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  PackageSearch, Plus, ChevronLeft, CheckCircle2,
  Loader2, Keyboard, ScanLine, Eye, Hourglass, AlertTriangle, CircleDot, XCircle, Undo2
} from 'lucide-react'
import { toast } from 'sonner'
import { usePortal } from '@/lib/context/portal'
import { useEscapeKey } from '@/lib/hooks/useEscapeKey'
import type { InventorySession, InventorySessionItem, InventoryResultat, DeviceStatus } from '@/types/database'
import { codeLabel } from '@/lib/codes'
import { STORE_TIME_ZONE } from '@/lib/time'
import { makeDetector, openCamera, tuneCamera } from '@/lib/barcode'
import { playScanSound, looksLikeImei, type ScanSound } from '@/lib/scanSound'

// ── Types internes ─────────────────────────────────────────
interface SessionWithCounts extends InventorySession {
  counts: Record<string, number>
}

type ScanType = 'trouve' | 'hors_perimetre' | 'non_enregistre' | 'deja_scanne' | 'ignore'

// One sound per result (owner, 2026-11-06): the counter hears what happened
const SOUND: Record<ScanType, ScanSound> = {
  trouve: 'inv_found', deja_scanne: 'inv_duplicate', non_enregistre: 'inv_unknown', hors_perimetre: 'inv_outside', ignore: 'inv_ignored',
}

interface ScanFeedback {
  type:    ScanType
  label:   string
  imei:    string
  itemId?: string
}

// ── Config visuelle par résultat ───────────────────────────
// Icon of a scan result (component, coloured by the result's text colour)
function ResultIcon({ type, className = 'inline w-3.5 h-3.5 -mt-0.5 mr-1' }: { type: string; className?: string }) {
  const Icon = RC[type]?.icon
  return Icon ? <Icon className={className} /> : null
}

const RC: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
  'trouve':          { label: 'Trouvé',          color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: CheckCircle2 },
  'manquant':        { label: 'Manquant',         color: 'text-red-600',     bg: 'bg-red-50',     border: 'border-red-200',     icon: XCircle },
  'non_enregistre':  { label: 'Non enregistré',   color: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-200',   icon: AlertTriangle },
  'hors_perimetre':  { label: 'Hors périmètre',   color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-blue-200',    icon: CircleDot },
  'en_attente':      { label: 'En attente',        color: 'text-ez-subtle',    bg: 'bg-white',       border: 'border-ez-border',    icon: Hourglass },
  'deja_scanne':     { label: 'Déjà scanné',      color: 'text-ez-subtle',    bg: 'bg-white',       border: 'border-ez-border',    icon: Undo2 },
  'ignore':          { label: 'Code ignoré',      color: 'text-ez-subtle',    bg: 'bg-white',       border: 'border-ez-border',    icon: ScanLine },
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: STORE_TIME_ZONE,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

// ── Composant principal ────────────────────────────────────
export default function InventoryModule({ role }: { role: string }) {
  type ViewMode = 'list' | 'scan' | 'report'

  const portal = usePortal()

  // State
  const [viewMode,        setViewMode]        = useState<ViewMode>('list')
  const [sessions,        setSessions]        = useState<SessionWithCounts[]>([])
  const [activeSession,   setActiveSession]   = useState<SessionWithCounts | null>(null)
  const [currentSession,  setCurrentSession]  = useState<InventorySession | null>(null)
  const [items,           setItems]           = useState<InventorySessionItem[]>([])
  const [scanFeedback,    setScanFeedback]    = useState<ScanFeedback | null>(null)
  const [recentScans,     setRecentScans]     = useState<ScanFeedback[]>([])
  const [isLoading,       setIsLoading]       = useState(true)
  const [isStarting,      setIsStarting]      = useState(false)
  const [isProcessing,    setIsProcessing]    = useState(false)
  const [isClosing,       setIsClosing]       = useState(false)
  const [manualMode,      setManualMode]      = useState(false)
  const [manualImei,      setManualImei]      = useState('')
  const [activeTab,       setActiveTab]       = useState<InventoryResultat>('manquant')
  const [showConfirm,     setShowConfirm]     = useState(false)
  const [cameraOk,        setCameraOk]        = useState(true)
  // what the missing phones cost (purchase prices; owner, 2026-11-06)
  const [missingValue,    setMissingValue]    = useState(0)
  const [busyItem,        setBusyItem]        = useState<string | null>(null)
  useEscapeKey(() => setShowConfirm(false), showConfirm)

  // Refs — pour éviter les closures périmées dans la boucle BarcodeDetector
  const videoRef          = useRef<HTMLVideoElement>(null)
  const streamRef         = useRef<MediaStream | null>(null)
  const animFrameRef      = useRef<number | null>(null)
  const lastScanRef       = useRef<{ imei: string; time: number } | null>(null)
  const feedbackTimer     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentSessionRef = useRef<InventorySession | null>(null)
  const isProcessingRef   = useRef(false)

  // Garder les refs à jour à chaque render
  currentSessionRef.current = currentSession
  isProcessingRef.current   = isProcessing

  // ── Compteurs dérivés ──────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const item of items) {
      c[item.resultat] = (c[item.resultat] ?? 0) + 1
    }
    return c
  }, [items])

  const progress = currentSession && currentSession.snapshot_count > 0
    ? Math.round(((counts['trouve'] ?? 0) / currentSession.snapshot_count) * 100)
    : 0

  // ── Fetch ──────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    setIsLoading(true)
    try {
      const res  = await fetch(`/api/inventory?store_id=${portal.storeId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const list: SessionWithCounts[] = data.sessions ?? []
      setSessions(list)
      setActiveSession(list.find(s => s.statut === 'en_cours') ?? null)
    } catch {
      toast.error('Impossible de charger les sessions')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchSessionDetail = useCallback(async (sessionId: string) => {
    try {
      const res  = await fetch(`/api/inventory/${sessionId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCurrentSession(data.session)
      setItems(data.items ?? [])
      setMissingValue(Number(data.missing_value ?? 0))
      return data
    } catch {
      toast.error('Impossible de charger la session')
      return null
    }
  }, [])

  useEffect(() => { fetchSessions() }, [fetchSessions])

  // While counting, the list follows the live stock: a phone sold, added or
  // corrected on another device shows here without starting again.
  const openSessionId = viewMode === 'scan' && currentSession?.statut === 'en_cours' ? currentSession.session_id : null
  useEffect(() => {
    if (!openSessionId) return
    const refresh = async () => {
      if (isProcessingRef.current || document.hidden) return
      try {
        const res = await fetch(`/api/inventory/${openSessionId}`)
        if (!res.ok) return
        const data = await res.json()
        if (isProcessingRef.current) return   // a scan landed meanwhile: its answer is newer
        setCurrentSession(data.session)
        setItems(data.items ?? [])
        setMissingValue(Number(data.missing_value ?? 0))
      } catch { /* next round */ }
    }
    const timer = setInterval(refresh, 8000)
    return () => clearInterval(timer)
  }, [openSessionId])

  // ── Scanner ────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  // processScan utilise des refs → closure stable, pas de redémarrage caméra
  const processScan = useCallback(async (imei: string) => {
    if (!currentSessionRef.current || isProcessingRef.current) return

    const now = Date.now()
    if (lastScanRef.current?.imei === imei && now - lastScanRef.current.time < 2000) return
    lastScanRef.current = { imei, time: now }

    // A phone box carries several barcodes (EAN, serial…): only an IMEI or a
    // PHO- label counts (owner, 2026-11-06: most "non enregistrés" were the
    // box's EAN). Anything else: a soft tick and a hint, nothing recorded.
    const code = imei.trim()
    if (!looksLikeImei(code) && !/^PHO-\d+$/i.test(code)) {
      playScanSound('inv_ignored')
      const feedback: ScanFeedback = { type: 'ignore', label: `${code} — pas un IMEI, visez le code IMEI`, imei: code }
      setScanFeedback(feedback)
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
      feedbackTimer.current = setTimeout(() => setScanFeedback(null), 2500)
      return
    }

    isProcessingRef.current = true
    setIsProcessing(true)

    try {
      const res  = await fetch(`/api/inventory/${currentSessionRef.current.session_id}/scan`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imei }),
      })
      const data = await res.json()
      if (!res.ok) { playScanSound('error'); toast.error(data.error ?? 'Erreur scan'); return }

      const { type, item } = data as { type: ScanType; item: InventorySessionItem }
      playScanSound(SOUND[type] ?? 'inv_found')

      setItems(prev => {
        const idx = prev.findIndex(i => i.item_id === item.item_id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = item
          return next
        }
        return [item, ...prev]
      })

      const labelMap: Record<string, string> = {
        'trouve':         item.phone_label ?? imei,
        'hors_perimetre': `${item.phone_label ?? '?'} (${item.phone_status ? codeLabel('device_status', item.phone_status as DeviceStatus, 'fr') : '?'})`,
        'non_enregistre': `IMEI : ${imei}`,
        'deja_scanne':    item.phone_label ?? imei,
      }

      const feedback: ScanFeedback = { type, label: labelMap[type] ?? imei, imei, itemId: type === 'deja_scanne' ? undefined : item.item_id }
      setScanFeedback(feedback)
      setRecentScans(prev => [feedback, ...prev].slice(0, 5))
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
      feedbackTimer.current = setTimeout(() => setScanFeedback(null), 2500)

    } catch {
      playScanSound('error')
      toast.error('Erreur réseau')
    } finally {
      isProcessingRef.current = false
      setIsProcessing(false)
    }
  }, []) // stable — utilise des refs

  const startCamera = useCallback(async () => {
    try {
      const [stream, { detector }] = await Promise.all([openCamera(), makeDetector()])
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        streamRef.current = stream
      }
      await tuneCamera(stream.getVideoTracks()[0])
      {
        const detect = async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) {
            animFrameRef.current = requestAnimationFrame(detect)
            return
          }
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes.length > 0) await processScan(codes[0].rawValue)
          } catch { /* frame vide */ }
          animFrameRef.current = requestAnimationFrame(detect)
        }
        animFrameRef.current = requestAnimationFrame(detect)
      }
    } catch {
      setCameraOk(false)
      setManualMode(true)
    }
  }, [processScan])

  // Démarrer/arrêter caméra uniquement quand viewMode change
  useEffect(() => {
    if (viewMode !== 'scan') return
    void startCamera()
    return stopCamera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  // ── Actions sessions ───────────────────────────────────
  const handleStart = async () => {
    setIsStarting(true)
    try {
      const res  = await fetch('/api/inventory', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ store_id: portal.storeId }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Erreur'); return }
      const detail = await fetchSessionDetail(data.session.session_id)
      if (detail) { setRecentScans([]); setViewMode('scan'); toast.success('Session démarrée') }
    } catch {
      toast.error('Erreur réseau')
    } finally {
      setIsStarting(false)
    }
  }

  const handleResume = async (sessionId: string) => {
    const detail = await fetchSessionDetail(sessionId)
    if (detail) { setRecentScans([]); setViewMode('scan') }
  }

  const handleClose = async () => {
    if (!currentSession) return
    setIsClosing(true)
    try {
      const res  = await fetch(`/api/inventory/${currentSession.session_id}/close`, { method: 'PATCH' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Erreur'); return }
      await fetchSessionDetail(currentSession.session_id)
      setShowConfirm(false)
      setActiveTab('manquant')
      setViewMode('report')
      toast.success('Session clôturée')
    } catch {
      toast.error('Erreur réseau')
    } finally {
      setIsClosing(false)
    }
  }

  const handleViewReport = async (sessionId: string) => {
    const detail = await fetchSessionDetail(sessionId)
    if (detail) { setActiveTab('manquant'); setViewMode('report') }
  }

  const handleBackToList = () => {
    setCurrentSession(null)
    setItems([])
    setRecentScans([])
    setViewMode('list')
    fetchSessions()
  }

  // A phone found by hand (label unreadable), or a scan taken back (owner, 2026-11-06)
  const itemAction = async (itemId: string, action: 'found' | 'undo') => {
    if (!currentSession) return
    setBusyItem(itemId)
    try {
      const res  = await fetch(`/api/inventory/${currentSession.session_id}/items/${itemId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Erreur'); return }
      if (action === 'found') playScanSound('inv_found')
      setRecentScans(prev => prev.filter(r => r.itemId !== itemId))
      await fetchSessionDetail(currentSession.session_id)
      toast.success(action === 'found' ? 'Marqué trouvé' : 'Scan annulé')
    } catch {
      toast.error('Erreur réseau')
    } finally {
      setBusyItem(null)
    }
  }

  const handleManualScan = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualImei.trim()) return
    await processScan(manualImei.trim())
    setManualImei('')
  }

  // ── Render : Liste sessions ────────────────────────────
  const renderList = () => (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gold/10 border border-gold/20">
            <PackageSearch className="text-gold" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ez-text tracking-wide" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              VÉRIFICATION D'INVENTAIRE
            </h1>
            <p className="text-ez-subtle text-sm">Rapprochement physique · Téléphones</p>
          </div>
        </div>
        {!activeSession && (
          <button
            onClick={handleStart}
            disabled={isStarting}
            className="flex items-center gap-2 px-4 py-2.5 bg-gold text-black font-bold rounded-xl text-sm hover:bg-[#b8932f] active:scale-95 transition-all disabled:opacity-50"
          >
            {isStarting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Nouvelle vérification
          </button>
        )}
      </div>

      {/* Bannière session en cours */}
      {activeSession && (
        <div className="mb-6 p-4 rounded-2xl border border-gold/40 bg-gold/8 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-gold font-bold text-sm tracking-wide flex items-center gap-1.5"><ScanLine className="w-4 h-4" />Vérification en cours</p>
            <p className="text-ez-text text-sm mt-1">
              Démarrée le {formatDate(activeSession.started_at)} · {activeSession.snapshot_count} téléphones en périmètre
            </p>
            <div className="flex flex-wrap gap-4 mt-2 text-xs">
              <span className="text-emerald-600"><CheckCircle2 className="inline w-3.5 h-3.5 -mt-0.5 mr-1" />{activeSession.counts?.['trouve'] ?? 0} trouvés</span>
              <span className="text-ez-subtle"><Hourglass className="inline w-3.5 h-3.5 -mt-0.5 mr-1" />{activeSession.counts?.['en_attente'] ?? 0} en attente</span>
              <span className="text-amber-600"><AlertTriangle className="inline w-3.5 h-3.5 -mt-0.5 mr-1" />{activeSession.counts?.['non_enregistre'] ?? 0} non enregistrés</span>
              <span className="text-blue-600"><CircleDot className="inline w-3.5 h-3.5 -mt-0.5 mr-1" />{activeSession.counts?.['hors_perimetre'] ?? 0} hors périmètre</span>
            </div>
          </div>
          <button
            onClick={() => handleResume(activeSession.session_id)}
            className="px-5 py-2.5 bg-gold text-black font-bold rounded-xl text-sm hover:bg-[#b8932f] transition-colors whitespace-nowrap"
          >
            Reprendre →
          </button>
        </div>
      )}

      {/* Historique */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-ez-faint" size={28} />
        </div>
      ) : sessions.filter(s => s.statut === 'terminee').length === 0 ? (
        <div className="text-center py-20">
          <PackageSearch size={44} className="mx-auto mb-4 text-ez-faint" />
          <p className="text-ez-subtle text-sm">Aucune vérification terminée</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-ez-faint font-semibold uppercase tracking-widest mb-3">Historique</p>
          {sessions.filter(s => s.statut === 'terminee').map(s => (
            <div
              key={s.session_id}
              className="bg-white border border-ez-border rounded-2xl p-4 flex items-center justify-between hover:border-ez-border transition-colors"
            >
              <div>
                <p className="text-ez-text text-sm font-semibold">{formatDate(s.started_at)}</p>
                <p className="text-ez-subtle text-xs mt-0.5">
                  {s.snapshot_count} en périmètre · Clôturée {s.completed_at ? formatDate(s.completed_at) : '—'}
                </p>
                <div className="flex flex-wrap gap-4 mt-2 text-xs">
                  <span className="text-emerald-600"><CheckCircle2 className="inline w-3.5 h-3.5 -mt-0.5 mr-1" />{s.counts?.['trouve'] ?? 0}</span>
                  <span className="text-red-600"><XCircle className="inline w-3.5 h-3.5 -mt-0.5 mr-1" />{s.counts?.['manquant'] ?? 0}</span>
                  <span className="text-amber-600"><AlertTriangle className="inline w-3.5 h-3.5 -mt-0.5 mr-1" />{s.counts?.['non_enregistre'] ?? 0}</span>
                  <span className="text-blue-600"><CircleDot className="inline w-3.5 h-3.5 -mt-0.5 mr-1" />{s.counts?.['hors_perimetre'] ?? 0}</span>
                </div>
              </div>
              <button
                onClick={() => handleViewReport(s.session_id)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-ez-border text-ez-subtle rounded-xl text-xs hover:border-gold hover:text-ez-text transition-colors"
              >
                <Eye size={13} /> Rapport
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ── Render : Mode scan ─────────────────────────────────
  const renderScan = () => (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={() => setViewMode('list')}
          className="flex items-center gap-1.5 text-ez-subtle hover:text-ez-text transition-colors text-sm"
        >
          <ChevronLeft size={18} /> Liste
        </button>
        <span className="text-ez-faint text-xs font-mono">#{currentSession?.session_id.slice(-8).toUpperCase()}</span>
        <button
          onClick={() => setShowConfirm(true)}
          className="px-3 py-1.5 border border-red-200 text-red-600 rounded-xl text-xs hover:bg-red-50 transition-colors"
        >
          Clôturer
        </button>
      </div>

      {/* Bannière feedback scan */}
      <div className={`mb-4 rounded-xl border p-3 transition-all duration-200 ${
        scanFeedback
          ? `${RC[scanFeedback.type]?.bg} ${RC[scanFeedback.type]?.border} opacity-100`
          : 'bg-white border-ez-border opacity-40'
      }`}>
        {scanFeedback ? (
          <>
            <p className={`font-bold text-sm ${RC[scanFeedback.type]?.color}`}>
              <ResultIcon type={scanFeedback.type} className="inline w-4 h-4 -mt-0.5 mr-1" />{RC[scanFeedback.type]?.label}
            </p>
            <p className="text-ez-text text-xs mt-0.5 truncate">{scanFeedback.label}</p>
          </>
        ) : (
          <p className="text-ez-faint text-sm text-center">En attente d'un scan…</p>
        )}
      </div>

      {/* Compteurs */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {[
          { key: 'en_attente',     label: 'En attente',      icon: Hourglass, color: 'text-ez-text' },
          { key: 'trouve',         label: 'Trouvés',         icon: CheckCircle2, color: 'text-emerald-600' },
          { key: 'non_enregistre', label: 'Non enregistrés', icon: AlertTriangle, color: 'text-amber-600' },
          { key: 'hors_perimetre', label: 'Hors périmètre',  icon: CircleDot, color: 'text-blue-600' },
        ].map(({ key, label, icon: Icon, color }) => (
          <div key={key} className="bg-white border border-ez-border rounded-xl p-3 text-center">
            <p className={`text-3xl font-bold ${color}`} style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              {counts[key] ?? 0}
            </p>
            <p className="text-ez-subtle text-xs mt-0.5"><Icon className="inline w-3.5 h-3.5 -mt-0.5 mr-1" />{label}</p>
          </div>
        ))}
      </div>

      {/* Barre de progression */}
      <div className="mb-5">
        <div className="flex justify-between text-xs text-ez-subtle mb-1.5">
          <span>Progression</span>
          <span>{counts['trouve'] ?? 0} / {currentSession?.snapshot_count ?? 0} ({progress}%)</span>
        </div>
        <div className="h-2 bg-ez-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gold rounded-full transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Flux vidéo */}
      {!manualMode && cameraOk && (
        <div className="relative mb-4 rounded-2xl overflow-hidden bg-black border border-ez-border">
          <video
            ref={videoRef}
            muted
            playsInline
            className="w-full"
            style={{ maxHeight: 200, objectFit: 'cover' }}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-52 h-20 border-2 border-gold rounded-lg">
              <span className="absolute -top-6 left-0 right-0 text-center text-gold text-xs font-medium">
                Pointer l'IMEI ici
              </span>
            </div>
          </div>
          {isProcessing && (
            <div className="absolute top-2 right-2 bg-white/80 rounded-full p-1">
              <Loader2 size={14} className="animate-spin text-gold" />
            </div>
          )}
        </div>
      )}

      {/* Basculer mode */}
      <button
        onClick={() => setManualMode(m => !m)}
        className="flex items-center gap-1.5 text-xs text-ez-subtle hover:text-ez-text transition-colors mb-3"
      >
        {manualMode
          ? <><ScanLine size={13} /> {cameraOk ? 'Utiliser la caméra' : 'Caméra indisponible'}</>
          : <><Keyboard size={13} /> Saisie manuelle</>
        }
      </button>

      {/* Input manuel */}
      <form onSubmit={handleManualScan} className="flex gap-2 mb-5">
        <input
          type="text"
          value={manualImei}
          onChange={e => setManualImei(e.target.value)}
          placeholder="IMEI ou code-barres…"
          className="flex-1 bg-white border border-ez-border rounded-xl px-3 py-2.5 text-ez-text text-sm focus:outline-none focus:border-gold placeholder:text-ez-placeholder transition-colors"
        />
        <button
          type="submit"
          disabled={!manualImei.trim() || isProcessing}
          className="px-4 py-2.5 bg-gold text-black font-bold rounded-xl text-sm hover:bg-[#b8932f] disabled:opacity-40 transition-colors"
        >
          OK
        </button>
      </form>

      {/* Derniers scans */}
      {recentScans.length > 0 && (
        <div className="mb-5">
          <p className="text-xs text-ez-faint font-semibold uppercase tracking-widest mb-2">Derniers scans</p>
          <div className="space-y-1.5">
            {recentScans.map((scan, i) => (
              <div
                key={i}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border ${RC[scan.type]?.bg} ${RC[scan.type]?.border}`}
              >
                <span className={`text-sm ${RC[scan.type]?.color ?? ''}`}><ResultIcon type={scan.type} className="w-4 h-4" /></span>
                <span className={`text-xs flex-1 truncate ${RC[scan.type]?.color}`}>{scan.label}</span>
                {scan.itemId && (
                  <button type="button" disabled={busyItem === scan.itemId} onClick={() => itemAction(scan.itemId!, 'undo')}
                    className="text-xs text-ez-subtle hover:text-red-600 underline underline-offset-2 shrink-0 disabled:opacity-40">
                    Annuler
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Articles en attente */}
      {(counts['en_attente'] ?? 0) > 0 && (
        <div>
          <p className="text-xs text-ez-faint font-semibold uppercase tracking-widest mb-2">
            En attente ({counts['en_attente'] ?? 0})
          </p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto rounded-xl">
            {items.filter(i => i.resultat === 'en_attente').map(item => (
              <div
                key={item.item_id}
                className="flex items-center justify-between px-3 py-2.5 bg-white border border-ez-border rounded-xl"
              >
                <div className="min-w-0">
                  <p className="text-ez-text text-sm truncate">{item.phone_label ?? '—'}</p>
                  <p className="text-ez-faint text-xs font-mono">{item.imei}</p>
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <span className="text-xs text-ez-faint bg-ez-muted px-2 py-0.5 rounded-lg">
                    {codeLabel('device_status', item.phone_status as DeviceStatus, 'fr')}
                  </span>
                  <button type="button" disabled={busyItem === item.item_id} onClick={() => itemAction(item.item_id, 'found')}
                    title="Étiquette illisible : marquer ce téléphone trouvé à la main"
                    className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-40">
                    Trouvé
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal confirmation clôture */}
      {showConfirm && (
        <div role="dialog" aria-modal="true" aria-label="Clôturer la session"
             className="fixed inset-0 bg-black/75 flex items-end sm:items-center justify-center z-50 p-4"
             onClick={() => setShowConfirm(false)}>
          <div className="bg-white border border-ez-border rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-ez-text font-bold text-lg mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              CLÔTURER LA SESSION ?
            </h3>
            <p className="text-ez-subtle text-sm mb-5 leading-relaxed">
              Les <span className="text-ez-text font-semibold">{counts['en_attente'] ?? 0}</span> téléphone(s) encore en attente
              seront marqués <span className="text-red-600 font-semibold">manquants</span>.
              Cette action est irréversible.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 border border-ez-border text-ez-text rounded-xl text-sm hover:border-gold transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleClose}
                disabled={isClosing}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isClosing ? <Loader2 size={15} className="animate-spin" /> : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // ── Render : Rapport ───────────────────────────────────
  const renderReport = () => {
    const tabs: Array<{ key: InventoryResultat; label: string; color: string }> = [
      { key: 'manquant',       label: 'Manquants',       color: 'text-red-600' },
      { key: 'hors_perimetre', label: 'Hors périmètre',  color: 'text-blue-600' },
      { key: 'non_enregistre', label: 'Non enregistrés', color: 'text-amber-600' },
      { key: 'trouve',         label: 'Trouvés',         color: 'text-emerald-600' },
    ]

    const tabItems = items.filter(i => i.resultat === activeTab)

    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={handleBackToList}
            className="flex items-center gap-1.5 text-ez-subtle hover:text-ez-text transition-colors text-sm"
          >
            <ChevronLeft size={18} /> Liste
          </button>
          <div>
            <h1 className="text-xl font-bold text-ez-text tracking-wide" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              RAPPORT D'INVENTAIRE
            </h1>
            <p className="text-ez-subtle text-xs">
              {currentSession && formatDate(currentSession.started_at)} · {currentSession?.snapshot_count ?? 0} en périmètre
              {missingValue > 0 && <> · <span className="text-red-600 font-semibold">manquants : {missingValue.toLocaleString('fr-FR').replace(/\s/g, ' ')} DH (prix d’achat)</span></>}
            </p>
          </div>
        </div>

        {/* Cartes résumé cliquables */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
          {tabs.map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`p-4 rounded-2xl border text-center transition-all ${
                activeTab === key
                  ? 'border-gold bg-gold/5'
                  : 'border-ez-border bg-white hover:border-ez-border'
              }`}
            >
              <p className={`text-3xl font-bold ${color}`} style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                {counts[key] ?? 0}
              </p>
              <p className="text-ez-subtle text-xs mt-1"><ResultIcon type={key} />{label}</p>
              {key === 'manquant' && missingValue > 0 && (
                <p className="text-red-600 text-xs font-semibold mt-0.5">{missingValue.toLocaleString('fr-FR').replace(/\s/g, ' ')} DH</p>
              )}
            </button>
          ))}
        </div>

        {/* Table d'articles */}
        <div className="bg-white border border-ez-border rounded-2xl overflow-hidden">
          {/* Onglets */}
          <div className="flex border-b border-ez-border overflow-x-auto">
            {tabs.map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex-1 shrink-0 min-w-max py-3 text-xs font-semibold transition-colors whitespace-nowrap px-3 ${
                  activeTab === key
                    ? `${color} border-b-2 border-gold bg-ez-muted`
                    : 'text-ez-subtle hover:text-ez-text'
                }`}
              >
                {label} ({counts[key] ?? 0})
              </button>
            ))}
          </div>

          {/* Contenu onglet */}
          <div className="max-h-[58vh] overflow-y-auto">
            {tabItems.length === 0 ? (
              <div className="py-14 text-center">
                <CheckCircle2 size={32} className="mx-auto mb-3 text-ez-faint" />
                <p className="text-ez-subtle text-sm">Aucun élément dans cette catégorie</p>
              </div>
            ) : (
              <div className="divide-y divide-ez-border">
                {tabItems.map(item => (
                  <div
                    key={item.item_id}
                    className="flex items-center justify-between px-4 py-3.5 hover:bg-ez-bg transition-colors"
                  >
                    <div className="min-w-0 mr-3">
                      <p className="text-ez-text text-sm font-medium truncate">{item.phone_label ?? '—'}</p>
                      <p className="text-ez-subtle text-xs font-mono mt-0.5">{item.imei}</p>
                      {item.phone_status && (
                        <span className="text-ez-faint text-xs">{codeLabel('device_status', item.phone_status as DeviceStatus, 'fr')}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.scanned_at && (
                        <span className="text-ez-faint text-xs">
                          {new Date(item.scanned_at).toLocaleTimeString('fr-FR', { timeZone: STORE_TIME_ZONE, hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      {activeTab === 'non_enregistre' && (
                        <a
                          href={`/ez/stock/phones?prefill=${item.imei}`}
                          className="px-2.5 py-1 text-xs bg-gold/15 text-gold border border-gold/30 rounded-lg hover:bg-gold/25 transition-colors"
                        >
                          Ajouter
                        </a>
                      )}
                      {(activeTab === 'manquant' || activeTab === 'hors_perimetre') && item.phone_id && (
                        <a
                          href={`/ez/stock/phones?id=${item.phone_id}`}
                          className="px-2.5 py-1 text-xs bg-ez-muted text-ez-text border border-ez-border rounded-lg hover:bg-ez-border transition-colors"
                        >
                          Voir
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Render principal ───────────────────────────────────
  return (
    <div className="min-h-screen bg-ez-bg text-ez-text">
      {viewMode === 'list' && renderList()}
      {viewMode === 'scan'   && currentSession && renderScan()}
      {viewMode === 'report' && currentSession && renderReport()}
    </div>
  )
}