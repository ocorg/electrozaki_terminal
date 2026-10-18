import { redirect } from 'next/navigation'

// Prospects became the CRM (owner, 2026-10-18): its requests are leads now
export default function EZProspectsPage() {
  redirect('/ez/crm')
}
