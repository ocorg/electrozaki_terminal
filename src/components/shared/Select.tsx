// No 'use client': only client components import it (see shared/index.tsx).
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────
// Styled drop-in replacement for the native select element.
//
// A native select's open list is drawn by the operating system, so it can't
// match the app. This one keeps the same API — <option>/<optgroup> children,
// value, onChange(e => e.target.value), className, disabled, name — so a
// screen switches by renaming the tag. Adds: grouped headers, a search box
// for long lists, keyboard control, and a list that stays inside the screen
// (rendered in a portal, so modals and scrolling panels never clip it).
// ─────────────────────────────────────────────────────────────────────────

type Opt = { value: string; label: string; disabled: boolean; group: string | null }

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children)
  return ''
}

function collect(children: React.ReactNode, group: string | null, out: Opt[]) {
  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return
    const props = child.props as { value?: unknown; children?: React.ReactNode; disabled?: boolean; label?: string }
    if (child.type === 'option') {
      const label = textOf(props.children)
      out.push({ value: props.value === undefined ? label : String(props.value), label, disabled: !!props.disabled, group })
    } else if (child.type === 'optgroup') {
      collect(props.children, props.label ?? null, out)
    } else if (child.type === React.Fragment) {
      collect(props.children, group, out)
    }
  })
}

type SelectProps = {
  value?: string | number | null
  defaultValue?: string | number
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  disabled?: boolean
  name?: string
  id?: string
  required?: boolean
  title?: string
  'aria-label'?: string
  /** Search box above the list; default: when there are more than 10 options. */
  searchable?: boolean
}

export function Select({
  value, defaultValue, onChange, children, className, style, disabled, name, id, required, title,
  'aria-label': ariaLabel, searchable,
}: SelectProps) {
  const options = useMemo(() => { const out: Opt[] = []; collect(children, null, out); return out }, [children])
  const controlled = value !== undefined
  const [inner, setInner] = useState(String(defaultValue ?? options[0]?.value ?? ''))
  const current = controlled ? String(value ?? '') : inner
  const selected = options.find(o => o.value === current) ?? (current === '' ? options.find(o => o.value === '') : undefined)

  const [open, setOpen]     = useState(false)
  const [query, setQuery]   = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos]       = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef    = useRef<HTMLDivElement>(null)
  const hiddenRef  = useRef<HTMLInputElement>(null)
  const listId = useId()
  const withSearch = searchable ?? options.length > 10

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const visible = useMemo(() => {
    const q = norm(query.trim())
    return q ? options.filter(o => norm(o.label).includes(q)) : options
  }, [options, query])

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const width = Math.max(r.width, 200)
    const left  = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
    if (below >= 240 || below >= above) setPos({ left, top: r.bottom + 4, width, maxHeight: Math.min(320, below) })
    else setPos({ left, bottom: window.innerHeight - r.top + 4, width, maxHeight: Math.min(320, above) })
  }, [])

  function openList() {
    if (disabled) return
    place()
    setQuery('')
    const i = options.findIndex(o => o.value === current)
    setActive(i >= 0 ? i : 0)
    setOpen(true)
  }

  function choose(o: Opt) {
    if (o.disabled) return
    if (!controlled) setInner(o.value)
    if (hiddenRef.current) hiddenRef.current.value = o.value // forms that submit right after onChange
    setOpen(false)
    triggerRef.current?.focus()
    if (o.value !== current) {
      const target = { value: o.value, name: name ?? '' }
      onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>)
    }
  }

  // Keep the list glued to the trigger while the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, place])

  // Close on a click anywhere else.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function move(delta: number) {
    if (!visible.length) return
    let i = active
    for (let n = 0; n < visible.length; n++) {
      i = (i + delta + visible.length) % visible.length
      if (!visible[i].disabled) break
    }
    setActive(i)
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); if (visible[active]) choose(visible[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); triggerRef.current?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }

  let lastGroup: string | null = null
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKey}
        style={style}
        className={cn(
          'relative flex items-center text-start pe-9 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
          className,
          open && 'border-gold ring-2 ring-gold/10',
        )}
      >
        <span className={cn('truncate', !selected?.label && 'text-ez-placeholder')}>{selected?.label || '—'}</span>
        <ChevronDown className={cn('w-4 h-4 absolute end-3 top-1/2 -translate-y-1/2 text-ez-subtle transition-transform', open && 'rotate-180')} />
      </button>
      {name && <input ref={hiddenRef} type="hidden" name={name} value={current} required={required} readOnly />}

      {open && pos && createPortal(
        <div
          ref={listRef}
          className="fixed z-[80] rounded-xl border border-ez-border bg-white shadow-[0_12px_32px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden animate-fade-in"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
          onKeyDown={onKey}
        >
          {withSearch && (
            <div className="p-2 border-b border-ez-border flex-shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-ez-placeholder" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => { setQuery(e.target.value); setActive(0) }}
                  placeholder="Rechercher…"
                  className="w-full rounded-lg bg-ez-bg border border-ez-border ps-8 pe-2 py-1.5 text-sm focus:outline-none focus:border-gold"
                />
              </div>
            </div>
          )}
          <div id={listId} role="listbox" aria-label={ariaLabel} className="overflow-y-auto py-1">
            {visible.length === 0 && <p className="px-3 py-2 text-sm text-ez-subtle">Aucun résultat</p>}
            {visible.map((o, i) => {
              const header = o.group && o.group !== lastGroup ? o.group : null
              lastGroup = o.group
              const isSel = o.value === current
              return (
                <React.Fragment key={`${o.group ?? ''}|${o.value}|${i}`}>
                  {header && (
                    <p className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-ez-placeholder">{header}</p>
                  )}
                  <div
                    role="option"
                    aria-selected={isSel}
                    aria-disabled={o.disabled}
                    data-index={i}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => choose(o)}
                    className={cn(
                      'mx-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm',
                      o.group && 'ps-5',
                      o.disabled ? 'text-ez-placeholder cursor-not-allowed' : 'text-ez-text cursor-pointer',
                      i === active && !o.disabled && 'bg-ez-bg',
                      isSel && 'font-semibold',
                    )}
                  >
                    <span className="flex-1 truncate">{o.label || '—'}</span>
                    {isSel && <Check className="w-4 h-4 text-gold flex-shrink-0" />}
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
