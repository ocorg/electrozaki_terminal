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

/** Compute STATUT_PAIEMENT */
export function computeStatutPaiement(fariq: number): '✅ مسدد' | '🔵 متبقي' | '⚠️ زيادة دفع' {
  if (fariq === 0) return '✅ مسدد'
  if (fariq > 0)  return '🔵 متبقي'
  return '⚠️ زيادة دفع'
}

/** Compute WARRANTY_EXPIRY: start + (months × 30 days) */
export function computeWarrantyExpiry(startDate: string, months: number): Date {
  const start = new Date(startDate)
  start.setDate(start.getDate() + months * 30)
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

/** Check if price is below minimum (requires override) */
export function isBelowMinimum(price: number, minimum: number | null | undefined): boolean {
  if (!minimum) return false
  return price < minimum
}

/** Moroccan phone number validation */
export function isValidMoroccanPhone(phone: string): boolean {
  return /^0[67]\d{8}$/.test(phone.replace(/\s/g, ''))
}

/** Generate EZ-ACC barcode ID */
export function generateBarcodeId(accId: string): string {
  return accId // acc_id already follows EZ-ACC-000001 format
}
