// No 'use client' here on purpose: this "Site web" helpers is only imported by client
// components, which already put it in the browser bundle. Marking it as a
// client entry makes Next's editor plugin flag every callback prop
// (onClick, onClose…) as "must be serializable" (TS 71007).
import { useLanguageStore } from '@/lib/stores/language'
import { useUser } from '@/lib/hooks/useUser'

/** fr/ar label picker for the "Site web" screens. */
export function useSiteLang() {
  const { language } = useLanguageStore()
  const isAr = language === 'ar'
  const { user } = useUser()
  return {
    isAr,
    L: (fr: string, ar: string) => (isAr ? ar : fr),
    isManager: user?.role === 'gerant' || user?.role === 'proprietaire',
  }
}

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { key: T; label: string; count?: number }[]
  value: T
  onChange: (key: T) => void
}) {
  return (
    <div className="flex gap-1 p-1 bg-white border border-ez-border rounded-xl w-fit max-w-full overflow-x-auto">
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
            value === t.key ? 'bg-gold text-white' : 'text-ez-subtle hover:bg-ez-muted'
          }`}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 opacity-70">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

const TONES = {
  blue:  'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  gray:  'bg-gray-50 text-gray-500 border-gray-200',
  red:   'bg-red-50 text-red-600 border-red-200',
  gold:  'bg-[#FAF5E8] text-[#A8862E] border-[#EADFB8]',
} as const

export function Chip({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${TONES[tone]}`}>{children}</span>
}

// Website enums → labels (the website database keeps its own English codes).
export const ORDER_STATUS: Record<string, { fr: string; ar: string; tone: keyof typeof TONES }> = {
  NEW:       { fr: 'Nouvelle',  ar: 'جديد',     tone: 'blue' },
  CONTACTED: { fr: 'Contactée', ar: 'تم الاتصال', tone: 'amber' },
  CONFIRMED: { fr: 'Confirmée', ar: 'مؤكد',     tone: 'green' },
  CANCELLED: { fr: 'Annulée',   ar: 'ملغى',     tone: 'gray' },
}

export const PAYMENT_STATUS: Record<string, { fr: string; ar: string; tone: keyof typeof TONES }> = {
  NOT_REQUIRED:     { fr: 'Sans avance',        ar: 'بدون عربون',      tone: 'gray' },
  AWAITING_RECEIPT: { fr: 'Reçu attendu',       ar: 'في انتظار الوصل', tone: 'amber' },
  RECEIPT_UPLOADED: { fr: 'Reçu à vérifier',    ar: 'وصل للتحقق',      tone: 'gold' },
  VERIFIED:         { fr: 'Avance vérifiée',    ar: 'عربون مؤكد',      tone: 'green' },
  REJECTED:         { fr: 'Reçu refusé',        ar: 'وصل مرفوض',       tone: 'red' },
}

export const REPAIR_STATUS: Record<string, { fr: string; ar: string; tone: keyof typeof TONES }> = {
  NEW:       { fr: 'Nouvelle',  ar: 'جديد',       tone: 'blue' },
  CONTACTED: { fr: 'Contactée', ar: 'تم الاتصال', tone: 'amber' },
  QUOTED:    { fr: 'Devis envoyé', ar: 'تم إرسال السعر', tone: 'gold' },
  CONFIRMED: { fr: 'Confirmée', ar: 'مؤكد',       tone: 'green' },
  CANCELLED: { fr: 'Annulée',   ar: 'ملغى',       tone: 'gray' },
}

export const AVAILABILITY: Record<string, { fr: string; ar: string; tone: keyof typeof TONES }> = {
  IN_STOCK:     { fr: 'En stock',     ar: 'متوفر',      tone: 'green' },
  OUT_OF_STOCK: { fr: 'Épuisé',       ar: 'نفد',        tone: 'amber' },
  COMING_SOON:  { fr: 'Bientôt',      ar: 'قريباً',     tone: 'blue' },
  DISCONTINUED: { fr: 'Plus en stock', ar: 'غير متوفر', tone: 'gray' },
}

export const GRADE: Record<string, string> = {
  NEUF: 'Neuf', TRES_BON: 'Très bon état', BON: 'Bon état', PIECES_REMPLACEES: 'Pièces remplacées',
}

/** wa.me link for a Moroccan number typed any way (06…, +212 6…). */
export function whatsappLink(phone: string) {
  const digits = phone.replace(/\D/g, '')
  const intl   = digits.startsWith('212') ? digits : digits.startsWith('0') ? `212${digits.slice(1)}` : digits
  return `https://wa.me/${intl}`
}

export const mad = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${new Intl.NumberFormat('fr-MA').format(n)} DH`

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
