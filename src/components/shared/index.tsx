// No 'use client' here on purpose: this shared UI kit is only imported by client
// components, which already put it in the browser bundle. Marking it as a
// client entry makes Next's editor plugin flag every callback prop
// (onClick, onClose…) as "must be serializable" (TS 71007).
import React from 'react'
import { cn } from '@/lib/utils'
import { codeLabel, type CodeDomain, type Code, type Lang } from '@/lib/codes'

// ── Status Badge ──────────────────────────────────────────────
const GREEN  = 'bg-emerald-50 text-emerald-700 border-emerald-200'
const SLATE  = 'bg-ez-muted text-ez-subtle border-ez-border'
const BLUE   = 'bg-blue-50 text-blue-700 border-blue-200'
const ORANGE = 'bg-orange-50 text-orange-700 border-orange-200'
const AMBER  = 'bg-amber-50 text-amber-700 border-amber-200'
const RED    = 'bg-red-50 text-red-700 border-red-200'

const STATUS_STYLES: Partial<Record<CodeDomain, Record<string, string>>> = {
  device_status:  { disponible: GREEN, vendu: SLATE, echange: BLUE, en_reparation: ORANGE, reserve: AMBER, en_livraison: BLUE, en_transfert: BLUE },
  repair_status:  { en_attente: AMBER, en_cours: BLUE, pret: GREEN, recupere: SLATE },
  stock_level:    { disponible: GREEN, alerte: AMBER, epuise: RED },
  payment_status: { solde: GREEN, reste: BLUE, trop_percu: ORANGE },
  operation_type: { vente: GREEN, echange: BLUE, avance: AMBER, retour: ORANGE },
}

interface StatusBadgeProps<D extends CodeDomain> {
  domain: D
  code:   Code<D> | string | null | undefined
  lang?:  Lang
  size?:  'sm' | 'md'
}

export function StatusBadge<D extends CodeDomain>({ domain, code, lang = 'fr', size = 'sm' }: StatusBadgeProps<D>) {
  if (!code) return null
  const style = STATUS_STYLES[domain]?.[code] || 'bg-ez-muted text-ez-subtle border-ez-border'
  const label = codeLabel(domain, code as Code<D>, lang)
  return (
    <span className={cn(
      'inline-flex w-fit items-center border rounded-full font-medium whitespace-nowrap',
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
      style
    )}>
      {label}
    </span>
  )
}

// ── Battery Bar ───────────────────────────────────────────────
export function BatteryBar({ level, marque }: { level: number | null | undefined; marque?: string }) {
  if (level == null) return <span className="text-ez-placeholder text-xs">—</span>
  const isApple = marque?.toLowerCase() === 'apple'
  const color   = isApple
    ? (level > 79 ? 'bg-emerald-500' : level >= 60 ? 'bg-amber-500' : 'bg-red-500')
    : (level >= 70 ? 'bg-emerald-500' : level >= 40 ? 'bg-amber-500' : 'bg-red-500')
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-ez-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${level}%` }} />
      </div>
      <span className="text-xs text-ez-subtle">{level}%</span>
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────
export function EmptyState({ icon, title, description, action }: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-ez-muted flex items-center justify-center mb-4 text-ez-placeholder">
        {icon}
      </div>
      <p className="font-display text-lg font-semibold text-ez-subtle">{title}</p>
      {description && <p className="text-ez-placeholder text-sm mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── Loading Skeleton ──────────────────────────────────────────
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 p-4 animate-pulse">
      <div className="w-10 h-10 bg-ez-muted rounded-xl flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-ez-muted rounded w-1/3" />
        <div className="h-2.5 bg-ez-muted/60 rounded w-1/2" />
      </div>
      <div className="h-3 bg-ez-muted rounded w-16" />
    </div>
  )
}

// ── Modal wrapper ─────────────────────────────────────────────
let modalIdCounter = 0

export function Modal({ open, onClose, title, children, size = 'md', closeLabel }: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeLabel?: string
}) {
  // Escape key closes the modal
  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  const titleId = React.useRef(`modal-title-${++modalIdCounter}`).current

  if (!open) return null
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-2xl', xl: 'max-w-4xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
           className={`relative w-full ${widths[size]} bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.15)] max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-ez-border flex-shrink-0">
          <h2 id={titleId} className="font-display text-lg font-bold text-ez-text tracking-wide">{title}</h2>
          <button onClick={onClose} aria-label={closeLabel ?? 'Fermer'}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-ez-subtle hover:text-ez-text hover:bg-ez-muted transition-all text-lg leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-6">
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Form Field ────────────────────────────────────────────────
export function Field({ label, required, children, hint }: {
  label: string
  required?: boolean
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div>
      <label className="block text-xs text-ez-subtle uppercase tracking-widest mb-1.5 font-medium">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-ez-placeholder mt-1">{hint}</p>}
    </div>
  )
}

export const inputClass = "w-full bg-ez-bg border border-ez-border rounded-xl px-4 py-2.5 text-ez-text text-sm placeholder:text-ez-placeholder focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/10 transition-all"
export const selectClass = "w-full bg-ez-bg border border-ez-border rounded-xl px-4 py-2.5 text-ez-text text-sm focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/10 transition-all appearance-none"

// ── Button ────────────────────────────────────────────────────
export function Btn({ children, onClick, variant = 'primary', size = 'md', disabled, loading, type = 'button', className, style }: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit'
  className?: string
  style?: React.CSSProperties
}) {
  const variants = {
    primary:   'bg-gold hover:bg-gold-500 text-white hover:shadow-ez-gold',
    secondary: 'bg-ez-muted hover:bg-ez-border text-ez-text',
    ghost:     'bg-transparent hover:bg-ez-muted text-ez-subtle hover:text-ez-text',
    danger:    'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200',
  }
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant], sizes[size], className
      )}
      style={style}
    >
      {loading && (
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      )}
      {children}
    </button>
  )
}

// ── Row action (icon button in a list row) ──────────────────
// Table rows carry several small actions side by side (étiquette, modifier,
// crédit, supprimer). A visible border, a 32px target and gap-2 between them
// keep each one easy to hit; the title doubles as the hover label.
const ROW_ACTION_TONES = {
  neutral: 'hover:text-ez-text hover:bg-ez-muted hover:border-[#D9D5CC]',
  gold:    'hover:text-gold hover:bg-gold-50 hover:border-[#EADFB8]',
  danger:  'hover:text-red-600 hover:bg-red-50 hover:border-red-200',
}

// "…" button opening a small menu — for rare or destructive row actions
// (e.g. Supprimer), so they don't sit next to the everyday buttons.
export function RowMenu({ items, label = 'Plus d\'actions' }: {
  items: { label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean }[]
  label?: string
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  if (!items.length) return null
  return (
    <div ref={ref} className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
      <RowAction title={label} onClick={() => setOpen(o => !o)}>
        <span className="text-base leading-none tracking-widest -mt-1.5">…</span>
      </RowAction>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-20 min-w-[160px] bg-white border border-ez-border rounded-xl shadow-ez-md py-1">
          {items.map(it => (
            <button key={it.label} type="button" role="menuitem"
              onClick={() => { setOpen(false); it.onClick() }}
              className={cn('w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                it.danger ? 'text-red-600 hover:bg-red-50' : 'text-ez-text hover:bg-ez-bg')}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function RowAction({ title, onClick, tone = 'neutral', children }: {
  title: string
  onClick: (e: React.MouseEvent) => void
  tone?: keyof typeof ROW_ACTION_TONES
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'flex items-center justify-center w-8 h-8 flex-shrink-0 rounded-lg border border-[#EEEBE4] bg-white text-ez-faint transition-all',
        ROW_ACTION_TONES[tone],
      )}
    >
      {children}
    </button>
  )
}

/** Thin separator that sets a destructive action apart from the others. */
export function RowActionDivider() {
  return <span aria-hidden className="w-px h-5 bg-ez-border mx-0.5 flex-shrink-0" />
}

// ── Page Header ───────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions }: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    // On a phone the buttons wrap under the title instead of pushing off-screen.
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-4 sm:mb-6">
      <div className="min-w-0">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-ez-text tracking-wide leading-tight">{title}</h1>
        {subtitle && <p className="text-ez-subtle text-sm mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export { Select } from './Select'
