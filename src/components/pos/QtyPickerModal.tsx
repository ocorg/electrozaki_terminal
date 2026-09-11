'use client'
import { Minus, Plus, Package } from 'lucide-react'
import { formatMAD } from '@/lib/utils'

interface DeviceSnap {
  _id:          string
  _displayName: string
  price:        number
}

interface Props {
  device:       DeviceSnap | null
  qty:          number
  onQtyChange:  (qty: number) => void
  onConfirm:    () => void
  onClose:      () => void
  primary:      string
  isAr:         boolean
}

export default function QtyPickerModal({ device, qty, onQtyChange, onConfirm, onClose, primary, isAr }: Props) {
  if (!device) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 text-center">
        <Package className="w-8 h-8 mx-auto mb-3" style={{ color: primary }} />
        <p className="text-sm font-bold text-[#1A1A1A] mb-1 leading-snug line-clamp-2">{device._displayName}</p>
        <p className="text-xs text-[#B0ADA6] mb-5">
          {formatMAD(device.price)} / {isAr ? 'وحدة' : 'unité'}
        </p>
        <div className="flex items-center justify-center gap-6 mb-6">
          <button type="button" onClick={() => onQtyChange(Math.max(1, qty - 1))}
            className="w-11 h-11 rounded-xl border-2 border-[#E8E5DE] flex items-center justify-center text-[#6B6860] hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-all">
            <Minus className="w-4 h-4" />
          </button>
          <span className="text-3xl font-bold text-[#1A1A1A] tabular-nums w-12 text-center">{qty}</span>
          <button type="button" onClick={() => onQtyChange(qty + 1)}
            className="w-11 h-11 rounded-xl border-2 border-[#E8E5DE] flex items-center justify-center text-[#6B6860] transition-all"
            onMouseEnter={e => { e.currentTarget.style.borderColor = primary; e.currentTarget.style.color = primary }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#E8E5DE'; e.currentTarget.style.color = '#6B6860' }}>
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-[#E8E5DE] text-[#6B6860] hover:bg-[#F8F7F4] transition-all">
            {isAr ? 'إلغاء' : 'Annuler'}
          </button>
          <button type="button" onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
            style={{ backgroundColor: primary }}>
            {isAr ? `إضافة ${qty}` : `Ajouter × ${qty}`}
          </button>
        </div>
      </div>
    </div>
  )
}