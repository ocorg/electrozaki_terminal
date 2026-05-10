'use client'
import { useRef, useState, useEffect } from 'react'
import { usePortal } from '@/lib/context/portal'
import { useLanguageStore } from '@/lib/stores/language'
import { Modal, Btn } from '@/components/shared'
import { Download, Share2, Printer, Loader2 } from 'lucide-react'
import dynamic from 'next/dynamic'

const QRCode = dynamic(() => import('qrcode').then(m => ({
  default: ({ value, size }: { value: string; size: number }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    useEffect(() => {
      if (canvasRef.current) {
        m.toCanvas(canvasRef.current, value, {
          width: size, margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' },
        }).catch(() => {})
      }
    }, [value, size])
    return <canvas ref={canvasRef} width={size} height={size} />
  },
})), { ssr: false })

export interface LabelProduct {
  id:             string
  name:           string   // full display name (fallback)
  marque?:        string   // brand only  e.g. "Apple"
  model?:         string   // model only  e.g. "16 Pro"
  category:       string
  type?:          string
  imei?:          string
  couleur?:       string
  stockage?:      string
  battery_level?: number
  ram?:           string
}

interface LabelGeneratorProps {
  product: LabelProduct
  open:    boolean
  onClose: () => void
}

// 40mm × 30mm at 3× screen density
const W    = 453   // px
const H    = 339   // px
const W_MM = 40
const H_MM = 30

// Layout constants
const IMEI_H = 52          // footer height
const MAIN_H = H - IMEI_H // 287px
const COL    = W / 2       // 226px per column
const PAD    = 12          // inner padding

// Normalise a spec value: append unit if not already present
function withUnit(val: string | undefined | null, unit: string): string | null {
  if (!val) return null
  const v = val.trim()
  return v.toUpperCase().endsWith(unit.toUpperCase()) ? v.toUpperCase() : `${v.toUpperCase()}${unit}`
}

export default function LabelGenerator({ product, open, onClose }: LabelGeneratorProps) {
  const portal           = usePortal()
  const { language }     = useLanguageStore()
  const isAr             = language === 'ar'
  const labelRef         = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)

  const siteName = portal.storeName.toUpperCase()

  // Derived display values — all uppercase for thermal impact
  const marqueStr  = (product.marque  || product.name.split(' ')[0]).toUpperCase()
  const modelStr   = (product.model   || product.name.split(' ').slice(1).join(' ')).toUpperCase()
  const storageStr = withUnit(product.stockage, 'GB')
  const ramStr     = withUnit(product.ram, 'GB')
  const battStr    = product.battery_level != null ? `${product.battery_level}%` : null

  // ── Export helpers ─────────────────────────────────────────
  async function exportPNG(): Promise<Blob | null> {
    if (!labelRef.current) return null
    setExporting(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(labelRef.current, {
        scale: 1, useCORS: true, backgroundColor: '#FFFFFF', width: W, height: H,
      })
      return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    } finally { setExporting(false) }
  }

  async function handleDownloadPNG() {
    const blob = await exportPNG(); if (!blob) return
    const url = URL.createObjectURL(blob)
    const a   = Object.assign(document.createElement('a'), { href: url, download: `label-${product.id}.png` })
    a.click(); URL.revokeObjectURL(url)
  }

  async function handleDownloadPDF() {
    const blob = await exportPNG(); if (!blob) return
    setExporting(true)
    try {
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [W_MM, H_MM] })
      pdf.addImage(await blobToDataURL(blob), 'PNG', 0, 0, W_MM, H_MM)
      pdf.save(`label-${product.id}.pdf`)
    } finally { setExporting(false) }
  }

  async function handleShare() {
    const blob = await exportPNG(); if (!blob) return
    const file = new File([blob], `label-${product.id}.png`, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: product.name }) } catch {}
    } else { handleDownloadPNG() }
  }

  async function handlePrint() {
    const blob = await exportPNG(); if (!blob) return
    const url  = URL.createObjectURL(blob)
    const win  = window.open(url, '_blank')
    win?.addEventListener('load', () => { win.print(); URL.revokeObjectURL(url) })
  }

  // ── Shared text style ──────────────────────────────────────
  const mono: React.CSSProperties = {
    fontFamily: "'Barlow Condensed', Arial Narrow, Arial, sans-serif",
    color:      '#000000',
  }

  return (
    <Modal open={open} onClose={onClose}
      title={isAr ? 'مولد الملصقات' : "Générateur d'étiquette"}
      size="md">
      <div className="space-y-5">

        {/* ── Label preview ───────────────────────────────── */}
        <div className="flex justify-center overflow-hidden w-full">
          <div style={{
            transform:       'scale(0.72)',
            transformOrigin: 'top center',
            marginBottom:    `-${Math.round(H * 0.28)}px`,
          }}>
            <div
              ref={labelRef}
              style={{
                width:           `${W}px`,
                height:          `${H}px`,
                backgroundColor: '#FFFFFF',
                border:          '2px solid #000000',
                borderRadius:    '4px',
                display:         'flex',
                flexDirection:   'column',
                overflow:        'hidden',
                flexShrink:      0,
                ...mono,
              }}
            >
              {/* ── Main row: two equal columns ─────────── */}
              <div style={{ display: 'flex', flexDirection: 'row', height: `${MAIN_H}px`, flexShrink: 0 }}>

                {/* LEFT COLUMN — store name + QR */}
                <div style={{
                  width:          `${COL}px`,
                  flexShrink:     0,
                  display:        'flex',
                  flexDirection:  'column',
                  alignItems:     'center',
                  padding:        `${PAD}px ${PAD - 4}px ${PAD - 4}px ${PAD}px`,
                  borderRight:    '2px solid #000000',
                  gap:            '6px',
                }}>
                  {/* Store name */}
                  <p style={{
                    fontSize:      '30px',
                    fontWeight:    '900',
                    letterSpacing: '0.06em',
                    lineHeight:    '1',
                    textAlign:     'center',
                    width:         '100%',
                    ...mono,
                  }}>
                    {siteName}
                  </p>
                  {/* QR code */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                    <QRCode value={product.imei || product.id} size={200} />
                  </div>
                </div>

                {/* RIGHT COLUMN — marque / model / specs */}
                <div style={{
                  flex:           1,
                  display:        'flex',
                  flexDirection:  'column',
                  justifyContent: 'space-evenly',
                  padding:        `${PAD - 2}px ${PAD}px ${PAD - 2}px ${PAD - 2}px`,
                  gap:            '2px',
                }}>
                  {/* MARQUE */}
                  <p style={{
                    fontSize:    '50px',
                    fontWeight:  '900',
                    lineHeight:  '1',
                    letterSpacing: '-0.01em',
                    wordBreak:   'break-word',
                    ...mono,
                  }}>
                    {marqueStr}
                  </p>

                  {/* MODEL */}
                  <p style={{
                    fontSize:    '42px',
                    fontWeight:  '800',
                    lineHeight:  '1',
                    letterSpacing: '-0.01em',
                    wordBreak:   'break-word',
                    ...mono,
                  }}>
                    {modelStr}
                  </p>

                  {/* Divider */}
                  <div style={{ borderTop: '2px solid #000000', margin: '2px 0' }} />

                  {/* Specs */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    {storageStr && (
                      <p style={{ fontSize: '35px', fontWeight: '700', lineHeight: '1.1', ...mono }}>
                        {storageStr}
                      </p>
                    )}
                    {(ramStr || battStr) && (
                      <p style={{ fontSize: '35px', fontWeight: '700', lineHeight: '1.1', ...mono }}>
                        {[ramStr, battStr].filter(Boolean).join(' / ')}
                      </p>
                    )}
                    {!storageStr && !ramStr && !battStr && product.couleur && (
                      <p style={{ fontSize: '35px', fontWeight: '700', lineHeight: '1.1', ...mono }}>
                        {product.couleur.toUpperCase()}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── IMEI footer — full width ─────────────── */}
              <div style={{
                height:         `${IMEI_H}px`,
                flexShrink:     0,
                borderTop:      '2px solid #000000',
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                padding:        '0 12px',
              }}>
                <p style={{
                  fontSize:      '26px',
                  fontWeight:    '700',
                  letterSpacing: '0.04em',
                  fontFamily:    'monospace',
                  color:         '#000000',
                  textAlign:     'center',
                }}>
                  {product.imei || product.id}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Format note */}
        <p className="text-xs text-[#B0ADA6] text-center">
          {isAr ? 'حجم الملصق: 40 × 30 ملم — متوافق مع Phomemo' : 'Format: 40×30 mm — Compatible Phomemo'}
        </p>

        {/* Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'PNG',                         fn: handleDownloadPNG, icon: <Download className="w-5 h-5 text-[#6B6860]" /> },
            { label: 'PDF',                         fn: handleDownloadPDF, icon: <Download className="w-5 h-5 text-[#6B6860]" /> },
            { label: isAr ? 'مشاركة' : 'Partager', fn: handleShare,       icon: <Share2 className="w-5 h-5 text-[#6B6860]" /> },
            { label: isAr ? 'طباعة' : 'Imprimer',  fn: handlePrint,       icon: <Printer className="w-5 h-5 text-[#6B6860]" /> },
          ].map(({ label, fn, icon }) => (
            <button key={label} onClick={fn} disabled={exporting}
              className="flex flex-col items-center gap-2 p-3 rounded-xl border border-[#E8E5DE] bg-white hover:bg-[#F8F7F4] transition-all disabled:opacity-50">
              {exporting ? <Loader2 className="w-5 h-5 animate-spin text-[#6B6860]" /> : icon}
              <span className="text-xs text-[#6B6860] font-medium">{label}</span>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <Btn variant="secondary" onClick={onClose}>{isAr ? 'إغلاق' : 'Fermer'}</Btn>
        </div>
      </div>
    </Modal>
  )
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}