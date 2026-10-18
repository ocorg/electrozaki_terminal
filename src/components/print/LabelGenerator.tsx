'use client'
import { usePortal } from '@/lib/context/portal'
import { useLanguageStore } from '@/lib/stores/language'
import { LabelModal, startLabel, finishLabel, fitSize, twoLines, drawQR, drawLogo, LOGO_W, LOGO_H, W, H, CAP } from '@/components/print/LabelCanvas'

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

// Layout = the shop's label model: QR code top left, logo under it, and on
// the right the brand, model, storage and battery, centred. Black on white,
// no frame (drawing and exports: components/print/LabelCanvas).
const M      = 16          // outer margin
const LEFT   = 178         // width of the QR / logo column (126 dots: 6 per module of a 21-module code)
const TEXT_X = M + LEFT + 12
const TEXT_W = W - M - TEXT_X

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

async function drawLabel(canvas: HTMLCanvasElement, product: LabelProduct, portal: { type: string; storeName: string }) {
  const { ctx, family } = await startLabel(canvas)
  const { lines, code, parts } = labelText(product)

  // ── Left column: QR code, then the replaced parts, then the logo ──
  const qrSize = await drawQR(ctx, code, M, M, LEFT)
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

  finishLabel(ctx)
}

export default function LabelGenerator({ product, open, onClose }: LabelGeneratorProps) {
  const portal       = usePortal()
  const { language } = useLanguageStore()
  return (
    <LabelModal open={open} onClose={onClose}
      title={language === 'ar' ? 'مولد الملصقات' : "Générateur d'étiquette"}
      fileName={`label-${product.id}`} shareTitle={product.name}
      draw={canvas => drawLabel(canvas, product, portal)} deps={[product, portal]} />
  )
}
