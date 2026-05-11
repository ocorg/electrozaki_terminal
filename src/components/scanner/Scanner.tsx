'use client'
import { useEffect, useRef, useState } from 'react'
import {
  BrowserMultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  NotFoundException,
} from '@zxing/library'
import { X, Camera, SwitchCamera, Loader2 } from 'lucide-react'

interface ScannerProps {
  onResult: (value: string) => void
  onClose:  () => void
  hint?:    string
  mode?:    'barcode' | 'qr'   // barcode = wide 1D guide, qr = square guide
}

// ZXing hints: try harder + all useful formats
const HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, true],
  [DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.PDF_417,
  ]],
])

function stopStream(video: HTMLVideoElement | null) {
  if (!video?.srcObject) return
  ;(video.srcObject as MediaStream).getTracks().forEach(t => t.stop())
  video.srcObject = null
}

export default function Scanner({ onResult, onClose, hint, mode = 'qr' }: ScannerProps) {
  const videoRef                    = useRef<HTMLVideoElement>(null)
  const readerRef                   = useRef<BrowserMultiFormatReader | null>(null)
  const [devices, setDevices]       = useState<MediaDeviceInfo[]>([])
  const [deviceIdx, setDeviceIdx]   = useState(0)
  const [error, setError]           = useState<string | null>(null)
  const [loading, setLoading]       = useState(true)
  const [scanned, setScanned]       = useState(false)

  useEffect(() => {
    let active = true

    async function start() {
      try {
        setLoading(true)
        setError(null)

        const reader = new BrowserMultiFormatReader(HINTS)
        readerRef.current = reader

        const allDevices = await navigator.mediaDevices.enumerateDevices()
        const cams = allDevices.filter((d): d is MediaDeviceInfo => d.kind === 'videoinput')
        if (!active) return

        if (cams.length === 0) { setError('Aucune caméra détectée'); setLoading(false); return }

        const backCamera = cams.find(d =>
          /back|rear|environment/i.test(d.label)
        )
        const preferred = backCamera ? cams.indexOf(backCamera) : 0
        if (active) { setDevices(cams); setDeviceIdx(preferred) }

        // Request HD resolution for reliable 1D barcode decode
        await reader.decodeFromConstraints(
          {
            video: {
              deviceId:   cams[preferred]?.deviceId ? { exact: cams[preferred].deviceId } : undefined,
              facingMode: 'environment',
              width:      { ideal: 1920 },
              height:     { ideal: 1080 },
            },
          },
          videoRef.current!,
          (result, err) => {
            if (!active) return
            if (result && !scanned) {
              setScanned(true)
              setTimeout(() => { onResult(result.getText()) }, 150)
            }
            if (err && !(err instanceof NotFoundException)) {
              console.warn('[Scanner]', err)
            }
          }
        )
        if (active) setLoading(false)
      } catch (err: unknown) {
        if (!active) return
        const msg = (err as Error).message
        setError(
          msg.includes('Permission') || msg.includes('NotAllowed')
            ? "Accès caméra refusé. Autorisez l'accès dans les paramètres du navigateur."
            : `Erreur caméra: ${msg}`
        )
        setLoading(false)
      }
    }

    start()

    return () => {
      active = false
      readerRef.current?.reset()
      stopStream(videoRef.current)   // ← releases camera indicator dot
    }
  }, [deviceIdx])

  function switchCamera() {
    readerRef.current?.reset()
    stopStream(videoRef.current)
    setScanned(false)
    setDeviceIdx(prev => (prev + 1) % devices.length)
  }

  function handleClose() {
    readerRef.current?.reset()
    stopStream(videoRef.current)
    onClose()
  }

  // Guide frame: wide rectangle for 1D barcodes, square for QR
  const guideW = mode === 'barcode' ? 'w-72' : 'w-56'
  const guideH = mode === 'barcode' ? 'h-24' : 'h-56'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm">
      {/* wider container for tablet */}
      <div className="relative w-full max-w-xl mx-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-white" />
            <span className="text-white font-medium text-sm">
              {hint || 'Scannez un code-barres ou QR code'}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder — taller on tablet */}
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-video">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-white animate-spin mx-auto mb-2" />
                <p className="text-white text-sm">Démarrage caméra...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4">
              <div className="text-center">
                <Camera className="w-8 h-8 text-white/40 mx-auto mb-3" />
                <p className="text-white text-sm text-center">{error}</p>
              </div>
            </div>
          )}

          {scanned && (
            <div className="absolute inset-0 bg-emerald-500/30 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          )}

          {/* Adaptive guide frame */}
          {!loading && !error && !scanned && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className={`${guideW} ${guideH} relative`}>
                {[
                  'top-0 left-0 border-t-2 border-l-2',
                  'top-0 right-0 border-t-2 border-r-2',
                  'bottom-0 left-0 border-b-2 border-l-2',
                  'bottom-0 right-0 border-b-2 border-r-2',
                ].map((cls, i) => (
                  <div key={i} className={`absolute w-6 h-6 border-white rounded-sm ${cls}`} />
                ))}
                <div className="absolute left-1 right-1 top-1/2 h-0.5 bg-emerald-400/80 animate-pulse" />
                {mode === 'barcode' && (
                  <p className="absolute -bottom-6 left-0 right-0 text-center text-white/60 text-xs">
                    Alignez le code-barres à l'intérieur du cadre
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {devices.length > 1 && !loading && !error && (
          <button
            onClick={switchCamera}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-all"
          >
            <SwitchCamera className="w-4 h-4" />
            Changer de caméra ({deviceIdx + 1}/{devices.length})
          </button>
        )}

        <p className="text-white/40 text-xs text-center mt-3">
          Le scan se déclenche automatiquement
        </p>
      </div>
    </div>
  )
}