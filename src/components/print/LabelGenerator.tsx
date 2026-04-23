'use client'
import { useRef, useState } from 'react'
import { usePortal } from '@/lib/context/portal'
import { useLanguageStore } from '@/lib/stores/language'
import { Modal, Btn } from '@/components/shared'
import { Download, Share2, Printer, X, Loader2 } from 'lucide-react'
import dynamic from 'next/dynamic'

// QR code — lazy loaded, no SSR
const QRCode = dynamic(() => import('qrcode').then(m => ({
  default: ({ value, size }: { value: string; size: number }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [ready, setReady] = useState(false)
    // Draw QR on mount
    if (typeof window !== 'undefined' && canvasRef.current && !ready) {
      m.toCanvas(canvasRef.current, value, { width: size, margin: 1 })
        .then(() => setReady(true))
        .catch(() => {})
    }
    return <canvas ref={canvasRef} width={size} height={size} />
  },
})), { ssr: false })

export interface LabelProduct {
  id:         string   // PHO-0001, LAP-0001, EZ-ACC-000001
  name:       string   // Full display name e.g. "Apple iPhone 15 Pro 256GB"
  category:   string   // Téléphone / Laptop / Accessoire
  type?:      string   // Neuf / Occasion / Défectueux
  prix?:      number   // Selling price (optional — shown if provided)
  barcode?:   string   // Barcode/IMEI if available
}

interface LabelGeneratorProps {
  product:  LabelProduct
  open:     boolean
  onClose:  () => void
}

// Label dimensions: 4in × 3in at 96dpi = 384 × 288px
const W = 384
const H = 288

export default function LabelGenerator({ product, open, onClose }: LabelGeneratorProps) {
  const portal   = usePortal()
  const { language } = useLanguageStore()
  const isAr     = language === 'ar'
  const labelRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)

  const primary  = portal.primaryColor
  const siteName = portal.storeName

  async function exportPNG(): Promise<Blob | null> {
    if (!labelRef.current) return null
    setExporting(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(labelRef.current, {
        scale:           2,
        useCORS:         true,
        backgroundColor: '#FFFFFF',
        width:           W,
        height:          H,
      })
      return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    } finally {
      setExporting(false)
    }
  }

  async function handleDownloadPNG() {
    const blob = await exportPNG()
    if (!blob) return
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `label-${product.id}.png`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleDownloadPDF() {
    const blob = await exportPNG()
    if (!blob) return
    setExporting(true)
    try {
      const { jsPDF } = await import('jspdf')
      // 4×3 inches
      const pdf  = new jsPDF({ orientation: 'landscape', unit: 'in', format: [4, 3] })
      const imgData = await blobToDataURL(blob)
      pdf.addImage(imgData, 'PNG', 0, 0, 4, 3)
      pdf.save(`label-${product.id}.pdf`)
    } finally {
      setExporting(false)
    }
  }

  async function handleShare() {
    const blob = await exportPNG()
    if (!blob) return
    const file = new File([blob], `label-${product.id}.png`, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: product.name })
      } catch {
        // User cancelled — ignore
      }
    } else {
      // Fallback: download
      handleDownloadPNG()
    }
  }

  async function handlePrint() {
    const blob = await exportPNG()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const win = window.open(url, '_blank')
    win?.addEventListener('load', () => { win.print(); URL.revokeObjectURL(url) })
  }

  return (
    <Modal open={open} onClose={onClose}
      title={isAr ? 'مولد الملصقات' : 'Générateur d\'étiquette'}
      size="md">
      <div className="space-y-5">

        {/* Label preview */}
        <div className="flex justify-center">
          <div
            ref={labelRef}
            style={{
              width:           `${W}px`,
              height:          `${H}px`,
              backgroundColor: '#FFFFFF',
              border:          '1px solid #E8E5DE',
              borderRadius:    '8px',
              padding:         '16px',
              display:         'flex',
              flexDirection:   'row',
              gap:             '12px',
              fontFamily:      "'Barlow Condensed', Arial, sans-serif",
              overflow:        'hidden',
              flexShrink:      0,
            }}
          >
            {/* Left: QR + ID */}
            <div style={{
              display:        'flex',
              flexDirection:  'column',
              alignItems:     'center',
              justifyContent: 'center',
              gap:            '6px',
              flexShrink:     0,
            }}>
              <QRCode value={product.id} size={100} />
              <p style={{
                fontSize:    '8px',
                color:       '#6B6860',
                fontFamily:  'monospace',
                textAlign:   'center',
                wordBreak:   'break-all',
                maxWidth:    '104px',
              }}>
                {product.id}
              </p>
            </div>

            {/* Right: Info */}
            <div style={{
              flex:           1,
              display:        'flex',
              flexDirection:  'column',
              justifyContent: 'space-between',
              minWidth:       0,
            }}>
              {/* Store name */}
              <p style={{
                fontSize:      '10px',
                fontWeight:    'bold',
                color:         primary,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}>
                {siteName}
              </p>

              {/* Product name */}
              <div>
                <p style={{
                  fontSize:    '18px',
                  fontWeight:  'bold',
                  color:       '#1A1A1A',
                  lineHeight:  '1.1',
                  marginBottom: '4px',
                }}>
                  {product.name}
                </p>

                {/* Category + type */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize:        '9px',
                    fontWeight:      'bold',
                    color:           primary,
                    backgroundColor: `${primary}15`,
                    padding:         '2px 6px',
                    borderRadius:    '4px',
                    border:          `1px solid ${primary}30`,
                  }}>
                    {product.category}
                  </span>
                  {product.type && (
                    <span style={{
                      fontSize:        '9px',
                      color:           '#6B6860',
                      backgroundColor: '#F8F7F4',
                      padding:         '2px 6px',
                      borderRadius:    '4px',
                      border:          '1px solid #E8E5DE',
                    }}>
                      {product.type}
                    </span>
                  )}
                </div>
              </div>

              {/* Barcode / IMEI */}
              {product.barcode && (
                <p style={{
                  fontSize:   '9px',
                  color:      '#6B6860',
                  fontFamily: 'monospace',
                  marginTop:  '2px',
                }}>
                  {product.barcode}
                </p>
              )}

              {/* Price */}
              {product.prix != null && (
                <div style={{
                  borderTop:  `2px solid ${primary}`,
                  paddingTop: '6px',
                  marginTop:  '4px',
                }}>
                  <p style={{
                    fontSize:   '22px',
                    fontWeight: 'bold',
                    color:      primary,
                    lineHeight: '1',
                  }}>
                    {new Intl.NumberFormat('fr-MA', {
                      style:                 'currency',
                      currency:              'MAD',
                      minimumFractionDigits: 0,
                    }).format(product.prix)}
                  </p>
                </div>
              )}

              {/* Bottom: date */}
              <p style={{
                fontSize:  '8px',
                color:     '#B0ADA6',
                marginTop: 'auto',
              }}>
                {new Date().toLocaleDateString('fr-FR')}
              </p>
            </div>
          </div>
        </div>

        {/* Phomemo size note */}
        <p className="text-xs text-[#B0ADA6] text-center">
          {isAr ? 'حجم الملصق: 4 × 3 بوصة — متوافق مع Phomemo' : 'Format: 4×3 pouces — Compatible Phomemo'}
        </p>

        {/* Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={handleDownloadPNG}
            disabled={exporting}
            className="flex flex-col items-center gap-2 p-3 rounded-xl border border-[#E8E5DE] bg-white hover:bg-[#F8F7F4] transition-all disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-5 h-5 animate-spin text-[#6B6860]" />
                       : <Download className="w-5 h-5 text-[#6B6860]" />}
            <span className="text-xs text-[#6B6860] font-medium">PNG</span>
          </button>

          <button
            onClick={handleDownloadPDF}
            disabled={exporting}
            className="flex flex-col items-center gap-2 p-3 rounded-xl border border-[#E8E5DE] bg-white hover:bg-[#F8F7F4] transition-all disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-5 h-5 animate-spin text-[#6B6860]" />
                       : <Download className="w-5 h-5 text-[#6B6860]" />}
            <span className="text-xs text-[#6B6860] font-medium">PDF</span>
          </button>

          <button
            onClick={handleShare}
            disabled={exporting}
            className="flex flex-col items-center gap-2 p-3 rounded-xl border border-[#E8E5DE] bg-white hover:bg-[#F8F7F4] transition-all disabled:opacity-50"
          >
            <Share2 className="w-5 h-5 text-[#6B6860]" />
            <span className="text-xs text-[#6B6860] font-medium">
              {isAr ? 'مشاركة' : 'Partager'}
            </span>
          </button>

          <button
            onClick={handlePrint}
            disabled={exporting}
            className="flex flex-col items-center gap-2 p-3 rounded-xl border border-[#E8E5DE] bg-white hover:bg-[#F8F7F4] transition-all disabled:opacity-50"
          >
            <Printer className="w-5 h-5 text-[#6B6860]" />
            <span className="text-xs text-[#6B6860] font-medium">
              {isAr ? 'طباعة' : 'Imprimer'}
            </span>
          </button>
        </div>

        <div className="flex justify-end">
          <Btn variant="secondary" onClick={onClose}>
            {isAr ? 'إغلاق' : 'Fermer'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// Helper
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}