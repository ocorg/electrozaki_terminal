'use client'
import { useState } from 'react'
import { ScanLine } from 'lucide-react'
import dynamic from 'next/dynamic'
import { playScanSound, type ScanSound } from '@/lib/scanSound'

// Lazy-load scanner to avoid SSR issues with camera APIs
const Scanner = dynamic(() => import('./Scanner'), { ssr: false })

interface ScanButtonProps {
  onScan:  (value: string) => void
  hint?:   string
  mode?:   'barcode' | 'qr'
  size?:   'sm' | 'md'
  color?:  string
  /** the module's own beep, so staff hear the scan read (owner, 2026-11-06) */
  sound?:  ScanSound
}

export default function ScanButton({ onScan, hint, mode, size = 'md', color = '#C9A440', sound = 'phones' }: ScanButtonProps) {
  const [open, setOpen] = useState(false)

  function handleResult(value: string) {
    playScanSound(sound)
    setOpen(false)
    onScan(value)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center justify-center rounded-xl transition-all hover:opacity-80 active:scale-95 flex-shrink-0"
        style={{
          width:           size === 'sm' ? '32px' : '40px',
          height:          size === 'sm' ? '32px' : '40px',
          backgroundColor: `${color}18`,
          border:          `1px solid ${color}30`,
        }}
        title="Scanner un code-barres"
      >
        <ScanLine
          className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'}
          style={{ color }}
        />
      </button>

      {open && (
        <Scanner
          onResult={handleResult}
          onClose={() => setOpen(false)}
          hint={hint}
          mode={mode}
        />
      )}
    </>
  )
}