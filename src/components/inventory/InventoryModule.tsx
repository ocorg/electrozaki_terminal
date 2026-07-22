'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  PackageSearch, Plus, ChevronLeft, CheckCircle2,
  Loader2, Keyboard, ScanLine, Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import type { InventorySession, InventorySessionItem, InventoryResultat } from '@/types/database'

// ── Types internes ─────────────────────────────────────────
interface SessionWithCounts extends InventorySession {
  counts: Record<string, number>
}

type ScanType = 'trouvé' | 'hors_périmètre' | 'non_enregistré' | 'déjà_scanné'

interface ScanFeedback {
  type:  ScanType
  label: string
  imei:  string
}

// ── Config visuelle par résultat ───────────────────────────
const RC: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  'trouvé':          { label: 'Trouvé',          color: 'text-emerald-400', bg: 'bg-emerald-950/60', border: 'border-emerald-700', icon: '✅' },
  'manquant':        { label: 'Manquant',         color: 'text-red-400',     bg: 'bg-red-950/60',     border: 'border-red-800',     icon: '❌' },
  'non_enregistré':  { label: 'Non enregistré',   color: 'text-amber-400',   bg: 'bg-amber-950/60',   border: 'border-amber-700',   icon: '⚠️' },
  'hors_périmètre':  { label: 'Hors périmètre',   color: 'text-blue-400',    bg: 'bg-blue-950/60',    border: 'border-blue-800',    icon: '🔵' },
  'en_attente':      { label: 'En attente',        color: 'text-zinc-400',    bg: 'bg-zinc-900',       border: 'border-zinc-700',    icon: '⏳' },
  'déjà_scanné':     { label: 'Déjà scanné',      color: 'text-zinc-400',    bg: 'bg-zinc-900',       border: 'border-zinc-700',    icon: '↩' },
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

// ── Composant principal ────────────────────────────────────
export default function InventoryModule({ role }: { role: string }) {
  type ViewMode = 'list' | 'scan' | 'report'

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
    ? Math.round(((counts['trouvé'] ?? 0) / currentSession.snapshot_count) * 100)
    : 0

  // ── Fetch ──────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    setIsLoading(true)
    try {
      const res  = await fetch('/api/inventory')
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
      return data
    } catch {
      toast.error('Impossible de charger la session')
      return null
    }
  }, [])

  useEffect(() => { fetchSessions() }, [fetchSessions])

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

    isProcessingRef.current = true
    setIsProcessing(true)

    try {
      const res  = await fetch(`/api/inventory/${currentSessionRef.current.session_id}/scan`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imei }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Erreur scan'); return }

      const { type, item } = data as { type: ScanType; item: InventorySessionItem }

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
        'trouvé':         item.phone_label ?? imei,
        'hors_périmètre': `${item.phone_label ?? '?'} (${item.phone_status ?? '?'})`,
        'non_enregistré': `IMEI : ${imei}`,
        'déjà_scanné':    item.phone_label ?? imei,
      }

      const feedback: ScanFeedback = { type, label: labelMap[type] ?? imei, imei }
      setScanFeedback(feedback)
      setRecentScans(prev => [feedback, ...prev].slice(0, 5))
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
      feedbackTimer.current = setTimeout(() => setScanFeedback(null), 2500)

    } catch {
      toast.error('Erreur réseau')
    } finally {
      isProcessingRef.current = false
      setIsProcessing(false)
    }
  }, []) // stable — utilise des refs

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        streamRef.current = stream
      }
      if ('BarcodeDetector' in window) {
        const detector = new (window as any).BarcodeDetector({
          formats: ['code_128', 'ean_13', 'code_39', 'qr_code'],
        })
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
      } else {
        setManualMode(true)
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
      const res  = await fetch('/api/inventory', { method: 'POST' })
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
          <div className="p-2.5 rounded-xl bg-[#C9A440]/10 border border-[#C9A440]/20">
            <PackageSearch className="text-[#C9A440]" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-wide" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              VÉRIFICATION D'INVENTAIRE
            </h1>
            <p className="text-zinc-500 text-sm">Rapprochement physique · Téléphones</p>
          </div>
        </div>
        {!activeSession && (
          <button
            onClick={handleStart}
            disabled={isStarting}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#C9A440] text-black font-bold rounded-xl text-sm hover:bg-[#b8932f] active:scale-95 transition-all disabled:opacity-50"
          >
            {isStarting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Nouvelle vérification
          </button>
        )}
      </div>

      {/* Bannière session en cours */}
      {activeSession && (
        <div className="mb-6 p-4 rounded-2xl border border-[#C9A440]/40 bg-[#C9A440]/8 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-[#C9A440] font-bold text-sm tracking-wide">⚡ VÉRIFICATION EN COURS</p>
            <p className="text-zinc-300 text-sm mt-1">
              Démarrée le {formatDate(activeSession.started_at)} · {activeSession.snapshot_count} téléphones en périmètre
            </p>
            <div className="flex flex-wrap gap-4 mt-2 text-xs">
              <span className="text-emerald-400">✅ {activeSession.counts?.['trouvé'] ?? 0} trouvés</span>
              <span className="text-zinc-500">⏳ {activeSession.counts?.['en_attente'] ?? 0} en attente</span>
              <span className="text-amber-400">⚠️ {activeSession.counts?.['non_enregistré'] ?? 0} non enregistrés</span>
              <span className="text-blue-400">🔵 {activeSession.counts?.['hors_périmètre'] ?? 0} hors périmètre</span>
            </div>
          </div>
          <button
            onClick={() => handleResume(activeSession.session_id)}
            className="px-5 py-2.5 bg-[#C9A440] text-black font-bold rounded-xl text-sm hover:bg-[#b8932f] transition-colors whitespace-nowrap"
          >
            Reprendre →
          </button>
        </div>
      )}

      {/* Historique */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-zinc-600" size={28} />
        </div>
      ) : sessions.filter(s => s.statut === 'terminée').length === 0 ? (
        <div className="text-center py-20">
          <PackageSearch size={44} className="mx-auto mb-4 text-zinc-700" />
          <p className="text-zinc-500 text-sm">Aucune vérification terminée</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-zinc-600 font-semibold uppercase tracking-widest mb-3">Historique</p>
          {sessions.filter(s => s.statut === 'terminée').map(s => (
            <div
              key={s.session_id}
              className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between hover:border-zinc-700 transition-colors"
            >
              <div>
                <p className="text-white text-sm font-semibold">{formatDate(s.started_at)}</p>
                <p className="text-zinc-500 text-xs mt-0.5">
                  {s.snapshot_count} en périmètre · Clôturée {s.completed_at ? formatDate(s.completed_at) : '—'}
                </p>
                <div className="flex flex-wrap gap-4 mt-2 text-xs">
                  <span className="text-emerald-400">✅ {s.counts?.['trouvé'] ?? 0}</span>
                  <span className="text-red-400">❌ {s.counts?.['manquant'] ?? 0}</span>
                  <span className="text-amber-400">⚠️ {s.counts?.['non_enregistré'] ?? 0}</span>
                  <span className="text-blue-400">🔵 {s.counts?.['hors_périmètre'] ?? 0}</span>
                </div>
              </div>
              <button
                onClick={() => handleViewReport(s.session_id)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-700 text-zinc-400 rounded-xl text-xs hover:border-zinc-500 hover:text-white transition-colors"
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
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm"
        >
          <ChevronLeft size={18} /> Liste
        </button>
        <span className="text-zinc-600 text-xs font-mono">#{currentSession?.session_id.slice(-8).toUpperCase()}</span>
        <button
          onClick={() => setShowConfirm(true)}
          className="px-3 py-1.5 border border-red-800 text-red-400 rounded-xl text-xs hover:bg-red-950/40 transition-colors"
        >
          Clôturer
        </button>
      </div>

      {/* Bannière feedback scan */}
      <div className={`mb-4 rounded-xl border p-3 transition-all duration-200 ${
        scanFeedback
          ? `${RC[scanFeedback.type]?.bg} ${RC[scanFeedback.type]?.border} opacity-100`
          : 'bg-zinc-900 border-zinc-800 opacity-40'
      }`}>
        {scanFeedback ? (
          <>
            <p className={`font-bold text-sm ${RC[scanFeedback.type]?.color}`}>
              {RC[scanFeedback.type]?.icon} {RC[scanFeedback.type]?.label}
            </p>
            <p className="text-zinc-300 text-xs mt-0.5 truncate">{scanFeedback.label}</p>
          </>
        ) : (
          <p className="text-zinc-600 text-sm text-center">En attente d'un scan…</p>
        )}
      </div>

      {/* Compteurs */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {[
          { key: 'en_attente',     label: 'En attente',      icon: '⏳', color: 'text-zinc-300' },
          { key: 'trouvé',         label: 'Trouvés',         icon: '✅', color: 'text-emerald-400' },
          { key: 'non_enregistré', label: 'Non enregistrés', icon: '⚠️', color: 'text-amber-400' },
          { key: 'hors_périmètre', label: 'Hors périmètre',  icon: '🔵', color: 'text-blue-400' },
        ].map(({ key, label, icon, color }) => (
          <div key={key} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
            <p className={`text-3xl font-bold ${color}`} style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              {counts[key] ?? 0}
            </p>
            <p className="text-zinc-500 text-xs mt-0.5">{icon} {label}</p>
          </div>
        ))}
      </div>

      {/* Barre de progression */}
      <div className="mb-5">
        <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
          <span>Progression</span>
          <span>{counts['trouvé'] ?? 0} / {currentSession?.snapshot_count ?? 0} ({progress}%)</span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#C9A440] rounded-full transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Flux vidéo */}
      {!manualMode && cameraOk && (
        <div className="relative mb-4 rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800">
          <video
            ref={videoRef}
            muted
            playsInline
            className="w-full"
            style={{ maxHeight: 200, objectFit: 'cover' }}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-52 h-20 border-2 border-[#C9A440] rounded-lg">
              <span className="absolute -top-6 left-0 right-0 text-center text-[#C9A440] text-xs font-medium">
                Pointer l'IMEI ici
              </span>
            </div>
          </div>
          {isProcessing && (
            <div className="absolute top-2 right-2 bg-black/60 rounded-full p-1">
              <Loader2 size={14} className="animate-spin text-[#C9A440]" />
            </div>
          )}
        </div>
      )}

      {/* Basculer mode */}
      <button
        onClick={() => setManualMode(m => !m)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-3"
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
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#C9A440] placeholder-zinc-600 transition-colors"
        />
        <button
          type="submit"
          disabled={!manualImei.trim() || isProcessing}
          className="px-4 py-2.5 bg-[#C9A440] text-black font-bold rounded-xl text-sm hover:bg-[#b8932f] disabled:opacity-40 transition-colors"
        >
          OK
        </button>
      </form>

      {/* Derniers scans */}
      {recentScans.length > 0 && (
        <div className="mb-5">
          <p className="text-xs text-zinc-600 font-semibold uppercase tracking-widest mb-2">Derniers scans</p>
          <div className="space-y-1.5">
            {recentScans.map((scan, i) => (
              <div
                key={i}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border ${RC[scan.type]?.bg} ${RC[scan.type]?.border}`}
              >
                <span className="text-sm">{RC[scan.type]?.icon}</span>
                <span className={`text-xs flex-1 truncate ${RC[scan.type]?.color}`}>{scan.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Articles en attente */}
      {(counts['en_attente'] ?? 0) > 0 && (
        <div>
          <p className="text-xs text-zinc-600 font-semibold uppercase tracking-widest mb-2">
            En attente ({counts['en_attente'] ?? 0})
          </p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto rounded-xl">
            {items.filter(i => i.resultat === 'en_attente').map(item => (
              <div
                key={item.item_id}
                className="flex items-center justify-between px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl"
              >
                <div className="min-w-0">
                  <p className="text-white text-sm truncate">{item.phone_label ?? '—'}</p>
                  <p className="text-zinc-600 text-xs font-mono">{item.imei}</p>
                </div>
                <span className="text-xs text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded-lg ml-2 shrink-0">
                  {item.phone_status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal confirmation clôture */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/75 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-white font-bold text-lg mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              CLÔTURER LA SESSION ?
            </h3>
            <p className="text-zinc-400 text-sm mb-5 leading-relaxed">
              Les <span className="text-white font-semibold">{counts['en_attente'] ?? 0}</span> téléphone(s) encore en attente
              seront marqués <span className="text-red-400 font-semibold">manquants</span>.
              Cette action est irréversible.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 border border-zinc-700 text-zinc-300 rounded-xl text-sm hover:border-zinc-500 transition-colors"
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
      { key: 'manquant',       label: 'Manquants',       color: 'text-red-400' },
      { key: 'hors_périmètre', label: 'Hors périmètre',  color: 'text-blue-400' },
      { key: 'non_enregistré', label: 'Non enregistrés', color: 'text-amber-400' },
      { key: 'trouvé',         label: 'Trouvés',         color: 'text-emerald-400' },
    ]

    const tabItems = items.filter(i => i.resultat === activeTab)

    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={handleBackToList}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm"
          >
            <ChevronLeft size={18} /> Liste
          </button>
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              RAPPORT D'INVENTAIRE
            </h1>
            <p className="text-zinc-500 text-xs">
              {currentSession && formatDate(currentSession.started_at)} · {currentSession?.snapshot_count ?? 0} en périmètre
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
                  ? 'border-[#C9A440] bg-[#C9A440]/5'
                  : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
              }`}
            >
              <p className={`text-3xl font-bold ${color}`} style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                {counts[key] ?? 0}
              </p>
              <p className="text-zinc-500 text-xs mt-1">{RC[key]?.icon} {label}</p>
            </button>
          ))}
        </div>

        {/* Table d'articles */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          {/* Onglets */}
          <div className="flex border-b border-zinc-800 overflow-x-auto">
            {tabs.map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex-1 min-w-[6rem] py-3 text-xs font-semibold transition-colors whitespace-nowrap px-2 ${
                  activeTab === key
                    ? `${color} border-b-2 border-[#C9A440] bg-zinc-800/40`
                    : 'text-zinc-500 hover:text-zinc-300'
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
                <CheckCircle2 size={32} className="mx-auto mb-3 text-zinc-700" />
                <p className="text-zinc-500 text-sm">Aucun élément dans cette catégorie</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/70">
                {tabItems.map(item => (
                  <div
                    key={item.item_id}
                    className="flex items-center justify-between px-4 py-3.5 hover:bg-zinc-800/30 transition-colors"
                  >
                    <div className="min-w-0 mr-3">
                      <p className="text-white text-sm font-medium truncate">{item.phone_label ?? '—'}</p>
                      <p className="text-zinc-500 text-xs font-mono mt-0.5">{item.imei}</p>
                      {item.phone_status && (
                        <span className="text-zinc-600 text-xs">{item.phone_status}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.scanned_at && (
                        <span className="text-zinc-600 text-xs">
                          {new Date(item.scanned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      {activeTab === 'non_enregistré' && (
                        <a
                          href={`/ez/stock/phones?prefill=${item.imei}`}
                          className="px-2.5 py-1 text-xs bg-[#C9A440]/15 text-[#C9A440] border border-[#C9A440]/30 rounded-lg hover:bg-[#C9A440]/25 transition-colors"
                        >
                          Ajouter
                        </a>
                      )}
                      {(activeTab === 'manquant' || activeTab === 'hors_périmètre') && item.phone_id && (
                        <a
                          href={`/ez/stock/phones?id=${item.phone_id}`}
                          className="px-2.5 py-1 text-xs bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors"
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
    <div className="min-h-screen bg-black text-white">
      {viewMode === 'list' && renderList()}
      {viewMode === 'scan'   && currentSession && renderScan()}
      {viewMode === 'report' && currentSession && renderReport()}
    </div>
  )
}