'use client'
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X } from 'lucide-react'

interface ComboBoxProps {
  options:      string[]
  value:        string
  onChange:     (val: string) => void
  placeholder?: string
  disabled?:    boolean
  className?:   string
}

export default function ComboBox({
  options,
  value,
  onChange,
  placeholder = 'Choisir ou saisir...',
  disabled = false,
  className = '',
}: ComboBoxProps) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const containerRef      = useRef<HTMLDivElement>(null)
  const inputRef          = useRef<HTMLInputElement>(null)

  // Sync query with external value when it changes (e.g. parent resets)
  useEffect(() => {
    if (!open) setQuery(value)
  }, [value, open])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        commitAndClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [query])

  function commitAndClose() {
    // Whatever is typed, commit it as the value (allows custom entries)
    if (query.trim() !== value) onChange(query.trim())
    setOpen(false)
  }

  function handleFocus() {
    if (disabled) return
    setQuery('')          // clear so user sees filtered list from scratch
    setOpen(true)
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    setOpen(true)
    // Live-update the form value as user types (for free-text support)
    onChange(e.target.value)
  }

  function select(opt: string) {
    onChange(opt)
    setQuery(opt)
    setOpen(false)
    inputRef.current?.blur()
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
    setQuery('')
    setOpen(false)
  }

  const filtered = query
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options

  const displayValue = open ? query : value

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          className={[
            'w-full rounded-xl border text-sm px-3 py-2 pr-16',
            'border-[#E8E5DE] bg-[#F8F7F4]',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            'transition-all placeholder:text-[#B0ACA5]',
            disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-text',
          ].join(' ')}
          style={{ focusRingColor: 'var(--primary, #C9A440)' } as React.CSSProperties}
          placeholder={placeholder}
          value={displayValue}
          onFocus={handleFocus}
          onChange={handleInput}
          onKeyDown={e => {
            if (e.key === 'Escape') { setOpen(false); setQuery(value) }
            if (e.key === 'Enter')  { e.preventDefault(); if (filtered[0]) select(filtered[0]); else commitAndClose() }
            if (e.key === 'Tab')    commitAndClose()
          }}
          disabled={disabled}
          autoComplete="off"
        />

        <div className="absolute right-2 flex items-center gap-1">
          {value && !disabled && (
            <button
              type="button"
              onClick={clear}
              className="w-5 h-5 rounded-full flex items-center justify-center text-[#9A9690] hover:text-[#4A4845] hover:bg-[#E8E5DE] transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => { if (!disabled) { inputRef.current?.focus(); setOpen(o => !o) } }}
            className="w-5 h-5 flex items-center justify-center text-[#9A9690]"
            tabIndex={-1}
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Dropdown list */}
      {open && filtered.length > 0 && (
        <div className={[
          'absolute z-50 mt-1 w-full',
          'bg-white border border-[#E8E5DE] rounded-xl shadow-lg',
          'max-h-52 overflow-y-auto',
          'py-1',
        ].join(' ')}>
          {filtered.map(opt => (
            <button
              key={opt}
              type="button"
              onMouseDown={e => { e.preventDefault(); select(opt) }}
              className={[
                'w-full text-left px-3 py-2 text-sm transition-colors',
                'hover:bg-[#F8F7F4]',
                opt === value ? 'font-medium text-[#C9A440] bg-[#FAF7EE]' : 'text-[#2A2825]',
              ].join(' ')}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* No results hint */}
      {open && filtered.length === 0 && query.trim() !== '' && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-[#E8E5DE] rounded-xl shadow-lg py-2 px-3">
          <p className="text-xs text-[#9A9690]">
            Valeur personnalisée : <span className="font-medium text-[#2A2825]">&ldquo;{query}&rdquo;</span>
          </p>
          <p className="text-xs text-[#B0ACA5] mt-0.5">Appuyez sur Entrée pour confirmer</p>
        </div>
      )}
    </div>
  )
}