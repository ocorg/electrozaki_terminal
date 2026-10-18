'use client'
// Shared base of the 40 × 30 mm labels (phone / accessory labels, delivery
// labels). A label is drawn straight on a canvas: the preview and every
// export (PNG, PDF, share, print) are the same drawing, so they cannot differ.
//
// A label printer (Phomemo: 203 dpi) prints the label as 320 × 240 dots, in
// pure black or white. The image is 3 pixels per dot (960 × 720), QR modules
// are whole dots and no pixel is grey, so the printing app has nothing to blur
// or to dither. Drawing happens on a 452 × 339 grid (exactly 4:3).
import { useEffect, useRef, useState } from 'react'
import { useLanguageStore } from '@/lib/stores/language'
import { t } from '@/lib/i18n/t'
import { Modal, Btn } from '@/components/shared'
import { showError } from '@/lib/utils/toasts'
import { Download, FileText, Share2, Printer, Loader2 } from 'lucide-react'

export const W    = 452
export const H    = 339
export const W_MM = 40
export const H_MM = 30
const DOTS_W = 320
const DOTS_H = 240
const PX_PER_DOT = 3
export const PX_W = DOTS_W * PX_PER_DOT
export const PX_H = DOTS_H * PX_PER_DOT
const DOT = W / DOTS_W     // one printer dot, on the drawing grid
export const CAP = 0.73    // height of capitals and digits, as a share of the font size

/** A white label, ready to draw on the 452 × 339 grid, in the ERP's font. */
export async function startLabel(canvas: HTMLCanvasElement) {
  const family = `${getComputedStyle(document.body).fontFamily || 'Arial'}, Arial, sans-serif`
  // Without the font the text would be measured with one face and drawn with another
  try { await document.fonts.load(`700 40px ${family}`) } catch {}
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
  return { ctx, family }
}

/** Pure black and white: the smoothed edges of the letters become one or the other. */
export function finishLabel(ctx: CanvasRenderingContext2D) {
  const img = ctx.getImageData(0, 0, PX_W, PX_H)
  const px  = img.data
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 < 140 ? 0 : 255
    px[i] = px[i + 1] = px[i + 2] = v
    px[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

/** Largest font size (from `max` down to `min`) at which the text fits the width. */
export function fitSize(ctx: CanvasRenderingContext2D, text: string, family: string, max: number, min: number, width: number) {
  let size = max
  for (; size > min; size -= 1) {
    ctx.font = `700 ${size}px ${family}`
    if (ctx.measureText(text).width <= width) break
  }
  ctx.font = `700 ${size}px ${family}`
  return size
}

/** Best split of a text in two lines (the shortest longest line). */
export function twoLines(ctx: CanvasRenderingContext2D, text: string): [string, string] | null {
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

/**
 * A QR code within a `room` wide square at (x, y): whole printer dots per
 * module, placed on the dot grid, so its edges stay sharp once printed.
 * Returns its size on the drawing grid.
 */
export async function drawQR(ctx: CanvasRenderingContext2D, code: string, x: number, y: number, room: number) {
  const QR = await import('qrcode')
  const qr = QR.create(code, { errorCorrectionLevel: 'M' })
  const n  = qr.modules.size
  const cellDots = Math.max(1, Math.floor(room / DOT / n))
  const size     = cellDots * n * DOT
  const leftDot  = Math.round((x + (room - size) / 2) / DOT)
  const topDot   = Math.round(y / DOT)
  const cellPx   = cellDots * PX_PER_DOT
  ctx.save()
  ctx.resetTransform()
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.modules.get(r, c)) ctx.fillRect(leftDot * PX_PER_DOT + c * cellPx, topDot * PX_PER_DOT + r * cellPx, cellPx, cellPx)
  }
  ctx.restore()
  return size
}

// The EZ mark, traced from the shop's logo: a solid E and an outlined Z, as
// on the shop's labels (a thermal printer has no gold). Points on a 708 × 427 grid.
export const LOGO_W = 708
export const LOGO_H = 427
const LOGO_E: [number, number][][] = [
  [[125, 0], [405, 0], [372, 112], [82, 112]],
  [[125, 157], [385, 157], [335, 263], [215, 263], [198, 315], [322, 315], [232, 427], [0, 427]],
]
const LOGO_Z: [number, number][] = [[405, 0], [708, 0], [477, 315], [625, 315], [587, 427], [232, 427], [475, 112], [372, 112]]

export function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  const k = width / LOGO_W
  const trace = (pts: [number, number][]) => {
    ctx.beginPath()
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * k, y + py * k) : ctx.moveTo(x + px * k, y + py * k)))
    ctx.closePath()
  }
  for (const part of LOGO_E) { trace(part); ctx.fill() }
  ctx.lineWidth = Math.max(1.5, 3 * (width / 150))
  ctx.lineJoin  = 'miter'
  trace(LOGO_Z); ctx.stroke()
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

type Action = 'png' | 'pdf' | 'share' | 'print'

/** The label window: the preview (the exact exported image) and its four exports. */
export function LabelModal({ open, onClose, title, fileName, shareTitle, draw, deps }: {
  open: boolean; onClose: () => void; title: string; fileName: string; shareTitle: string
  draw: (canvas: HTMLCanvasElement) => Promise<void>
  deps: unknown[]   // what the drawing depends on: redrawn when it changes
}) {
  const { language } = useLanguageStore()
  const isAr         = language === 'ar'
  const previewRef   = useRef<HTMLCanvasElement>(null)
  const [busy, setBusy] = useState<Action | null>(null)

  useEffect(() => {
    if (!open || !previewRef.current) return
    draw(previewRef.current).catch(() => {})
  }, [open, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps

  async function render() {
    const canvas = document.createElement('canvas')
    await draw(canvas)
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
    try { await navigator.share({ files: [file], title: shareTitle }) }
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
    <Modal open={open} onClose={onClose} title={title} size="md">
      <div className="space-y-5">
        <div className="flex justify-center">
          <canvas ref={previewRef} width={PX_W} height={PX_H}
            className="w-full max-w-[326px] h-auto rounded-md shadow-[0_0_0_1px_#E8E5DE]"
            style={{ aspectRatio: `${W} / ${H}` }} />
        </div>
        <p className="text-xs text-[#B0ADA6] text-center">
          {isAr ? 'حجم الملصق: 40 × 30 ملم — متوافق مع Phomemo' : 'Format: 40×30 mm — Compatible Phomemo'}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {actions.map(({ key, label, fn, Icon }) => (
            <button key={key} onClick={() => run(key, fn)} disabled={busy !== null}
              className="flex flex-col items-center gap-2 p-3 rounded-xl border border-[#E8E5DE] bg-white hover:bg-[#F8F7F4] transition-all disabled:opacity-50">
              {busy === key ? <Loader2 className="w-5 h-5 animate-spin text-[#6B6860]" /> : <Icon className="w-5 h-5 text-[#6B6860]" />}
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
