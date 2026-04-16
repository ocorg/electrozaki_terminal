'use client'
import { cn } from '@/lib/utils'

// ── Status Badge ──────────────────────────────────────────────
const STATUS_STYLES: Record<string, string> = {
  // Device status
  'متوفر':       'bg-emerald-50 text-emerald-700 border-emerald-200',
  'مباع':        'bg-slate-100 text-slate-600 border-slate-200',
  'إستبدال':     'bg-blue-50 text-blue-700 border-blue-200',
  'إصلاح':       'bg-orange-50 text-orange-700 border-orange-200',
  // Repair status
  'معلق':        'bg-amber-50 text-amber-700 border-amber-200',
  'قيد الإصلاح': 'bg-blue-50 text-blue-700 border-blue-200',
  'جاهز':        'bg-emerald-50 text-emerald-700 border-emerald-200',
  'تم الاستلام': 'bg-slate-100 text-slate-500 border-slate-200',
  // Stock
  'نفذ':         'bg-red-50 text-red-700 border-red-200',
  'تحذير':       'bg-amber-50 text-amber-700 border-amber-200',
  // Payment
  '✅ مسدد':      'bg-emerald-50 text-emerald-700 border-emerald-200',
  '🔵 متبقي':    'bg-blue-50 text-blue-700 border-blue-200',
  '⚠️ زيادة دفع':'bg-orange-50 text-orange-700 border-orange-200',
}

const STATUS_LABELS_FR: Record<string, string> = {
  'متوفر':       'Disponible',
  'مباع':        'Vendu',
  'إستبدال':     'Échangé',
  'إصلاح':       'Réparation',
  'معلق':        'En attente',
  'قيد الإصلاح': 'En cours',
  'جاهز':        'Prêt',
  'تم الاستلام': 'Récupéré',
  'نفذ':         'Épuisé',
  'تحذير':       'Stock bas',
  '✅ مسدد':      'Soldé',
  '🔵 متبقي':    'Solde restant',
  '⚠️ زيادة دفع': 'Trop payé',
  'جديد':        'Neuf',
  'مستعمل':      'Occasion',
  'معطوب':       'Défectueux',
}

interface StatusBadgeProps {
  status: string
  lang?: 'fr' | 'ar'
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, lang = 'fr', size = 'sm' }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] || 'bg-gray-100 text-gray-600 border-gray-200'
  const label = lang === 'fr' ? (STATUS_LABELS_FR[status] || status) : status
  return (
    <span className={cn(
      'inline-flex items-center border rounded-full font-medium',
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
      style
    )}>
      {label}
    </span>
  )
}

// ── Battery Bar ───────────────────────────────────────────────
export function BatteryBar({ level }: { level: number | null | undefined }) {
  if (level == null) return <span className="text-ez-placeholder text-xs">—</span>
  const color = level >= 70 ? 'bg-emerald-500' : level >= 40 ? 'bg-amber-500' : 'bg-red-500'
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
export function Modal({ open, onClose, title, children, size = 'md' }: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  if (!open) return null
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-2xl', xl: 'max-w-4xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${widths[size]} bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.15)] max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-ez-border flex-shrink-0">
          <h2 className="font-display text-lg font-bold text-ez-text tracking-wide">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-ez-subtle hover:text-ez-text hover:bg-ez-muted transition-all text-lg leading-none">×</button>
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
export function Btn({ children, onClick, variant = 'primary', size = 'md', disabled, loading, type = 'button', className }: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit'
  className?: string
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

// ── Page Header ───────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions }: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ez-text tracking-wide">{title}</h1>
        {subtitle && <p className="text-ez-subtle text-sm mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}