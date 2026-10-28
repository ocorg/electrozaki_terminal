'use client'
import { useEffect, useRef } from 'react'
import { Minus, Plus, Package, Smartphone } from 'lucide-react'
import { formatMAD } from '@/lib/utils'
import { Modal, Btn } from '@/components/shared'
import { t } from '@/lib/i18n/t'

// Adding an item to the POS cart (owner, 2026-10-28): the price is typed here,
// in a big box, right after the quantity — no more aiming at the small price
// field of the cart. Phones and laptops get the price only (one unit each).
interface DeviceSnap {
  _id:          string
  _displayName: string
  imei?:        string | null
  withQty:      boolean          // accessories: several units
  recommended:  number           // prix conseillé (0 = none, e.g. a service)
  minimum?:     number | null
  promoPrice?:  number | null    // suggested price after the item's promo
  inCart:       boolean
}

interface Props {
  device:        DeviceSnap | null
  qty:           number
  price:         string
  onQtyChange:   (qty: number) => void
  onPriceChange: (price: string) => void
  onConfirm:     () => void
  onClose:       () => void
  primary:       string
  isAr:          boolean
}

export default function QtyPickerModal({ device, qty, price, onQtyChange, onPriceChange, onConfirm, onClose, primary, isAr }: Props) {
  const priceRef = useRef<HTMLInputElement>(null)
  // Price box focused and selected ONCE, when the window opens for an item:
  // the first digit replaces the suggested price, the next ones add to it.
  // (Keyed on the item's id — the device object is rebuilt on every keystroke.)
  const openFor = device?._id ?? null
  useEffect(() => {
    if (!openFor) return
    const id = setTimeout(() => { priceRef.current?.focus(); priceRef.current?.select() }, 50)
    return () => clearTimeout(id)
  }, [openFor])

  if (!device) return null
  const unit   = Number(price) || 0
  const typed  = price.trim() !== '' && unit >= 0
  const below  = !!device.minimum && typed && unit < device.minimum
  const Icon   = device.withQty ? Package : Smartphone

  return (
    <Modal open={device != null} onClose={onClose} title={device.withQty ? 'Quantité et prix' : 'Prix de vente'} size="sm"
           closeLabel={t(isAr, 'common.close')}>
      <form className="text-center" onSubmit={e => { e.preventDefault(); onConfirm() }}>
        <Icon className="w-8 h-8 mx-auto mb-3" style={{ color: primary }} />
        <p className="text-sm font-bold text-ez-text mb-0.5 leading-snug line-clamp-2">{device._displayName}</p>
        {device.imei && <p className="text-xs text-ez-faint font-mono mb-1">{device.imei}</p>}
        <p className="text-xs text-ez-faint mb-4">
          {device.recommended > 0 ? `Prix conseillé ${formatMAD(device.recommended)}` : 'Pas de prix fixé : tapez le prix'}
          {device.minimum ? ` · minimum ${formatMAD(device.minimum)}` : ''}
        </p>

        {device.withQty && (
          <div className="flex items-center justify-center gap-4 mb-4">
            <button type="button" onClick={() => onQtyChange(Math.max(1, qty - 1))}
              aria-label={isAr ? 'إنقاص' : 'Diminuer'}
              className="w-11 h-11 rounded-xl border-2 border-ez-border flex items-center justify-center text-ez-subtle hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-all">
              <Minus className="w-4 h-4" />
            </button>
            <input type="number" min={1} step={1} inputMode="numeric" aria-label={t(isAr, 'common.quantity')}
              className="text-3xl font-bold text-ez-text tabular-nums w-20 text-center bg-transparent border-b-2 border-ez-border focus:outline-none"
              value={qty || ''} onChange={e => onQtyChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              onBlur={() => { if (qty < 1) onQtyChange(1) }} />
            <button type="button" onClick={() => onQtyChange(qty + 1)}
              aria-label={isAr ? 'زيادة' : 'Augmenter'}
              className="w-11 h-11 rounded-xl border-2 border-ez-border flex items-center justify-center text-ez-subtle transition-all"
              onMouseEnter={e => { e.currentTarget.style.borderColor = primary; e.currentTarget.style.color = primary }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#E8E5DE'; e.currentTarget.style.color = '#6B6860' }}>
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}

        <label className="block text-left text-xs font-bold text-ez-subtle uppercase tracking-widest mb-1.5">
          {device.withQty ? 'Prix de vente (par pièce)' : 'Prix de vente'}
        </label>
        <div className="relative mb-2">
          <input ref={priceRef} type="number" min={0} step={0.01} inputMode="decimal"
            className="w-full text-2xl font-bold text-center tabular-nums border-2 rounded-xl px-3 py-2.5 pr-14 bg-white focus:outline-none"
            style={{ borderColor: below ? '#F59E0B' : primary }}
            placeholder="0" value={price} onChange={e => onPriceChange(e.target.value)} />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-ez-faint">DH</span>
        </div>

        <div className="flex flex-wrap justify-center gap-1.5 mb-3">
          {device.recommended > 0 && unit !== device.recommended && (
            <button type="button" onClick={() => onPriceChange(String(device.recommended))}
              className="text-[11px] font-bold px-2 py-1 rounded-full border border-ez-border text-ez-subtle">
              Prix conseillé {formatMAD(device.recommended)}
            </button>
          )}
          {!!device.promoPrice && unit !== device.promoPrice && (
            <button type="button" onClick={() => onPriceChange(String(device.promoPrice))}
              className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ backgroundColor: '#FAF5E8', color: '#C9A440', border: '1px solid #E8D494' }}>
              Après promo {formatMAD(device.promoPrice)}
            </button>
          )}
        </div>

        {typed && unit === 0 && (
          <p className="text-xs font-bold text-emerald-700 mb-2">0 DH : article offert</p>
        )}
        {below && (
          <p className="text-xs font-bold text-amber-600 mb-2">En dessous du minimum ({formatMAD(device.minimum)})</p>
        )}
        {device.withQty && qty > 1 && unit > 0 && (
          <p className="text-sm text-ez-subtle mb-3">
            {qty} × {formatMAD(unit)} = <b className="text-ez-text">{formatMAD(qty * unit)}</b>
          </p>
        )}

        <div className="flex gap-2">
          <Btn type="button" variant="secondary" className="flex-1" onClick={onClose}>
            {t(isAr, 'common.cancel')}
          </Btn>
          <Btn type="submit" variant="primary" className="flex-1" style={{ backgroundColor: primary }} disabled={!typed || qty < 1}>
            {device.inCart ? 'Mettre à jour' : device.withQty ? `Ajouter × ${qty}` : 'Ajouter au panier'}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}
