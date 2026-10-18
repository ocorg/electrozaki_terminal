// CRM leads (owner, 2026-10-18): a conversation started on a social network
// (or by phone, on the website, in the shop), entered by hand by a manager
// and followed to its outcome. Shared by the API routes and the screens.
//
//   • a lead is open until it is won or lost
//   • won = linked to what really happened: the POS sale, the delivery, or the
//     phone bought from them — never a typed amount, so the numbers stay true
//   • lost = with a reason from a fixed list
//   • "En attente de stock" = the shop's list of people to contact when what
//     they want comes in (phones are matched automatically: lib/prospects)
import type { lead_canal, lead_etape, lead_type, lead_motif } from '@prisma/client'

export const CANAUX: lead_canal[] = ['instagram', 'whatsapp', 'tiktok', 'facebook', 'appel', 'site', 'magasin', 'autre']
export const TYPES: lead_type[]   = ['achat', 'reprise', 'vente', 'autre']
export const ETAPES: lead_etape[] = ['nouveau', 'en_discussion', 'proposition', 'attente_stock', 'gagne', 'perdu']
export const OPEN: lead_etape[]   = ['nouveau', 'en_discussion', 'proposition', 'attente_stock']
export const MOTIFS: lead_motif[] = ['prix', 'pas_en_stock', 'achete_ailleurs', 'sans_reponse', 'curieux', 'refus_livraison', 'autre']

/** Last 9 digits of a Moroccan number: "+212 6 12…", "0612…" and "612…" are the same person. */
export const phoneKey = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-9)

/** "@Karim.Phones " → "karim.phones" */
export const pseudoKey = (v: string | null | undefined) => (v ?? '').trim().replace(/^@+/, '').toLowerCase()

/** The link that reopens the conversation, from the number or the @name. */
export function contactUrl(lead: { canal: string; telephone?: string | null; pseudo?: string | null }): string | null {
  const digits = phoneKey(lead.telephone)
  const handle = pseudoKey(lead.pseudo)
  switch (lead.canal) {
    case 'instagram': if (handle) return `https://instagram.com/${handle}`; break
    case 'tiktok':    if (handle) return `https://www.tiktok.com/@${handle}`; break
    case 'facebook':  if (handle) return /^https?:/i.test(lead.pseudo ?? '') ? lead.pseudo! : `https://facebook.com/${handle}`; break
  }
  return digits.length === 9 ? `https://wa.me/212${digits}` : null
}

/** Does this lead want a phone the shop could have (achat or reprise of a phone)? */
export const wantsPhone = (lead: { type_demande: string; cherche?: string | null; etape: string }) =>
  (lead.type_demande === 'achat' || lead.type_demande === 'reprise') && lead.cherche !== 'accessoire' && OPEN.includes(lead.etape as lead_etape)
