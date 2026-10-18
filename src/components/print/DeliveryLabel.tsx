'use client'
// The parcel's label (40 × 30 mm, Phomemo), for the delivery agent: who and
// where, the number to call, and what to collect at the door — in big black
// on white. Drawing and exports: components/print/LabelCanvas.
import { usePortal } from '@/lib/context/portal'
import { LabelModal, startLabel, finishLabel, fitSize, twoLines, drawLogo, LOGO_W, LOGO_H, W, H, CAP } from '@/components/print/LabelCanvas'

export interface ParcelInfo {
  delivery_id:    string
  client_name:    string
  client_phone:   string
  client_address: string
  ville?:         string | null
  aEncaisser:     number          // collected at the door (rest + fee paid by the client)
  contenu:        string[]        // what the parcel holds, in words
}

const M = 16

// "0661234567" → "06 61 23 45 67"
const spaced = (tel: string) => {
  const d = tel.replace(/\D/g, '')
  return d.length === 10 ? d.replace(/(\d{2})(?=\d)/g, '$1 ').trim() : tel
}
const dh = (n: number) => `${Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ')} DH`

async function drawParcel(canvas: HTMLCanvasElement, p: ParcelInfo, ez: boolean) {
  const { ctx, family } = await startLabel(canvas)
  const inner = W - 2 * M

  // ── Top: the mark, the order number, FRAGILE ──
  const headH = 46
  let x = M
  if (ez) {
    const logoW = (headH * LOGO_W) / LOGO_H
    drawLogo(ctx, x, M, logoW)
    x += logoW + 12
  }
  ctx.font = `700 22px ${family}`
  const fragW = ctx.measureText('FRAGILE').width + 18
  ctx.fillRect(W - M - fragW, M + 6, fragW, headH - 12)
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.fillText('FRAGILE', W - M - fragW / 2, M + headH / 2 + (22 * CAP) / 2)
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'left'
  const idSize = fitSize(ctx, p.delivery_id, family, 40, 18, W - M - fragW - 10 - x)
  ctx.fillText(p.delivery_id, x, M + headH / 2 + (idSize * CAP) / 2)
  ctx.fillRect(M, M + headH + 6, inner, 3)

  // ── Bottom: what the agent collects ──
  const boxH = 56
  const boxTop = H - M - boxH
  ctx.fillRect(M, boxTop, inner, boxH)
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  const cod = p.aEncaisser > 0 ? `À ENCAISSER : ${dh(p.aEncaisser)}` : 'PAYÉ — RIEN À ENCAISSER'
  const codSize = fitSize(ctx, cod, family, 40, 18, inner - 20)
  ctx.fillText(cod, W / 2, boxTop + boxH / 2 + (codSize * CAP) / 2)
  ctx.fillStyle = '#000000'

  // ── Middle: who, where, what ──
  const top0 = M + headH + 18, bottom0 = boxTop - 10
  type Line = { text: string; max: number; min: number }
  const address = p.client_address.trim()
  ctx.font = `700 28px ${family}`
  const addrLines = ctx.measureText(address).width > inner * 1.3 ? (twoLines(ctx, address) ?? [address]) : [address]
  const lines: Line[] = [
    { text: p.client_name, max: 40, min: 20 },
    { text: spaced(p.client_phone), max: 40, min: 22 },
    ...addrLines.map(a => ({ text: a, max: 28, min: 16 })),
    ...(p.ville ? [{ text: p.ville.toUpperCase(), max: 32, min: 18 }] : []),
    ...(p.contenu.length ? [{ text: `Contenu : ${p.contenu.join(', ')}`, max: 20, min: 13 }] : []),
  ]
  const sized = lines.map(l => ({ ...l, size: fitSize(ctx, l.text, family, l.max, l.min, inner) }))
  // A line's height leaves room under it for q, p, j (names and addresses are lowercase)
  const LINE = 0.98, GAP = 6
  // Too tall: the contents go first, then everything shrinks a little
  const height = (ls: typeof sized) => ls.reduce((s, l) => s + l.size * LINE, 0) + (ls.length - 1) * GAP
  let rows = sized
  if (height(rows) > bottom0 - top0 && p.contenu.length) rows = rows.slice(0, -1)
  const k = Math.min(1, (bottom0 - top0) / height(rows))
  // what is left over spreads between the lines, a little at most
  const gap = Math.min(GAP + Math.max((bottom0 - top0) - height(rows) * k, 0) / Math.max(rows.length - 1, 1), 14)
  let y = top0
  ctx.textAlign = 'left'
  for (const l of rows) {
    const size = Math.floor(l.size * k)
    ctx.font = `700 ${size}px ${family}`
    ctx.fillText(l.text, M, y + size * CAP)
    y += size * LINE + gap
  }

  finishLabel(ctx)
}

export default function DeliveryLabel({ parcel, open, onClose }: { parcel: ParcelInfo; open: boolean; onClose: () => void }) {
  const ez = usePortal().type === 'ez'
  return (
    <LabelModal open={open} onClose={onClose} title="Étiquette de livraison"
      fileName={`livraison-${parcel.delivery_id}`} shareTitle={parcel.delivery_id}
      draw={canvas => drawParcel(canvas, parcel, ez)} deps={[parcel, ez]} />
  )
}
