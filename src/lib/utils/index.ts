import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a number as MAD currency */
export function formatMAD(amount: number | null | undefined): string {
  if (amount == null) return '— MAD'
  return new Intl.NumberFormat('fr-MA', {
    style: 'currency',
    currency: 'MAD',
    minimumFractionDigits: 2,
  }).format(amount)
}

/** Format date to DD/MM/YYYY */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('fr-FR')
}

/** Compute FARIQ for a transaction */
export function computeFariq(prixVente: number, avance = 0, valeurEchange = 0): number {
  return prixVente - avance - valeurEchange
}

/** Round to 2 decimal places (currency-safe) */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Compute STATUT_PAIEMENT (a payment_status code, see src/lib/codes.ts) */
export function computeStatutPaiement(fariq: number): 'solde' | 'reste' | 'trop_percu' {
  if (fariq === 0) return 'solde'
  if (fariq > 0)  return 'reste'
  return 'trop_percu'
}

/** Compute WARRANTY_EXPIRY: start + N calendar months (not × 30 days). */
export function computeWarrantyExpiry(startDate: string, months: number): Date {
  const start = new Date(startDate)
  start.setMonth(start.getMonth() + months)
  return start
}

/** Get warranty flag */
export function getWarrantyFlag(expiryDate: string | null | undefined): '🟢' | '🟡' | '🔴' | null {
  if (!expiryDate) return null
  const expiry = new Date(expiryDate)
  const today = new Date()
  const diffDays = Math.floor((expiry.getTime() - today.getTime()) / 86400000)
  if (diffDays < 0)  return '🔴'
  if (diffDays <= 30) return '🟡'
  return '🟢'
}

/** Compute the effective price after applying a promo. Returns null when no promo is set. */
export function computePromoPrice(
  prixBase:     number,
  promoType?:   string | null,
  promoMontant?: number | null
): number | null {
  if (!promoType || !promoMontant || promoMontant <= 0) return null
  if (promoType === 'pourcentage') return Math.max(0, prixBase * (1 - promoMontant / 100))
  if (promoType === 'valeur')      return Math.max(0, prixBase - promoMontant)
  return null
}

/** Check if price is below minimum (requires override) */
export function isBelowMinimum(price: number, minimum: number | null | undefined): boolean {
  if (!minimum) return false
  return price < minimum
}

/**
 * Returns today's business date as YYYY-MM-DD.
 * Business day rolls at 4AM — covers late-night closing shifts.
 * Use this everywhere instead of new Date().toISOString().split('T')[0].
 */
export function getBusinessDate(): string {
  const d = new Date()
  if (d.getHours() < 4) d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Moroccan phone number validation */
export function isValidMoroccanPhone(phone: string): boolean {
  return /^0[67]\d{8}$/.test(phone.replace(/\s/g, ''))
}

/** Generate EZ-ACC barcode ID */
export function generateBarcodeId(accId: string): string {
  return accId // acc_id already follows EZ-ACC-000001 format
}

/**
 * Drop-in replacement for fetch() that handles the Supabase token-refresh
 * race condition. On a 401, waits 800ms for the new token to be written
 * then retries the request once. The user never sees the error.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = 1
): Promise<Response> {
  const res = await fetch(url, options)
  if (res.status === 401 && retries > 0) {
    await new Promise(r => setTimeout(r, 800))
    return fetchWithRetry(url, options, retries - 1)
  }
  return res
}
