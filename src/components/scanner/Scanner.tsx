'use client'
import { useEffect, useRef, useState } from 'react'
import { X, Camera, SwitchCamera, Loader2, Flashlight, ZoomIn } from 'lucide-react'
import { makeDetector, openCamera, tuneCamera } from '@/lib/barcode'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ScannerProps {
  onResult: (value: string) => void
  onClose:  () => void
  hint?:    string
  mode?:    'barcode' | 'qr'  // kept for guide shape only — detection is always all-format
}

export default function Scanner({ onResult, onClose, hint, mode = 'qr' }: ScannerProps) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const stopRef   = useRef<(() => void) | null>(null)
  const trackRef  = useRef<MediaStreamTrack | null>(null)
  const doneRef   = useRef(false)

  // Back or front camera, chosen by the phone itself ("environment" = its
  // main back lens). Not by device list: an iPhone lists up to 14 "cameras"
  // (ultra-wide, telephoto, virtual…) and the first one often can't focus up close.
  const [facing,   setFacing]   = useState<'environment' | 'user'>('environment')
  const [hasFront, setHasFront] = useState(false)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [scanned,  setScanned]  = useState(false)
  const [engine,   setEngine]   = useState<'native' | 'wasm' | null>(null)
  const [torch,    setTorch]    = useState<boolean | null>(null)          // null = not supported
  const [zoom,     setZoom]     = useState<{ min: number; max: number; step: number; value: number } | null>(null)

  function finish(value: string) {
    if (doneRef.current) return
    doneRef.current = true
    setScanned(true)
    navigator.vibrate?.(60)
    setTimeout(() => { stopRef.current?.(); onResult(value) }, 350)
  }

  function close(e?: React.MouseEvent) {
    e?.preventDefault()
    e?.stopPropagation()
    stopRef.current?.()
    onClose()
  }

  useEffect(() => {
    doneRef.current = false
    let alive = true

    async function start() {
      setLoading(true)
      setError(null)
      setTorch(null)
      setZoom(null)
      stopRef.current?.()
      stopRef.current = null

      try {
        const [stream, { detector, engine }] = await Promise.all([
          openCamera(facing),
          makeDetector(),
        ])
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return }
        setEngine(engine)

        const track = stream.getVideoTracks()[0]
        trackRef.current = track
        const tuned = await tuneCamera(track)
        setZoom(tuned.zoom)
        if (tuned.torch) setTorch(false)

        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
        if (alive) setHasFront(devices.filter(d => d.kind === 'videoinput').length > 1)

        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        if (alive) setLoading(false)

        // ~8 reads per second: plenty to feel instant, light on older phones.
        let timer: ReturnType<typeof setTimeout>
        const tick = async () => {
          if (!alive || doneRef.current) return
          if (video.readyState >= video.HAVE_ENOUGH_DATA) {
            try {
              const codes = await detector.detect(video)
              const value = codes.find(c => c.rawValue)?.rawValue
              if (value) { finish(value); return }
            } catch { /* frame not ready */ }
          }
          timer = setTimeout(tick, 120)
        }
        tick()

        stopRef.current = () => {
          clearTimeout(timer)
          stream.getTracks().forEach(t => t.stop())
          video.srcObject = null
          trackRef.current = null
        }
      } catch (err: unknown) {
        if (!alive) return
        const e = err as Error
        const text = `${e.name ?? ''} ${e.message ?? ''}`
        setError(
          /NotAllowed|Permission|Security/i.test(text)
            ? "Accès à la caméra refusé. Autorisez la caméra pour ce site dans les réglages du navigateur (sur iPhone : Réglages → Safari → Caméra), puis réessayez."
            : /NotFound|Overconstrained/i.test(text)
            ? 'Caméra introuvable. Essayez de changer de caméra.'
            : /NotReadable|TrackStart/i.test(text)
            ? "La caméra est déjà utilisée par une autre application. Fermez-la et réessayez."
            : `Erreur caméra : ${e.message || e.name}`,
        )
        setLoading(false)
      }
    }

    start()
    return () => { alive = false; stopRef.current?.() }
  }, [facing])

  function switchCamera(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    doneRef.current = false
    setScanned(false)
    setFacing(f => (f === 'environment' ? 'user' : 'environment'))
  }

  async function toggleTorch(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const track = trackRef.current
    if (!track || torch === null) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as any] })
      setTorch(!torch)
    } catch { /* not allowed on this phone */ }
  }

  async function changeZoom(value: number) {
    const track = trackRef.current
    if (!track || !zoom) return
    setZoom({ ...zoom, value })
    await track.applyConstraints({ advanced: [{ zoom: value } as any] }).catch(() => {})
  }

  // Guide: wide rectangle for 1D barcodes, square for QR
  const guideW = mode === 'barcode' ? 'w-4/5' : 'w-3/5'
  const guideH = mode === 'barcode' ? 'h-1/4' : 'h-1/2'

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={e => e.stopPropagation()}
    >
      <div className="relative w-full max-w-xl mx-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-white" />
            <span className="text-white text-sm font-medium">
              {hint || 'Scanner un code'}
            </span>
          </div>
          <button type="button" onClick={close}
            className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder */}
        <div className="relative rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: '4/3' }}>
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline autoPlay />

          {loading && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
              <p className="text-white/80 text-sm">Démarrage caméra...</p>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 p-6 gap-4">
              <Camera className="w-10 h-10 text-white/20" />
              <p className="text-white text-sm text-center leading-relaxed">{error}</p>
            </div>
          )}

          {scanned && (
            <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/30">
              <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center shadow-2xl">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          )}

          {/* Scan guide */}
          {!loading && !error && !scanned && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className={`${guideW} ${guideH} relative`}>
                {[
                  'top-0 left-0 border-t-[3px] border-l-[3px]',
                  'top-0 right-0 border-t-[3px] border-r-[3px]',
                  'bottom-0 left-0 border-b-[3px] border-l-[3px]',
                  'bottom-0 right-0 border-b-[3px] border-r-[3px]',
                ].map((cls, i) => (
                  <div key={i} className={`absolute w-7 h-7 border-white rounded-sm ${cls}`} />
                ))}
                <div className="absolute inset-x-2 top-1/2 h-px bg-emerald-400/90 animate-pulse" />
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        {!loading && !error && (
          <div className="mt-3 space-y-2">
            {zoom && (
              <label className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/10 text-white text-xs">
                <ZoomIn className="w-4 h-4 flex-shrink-0" />
                <input type="range" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.value}
                  onChange={e => changeZoom(Number(e.target.value))} className="flex-1 accent-emerald-400" />
                <span className="w-10 text-right tabular-nums">×{zoom.value.toFixed(1)}</span>
              </label>
            )}
            <div className="flex gap-2">
              {hasFront && (
                <button type="button" onClick={switchCamera}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-all">
                  <SwitchCamera className="w-4 h-4" />
                  {facing === 'environment' ? 'Caméra avant' : 'Caméra arrière'}
                </button>
              )}
              {torch !== null && (
                <button type="button" onClick={toggleTorch}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all ${torch ? 'bg-amber-400 text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}>
                  <Flashlight className="w-4 h-4" />
                  {torch ? 'Lampe allumée' : 'Lampe'}
                </button>
              )}
            </div>
          </div>
        )}

        <p className="text-white/40 text-xs text-center mt-2">
          Tenez le code à ~15 cm, bien éclairé et à plat
          {engine && <span className="text-white/25"> · {engine === 'native' ? 'lecteur natif' : 'lecteur intégré'}</span>}
        </p>
      </div>
    </div>
  )
}
