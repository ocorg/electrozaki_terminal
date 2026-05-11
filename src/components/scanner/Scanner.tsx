'use client'
import { useEffect, useRef, useState } from 'react'
import { X, Camera, SwitchCamera, Loader2 } from 'lucide-react'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ScannerProps {
  onResult: (value: string) => void
  onClose:  () => void
  hint?:    string
  mode?:    'barcode' | 'qr'  // kept for guide shape only — detection is always all-format
}

const NATIVE_FORMATS = [
  'aztec','code_128','code_39','code_93','codabar',
  'data_matrix','ean_13','ean_8','itf','pdf417',
  'qr_code','upc_a','upc_e',
]

export default function Scanner({ onResult, onClose, hint, mode = 'qr' }: ScannerProps) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const stopRef   = useRef<(() => void) | null>(null)
  const doneRef   = useRef(false)

  const [cameras,  setCameras]  = useState<MediaDeviceInfo[]>([])
  const [camIdx,   setCamIdx]   = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [scanned,  setScanned]  = useState(false)
  const [engine,   setEngine]   = useState<'native' | 'zxing' | null>(null)

  function finish(value: string) {
    if (doneRef.current) return
    doneRef.current = true
    setScanned(true)
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
      stopRef.current?.()
      stopRef.current = null

      try {
        // ── Enumerate cameras ─────────────────────────────────────────
        const allDevices = await navigator.mediaDevices.enumerateDevices()
        const cams = allDevices.filter(d => d.kind === 'videoinput')
        if (!alive) return
        if (cams.length) setCameras(cams)

        const targetId = cams[camIdx]?.deviceId

        // ── Open media stream ─────────────────────────────────────────
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId:   targetId ? { exact: targetId } : undefined,
            facingMode: targetId ? undefined : 'environment',
            width:      { ideal: 1920 },
            height:     { ideal: 1080 },
          },
        })
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return }

        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        if (alive) setLoading(false)

        const stopStream = () => {
          stream.getTracks().forEach(t => t.stop())
          if (video) video.srcObject = null
        }

        // ── PATH 1: Native BarcodeDetector (Chrome Android + Desktop) ─
        if ('BarcodeDetector' in window) {
          setEngine('native')
          const detector = new (window as any).BarcodeDetector({ formats: NATIVE_FORMATS })
          let rafId: number

          const tick = async () => {
            if (!alive || doneRef.current) return
            if (video.readyState >= video.HAVE_ENOUGH_DATA) {
              try {
                const codes: Array<{ rawValue: string }> = await detector.detect(video)
                if (codes[0]?.rawValue) { finish(codes[0].rawValue); return }
              } catch { /* frame not ready */ }
            }
            rafId = requestAnimationFrame(tick)
          }
          rafId = requestAnimationFrame(tick)
          stopRef.current = () => { cancelAnimationFrame(rafId); stopStream() }
          return
        }

        // ── PATH 2: ZXing fallback ────────────────────────────────────
        setEngine('zxing')
        const {
          BrowserMultiFormatReader,
          DecodeHintType,
          BarcodeFormat,
        } = await import('@zxing/library')

        const hints = new Map<number, unknown>([
          [DecodeHintType.TRY_HARDER, true],
          [DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
            BarcodeFormat.EAN_13,   BarcodeFormat.EAN_8,
            BarcodeFormat.QR_CODE,  BarcodeFormat.DATA_MATRIX,
            BarcodeFormat.PDF_417,
          ]],
        ])
        const reader = new BrowserMultiFormatReader(hints)

        // Feed the existing stream to ZXing via the video element
        reader.decodeFromStream(stream as any, video, (result, _err) => {
          if (!alive || !result) return
          finish(result.getText())
        })

        stopRef.current = () => {
          reader.reset()
          stopStream()
        }

      } catch (err: unknown) {
        if (!alive) return
        const msg = (err as Error).message ?? ''
        setError(
          msg.includes('NotAllowed') || msg.includes('Permission')
            ? "Accès caméra refusé. Autorisez l'accès dans les réglages Chrome."
            : msg.includes('OverconstrainedError') || msg.includes('Overconstrained')
            ? "Caméra non disponible. Essayez de changer de caméra."
            : `Erreur caméra: ${msg}`
        )
        setLoading(false)
      }
    }

    start()
    return () => { alive = false; stopRef.current?.() }
  }, [camIdx])

  function switchCamera(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (cameras.length < 2) return
    doneRef.current = false
    setScanned(false)
    setLoading(true)
    setCamIdx(p => (p + 1) % cameras.length)
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
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />

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

        {/* Switch camera */}
        {cameras.length > 1 && !loading && !error && (
          <button type="button" onClick={switchCamera}
            className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-all">
            <SwitchCamera className="w-4 h-4" />
            Changer de caméra ({camIdx + 1}/{cameras.length})
          </button>
        )}

        <p className="text-white/30 text-xs text-center mt-2">
          {engine === 'native' ? '⚡ Détection native — QR & codes-barres' : engine === 'zxing' ? 'ZXing — pointez vers le code' : ''}
        </p>
      </div>
    </div>
  )
}