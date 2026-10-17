'use client'
import { useRef, useState, useEffect } from 'react'
import { usePortal } from '@/lib/context/portal'
import { useLanguageStore } from '@/lib/stores/language'
import { t } from '@/lib/i18n/t'
import { Modal, Btn } from '@/components/shared'
import { showError } from '@/lib/utils/toasts'
import { Download, FileText, Share2, Printer, Loader2 } from 'lucide-react'

export interface LabelProduct {
  id:             string
  name:           string   // full display name (fallback)
  marque?:        string   // brand only  e.g. "Apple"
  model?:         string   // model only  e.g. "16 Pro"
  variante?:      string   // "Normal", "Pro"… printed after the model when it is not already in it
  category:       string
  type?:          string
  imei?:          string
  barcode?:       string   // accessories: the code the POS finds them by
  pieces?:        { name: string; condition: string }[]   // replaced parts, printed as codes (CO, B…)
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

// The label is drawn straight on a canvas: the preview and every export
// (PNG, PDF, share, print) are the same drawing, so they cannot differ.
// Layout = the shop's label model: QR code top left, logo under it, and on
// the right the brand, model, storage and battery, centred. Black on white,
// no frame. 40mm × 30mm, drawn on a 452 × 339 grid.
//
// A label printer (Phomemo: 203 dpi) prints this label as 320 × 240 dots, in
// pure black or white. The image is 3 pixels per dot (960 × 720), every QR
// module is a whole number of dots and no pixel is grey, so the printing app
// has nothing to blur or to dither.
const W    = 452
const H    = 339
const W_MM = 40
const H_MM = 30
const DOTS_W = 320
const DOTS_H = 240
const PX_PER_DOT = 3
const PX_W = DOTS_W * PX_PER_DOT
const PX_H = DOTS_H * PX_PER_DOT
const DOT  = W / DOTS_W    // one printer dot, on the drawing grid

const M      = 16          // outer margin
const LEFT   = 178         // width of the QR / logo column (126 dots: 6 per module of a 21-module code)
const TEXT_X = M + LEFT + 12
const TEXT_W = W - M - TEXT_X
const CAP    = 0.73        // height of capitals and digits, as a share of the font size

type Action = 'png' | 'pdf' | 'share' | 'print'

// "128", "128GB", "128 go" → "128 GB"
function withUnit(val: string | undefined | null): string | null {
  const v = val?.trim().toUpperCase()
  if (!v) return null
  const m = v.match(/^(\d+(?:[.,]\d+)?)\s*(GB|TB|MB|GO|TO)?$/)
  return m ? `${m[1]} ${(m[2] ?? 'GB').replace('GO', 'GB').replace('TO', 'TB')}` : v
}

/** The lines of the label, top to bottom, with their largest font size. */
function labelText(product: LabelProduct) {
  const marque = (product.marque || product.name.split(' ')[0] || '').trim()
  // "Samsung Galaxy A16 128GB" → "Galaxy A16": the brand and storage have their own lines
  let model = (product.model ?? product.name.split(' ').slice(1).join(' '))
    .replace(/\s*\d+\s*(GB|TB)\s*$/i, '').trim()
  if (marque && model.toLowerCase().startsWith(marque.toLowerCase() + ' ')) model = model.slice(marque.length).trim()
  const variante = product.variante?.trim()
  if (model && variante && !model.toLowerCase().includes(variante.toLowerCase())) model = `${model} ${variante}`

  const storage = withUnit(product.stockage)
  const ram     = withUnit(product.ram)
  const battery = product.battery_level != null ? `${product.battery_level}%` : null

  const lines: { text: string; size: number; wrap?: boolean }[] = []
  if (marque)  lines.push({ text: marque.toUpperCase(), size: 62 })
  if (model)   lines.push({ text: model, size: 46, wrap: true })
  if (storage) lines.push({ text: storage, size: 48 })
  if (ram)     lines.push({ text: `RAM ${ram}`, size: 42 })
  if (battery) lines.push({ text: battery, size: 52 })
  if (lines.length <= 2 && product.couleur) lines.push({ text: product.couleur, size: 42 })

  return { lines, code: product.imei || product.barcode || product.id, parts: partCodes(product.pieces) }
}

// Replaced parts, in the shop's shorthand (owner, 2026-10-13): the letter of
// the part, plus "O" when the new part is original — "CO" = caméra originale,
// "B" = batterie standard. Both cameras share the letter C.
const PART_LETTERS: Record<string, string> = {
  'ecran': 'E', 'batterie': 'B', 'camera arriere': 'C', 'camera avant': 'C', 'vitre arriere': 'V',
  'chassis': 'CH', 'haut-parleur': 'HP', 'connecteur de charge': 'CC', 'assemblage carte logique': 'CL',
  'camera truedepth': 'TD',
}
function partCodes(pieces: LabelProduct['pieces']): string {
  const codes = (pieces ?? []).filter(p => p?.name).map(p => {
    const key = p.name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
    return (PART_LETTERS[key] ?? key.charAt(0).toUpperCase()) + (p.condition === 'original' ? 'O' : '')
  })
  return Array.from(new Set(codes)).join(' ')
}

/** Largest font size (from `max` down to `min`) at which the text fits the width. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, family: string, max: number, min: number, width: number) {
  let size = max
  for (; size > min; size -= 1) {
    ctx.font = `700 ${size}px ${family}`
    if (ctx.measureText(text).width <= width) break
  }
  ctx.font = `700 ${size}px ${family}`
  return size
}

/** Best split of a text in two lines (the shortest longest line). */
function twoLines(ctx: CanvasRenderingContext2D, text: string): [string, string] | null {
  const words = text.split(/\s+/)
  if (words.length < 2) return null
  let best: [string, string] | null = null
  let bestW = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ')
    const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width)
    if (w < bestW) { bestW = w; best = [a, b] }
  }
  return best
}

// The EZ mark, traced from the shop's logo: a solid E and an outlined Z, as
// on the shop's labels (a thermal printer has no gold). Points on a 708 × 427 grid.
const LOGO_W = 708
const LOGO_H = 427
const LOGO_E: [number, number][][] = [
  [[125, 0], [405, 0], [372, 112], [82, 112]],
  [[125, 157], [385, 157], [335, 263], [215, 263], [198, 315], [322, 315], [232, 427], [0, 427]],
]
const LOGO_Z: [number, number][] = [[405, 0], [708, 0], [477, 315], [625, 315], [587, 427], [232, 427], [475, 112], [372, 112]]

function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  const k = width / LOGO_W
  const trace = (pts: [number, number][]) => {
    ctx.beginPath()
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * k, y + py * k) : ctx.moveTo(x + px * k, y + py * k)))
    ctx.closePath()
  }
  for (const part of LOGO_E) { trace(part); ctx.fill() }
  ctx.lineWidth = 3
  ctx.lineJoin  = 'miter'
  trace(LOGO_Z); ctx.stroke()
}

async function drawLabel(canvas: HTMLCanvasElement, product: LabelProduct, portal: { type: string; storeName: string }) {
  const QR = await import('qrcode')
  const family = `${getComputedStyle(document.body).fontFamily || 'Arial'}, Arial, sans-serif`
  // Without the font the text would be measured with one face and drawn with another
  try { await document.fonts.load(`700 40px ${family}`) } catch {}

  const { lines, code, parts } = labelText(product)
  canvas.width  = PX_W
  canvas.height = PX_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas')
  const scale = PX_W / W
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.direction    = 'ltr'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign    = 'center'

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = ctx.strokeStyle = '#000000'

  // ── Left column: QR code, then the logo ──
  const qr   = QR.create(code, { errorCorrectionLevel: 'M' })
  const n    = qr.modules.size
  // Whole printer dots per module, placed on the dot grid: sharp edges once printed
  const cellDots = Math.max(1, Math.floor(LEFT / DOT / n))
  const qrSize   = cellDots * n * DOT
  const leftDot  = Math.round((M + (LEFT - qrSize) / 2) / DOT)
  const topDot   = Math.round(M / DOT)
  const cellPx   = cellDots * PX_PER_DOT
  ctx.save()
  ctx.resetTransform()
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.modules.get(r, c)) ctx.fillRect(leftDot * PX_PER_DOT + c * cellPx, topDot * PX_PER_DOT + r * cellPx, cellPx, cellPx)
  }
  ctx.restore()

  // Replaced parts, between the QR code and the logo
  let boxTop = M + qrSize + 12
  if (parts) {
    ctx.font = `700 38px ${family}`
    // Many parts: two lines rather than letters too small to read
    const rows = (ctx.measureText(parts).width > LEFT * 1.5 && twoLines(ctx, parts)) || [parts]
    const size = Math.min(...rows.map(r => fitSize(ctx, r, family, 38, 16, LEFT)))
    ctx.font = `700 ${size}px ${family}`
    for (const r of rows) {
      ctx.fillText(r, M + LEFT / 2, boxTop + size * CAP)
      boxTop += size * CAP + 10
    }
  }
  const boxH = H - M - boxTop
  if (portal.type === 'ez') {
    const logoW = Math.min(LEFT - 16, (boxH * LOGO_W) / LOGO_H)
    drawLogo(ctx, M + (LEFT - logoW) / 2, boxTop + (boxH - (logoW * LOGO_H) / LOGO_W) / 2, logoW)
  } else {
    const name = portal.storeName.toUpperCase()
    const size = fitSize(ctx, name, family, 34, 14, LEFT)
    ctx.fillText(name, M + LEFT / 2, boxTop + boxH / 2 + (size * CAP) / 2)
  }

  // ── Right column: the lines, centred and spread over the height ──
  const cx = TEXT_X + TEXT_W / 2
  type Block = { h: number; draw: (top: number) => void }
  const blocks: Block[] = lines.map(l => {
    ctx.font = `700 ${l.size}px ${family}`
    // Two lines only when one line would need to shrink by more than a fifth
    const split = l.wrap && ctx.measureText(l.text).width > TEXT_W * 1.25 ? twoLines(ctx, l.text) : null
    if (split) {
      const size = Math.min(fitSize(ctx, split[0], family, l.size - 6, 18, TEXT_W), fitSize(ctx, split[1], family, l.size - 6, 18, TEXT_W))
      const step = size * CAP + 10
      return {
        h: size * CAP + step,
        draw: top => {
          ctx.font = `700 ${size}px ${family}`
          ctx.fillText(split[0], cx, top + size * CAP)
          ctx.fillText(split[1], cx, top + size * CAP + step)
        },
      }
    }
    const size = fitSize(ctx, l.text, family, l.size, 18, TEXT_W)
    return { h: size * CAP, draw: top => { ctx.font = `700 ${size}px ${family}`; ctx.fillText(l.text, cx, top + size * CAP) } }
  })
  const used = blocks.reduce((s, b) => s + b.h, 0)
  const gap  = Math.min((H - used) / (blocks.length + 1), 44)
  let top = (H - used - gap * (blocks.length - 1)) / 2
  for (const b of blocks) { b.draw(top); top += b.h + gap }

  // Pure black and white: the smoothed edges of the letters become one or the other
  const img = ctx.getImageData(0, 0, PX_W, PX_H)
  const px  = img.data
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 < 140 ? 0 : 255
    px[i] = px[i + 1] = px[i + 2] = v
    px[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

function saveAs(url: string, name: string) {
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Prints the image alone, on a page the size of the label. */
function printImage(dataUrl: string) {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.srcdoc = `<!doctype html><html><head><style>
    @page { size: ${W_MM}mm ${H_MM}mm; margin: 0 }
    html, body { margin: 0; padding: 0 }
    img { display: block; width: ${W_MM}mm; height: ${H_MM}mm }
  </style></head><body><img src="${dataUrl}"></body></html>`
  frame.onload = () => {
    const win = frame.contentWindow
    if (!win) return
    win.addEventListener('afterprint', () => frame.remove())
    win.focus()
    win.print()
  }
  document.body.appendChild(frame)
}

export default function LabelGenerator({ product, open, onClose }: LabelGeneratorProps) {
  const portal       = usePortal()
  const { language } = useLanguageStore()
  const isAr         = language === 'ar'
  const previewRef   = useRef<HTMLCanvasElement>(null)
  const [busy, setBusy] = useState<Action | null>(null)

  const fileName = `label-${product.id}`

  useEffect(() => {
    if (!open || !previewRef.current) return
    drawLabel(previewRef.current, product, portal).catch(() => {})
  }, [open, product, portal])

  // ── Export helpers ─────────────────────────────────────────
  async function render() {
    const canvas = document.createElement('canvas')
    await drawLabel(canvas, product, portal)
    return canvas
  }
  const toBlob = (canvas: HTMLCanvasElement) =>
    new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('png'))), 'image/png'))

  async function downloadPNG() {
    const url = URL.createObjectURL(await toBlob(await render()))
    saveAs(url, `${fileName}.png`)
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  async function downloadPDF() {
    const canvas = await render()
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [W_MM, H_MM] })
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, W_MM, H_MM)
    pdf.save(`${fileName}.pdf`)
  }

  async function share() {
    const file = new File([await toBlob(await render())], `${fileName}.png`, { type: 'image/png' })
    if (!navigator.canShare?.({ files: [file] })) return downloadPNG()
    try { await navigator.share({ files: [file], title: product.name }) }
    catch (e) { if ((e as Error).name !== 'AbortError') throw e }   // closing the share sheet is not an error
  }

  async function print() {
    printImage((await render()).toDataURL('image/png'))
  }

  async function run(action: Action, fn: () => Promise<void>) {
    if (busy) return
    setBusy(action)
    try { await fn() }
    catch { showError(isAr ? 'تعذر إنشاء الملصق' : "Impossible de générer l'étiquette") }
    finally { setBusy(null) }
  }

  const actions: { key: Action; label: string; fn: () => Promise<void>; Icon: typeof Download }[] = [
    { key: 'png',   label: 'PNG',                         fn: downloadPNG, Icon: Download },
    { key: 'pdf',   label: 'PDF',                         fn: downloadPDF, Icon: FileText },
    { key: 'share', label: isAr ? 'مشاركة' : 'Partager', fn: share,       Icon: Share2 },
    { key: 'print', label: isAr ? 'طباعة' : 'Imprimer',  fn: print,       Icon: Printer },
  ]

  return (
    <Modal open={open} onClose={onClose}
      title={isAr ? 'مولد الملصقات' : "Générateur d'étiquette"}
      size="md">
      <div className="space-y-5">

        {/* ── Label preview: the exact image that is exported ── */}
        <div className="flex justify-center">
          <canvas ref={previewRef} width={PX_W} height={PX_H}
            className="w-full max-w-[326px] h-auto rounded-md shadow-[0_0_0_1px_#E8E5DE]"
            style={{ aspectRatio: `${W} / ${H}` }} />
        </div>

        {/* Format note */}
        <p className="text-xs text-[#B0ADA6] text-center">
          {isAr ? 'حجم الملصق: 40 × 30 ملم — متوافق مع Phomemo' : 'Format: 40×30 mm — Compatible Phomemo'}
        </p>

        {/* Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {actions.map(({ key, label, fn, Icon }) => (
            <button key={key} onClick={() => run(key, fn)} disabled={busy !== null}
              className="flex flex-col items-center gap-2 p-3 rounded-xl border border-[#E8E5DE] bg-white hover:bg-[#F8F7F4] transition-all disabled:opacity-50">
              {busy === key
                ? <Loader2 className="w-5 h-5 animate-spin text-[#6B6860]" />
                : <Icon className="w-5 h-5 text-[#6B6860]" />}
              <span className="text-xs text-[#6B6860] font-medium">{label}</span>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <Btn variant="secondary" onClick={onClose}>{t(isAr, 'common.close')}</Btn>
        </div>
      </div>
    </Modal>
  )
}
