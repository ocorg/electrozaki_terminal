import { createHmac } from 'node:crypto'
import { prisma } from '@/lib/db'
import type { Prisma } from '@/generated/storefront/client'
import { storefrontDb, storefrontConfigured } from './db'

// ─────────────────────────────────────────────────────────────────────────
// Repair tracking on the website (/reparation/suivi).
//
// OUT: each ticket's public status → the website's RepairTracking table
//      (ticket number, device, status, quote amount). No name, no phone:
//      the phone is stored as an HMAC the website can compare but not read.
// IN:  a customer's answer to a quote, stored by the website on that row,
//      is applied here to the ticket (accepted → en cours, refused → prêt,
//      to be returned) and marked as applied.
// The website never gets access to the ERP; only the ERP reads/writes both.
// ─────────────────────────────────────────────────────────────────────────

const KIND = { materiel: 'HARDWARE', logiciel: 'SOFTWARE', consultation: 'CONSULTATION' } as const

/**
 * Phone fingerprint shared with the website (lib/repair-tracking.ts), keyed
 * with the secret both apps already hold for page refreshes.
 */
export function phoneHash(phone: string): string {
  const secret = process.env.STOREFRONT_REVALIDATE_SECRET
  if (!secret) throw new Error('STOREFRONT_REVALIDATE_SECRET is not set')
  return createHmac('sha256', secret).update(`track:${phone.replace(/\D/g, '').slice(-9)}`).digest('base64url')
}

/** Tickets from the last 6 months (and every still-open one) are trackable. */
const TRACK_WINDOW_MS = 183 * 86_400_000

export async function syncRepairTracking(): Promise<{ written: number }> {
  const since = new Date(Date.now() - TRACK_WINDOW_MS)
  const tickets = await prisma.reparations.findMany({
    where: { OR: [{ created_at: { gte: since } }, { statut: { not: 'recupere' }, is_deleted: false }] },
    select: {
      rep_id: true, statut: true, type_reparation: true, marque: true, model: true, is_deleted: true,
      cout_reparation: true, devis_envoye_le: true, clients: { select: { telephone: true } },
    },
  })
  const db = storefrontDb()
  const existing = new Map((await db.repairTracking.findMany()).map(r => [r.ref, r]))

  let written = 0
  const creates: Prisma.RepairTrackingCreateManyInput[] = []
  for (const t of tickets) {
    const phone = t.clients?.telephone
    if (!phone || phone.replace(/\D/g, '').length < 9) continue // no way to prove ownership
    const row = {
      phoneHash:   phoneHash(phone),
      kind:        KIND[t.type_reparation],
      status:      t.statut as string,
      device:      `${t.marque ?? ''} ${t.model}`.trim(),
      quoteAmount: t.statut === 'devis_envoye' || t.devis_envoye_le ? Number(t.cout_reparation ?? 0) : null,
      quoteSentAt: t.devis_envoye_le,
      cancelled:   t.is_deleted,
    }
    const cur = existing.get(t.rep_id)
    if (!cur) {
      creates.push({ ref: t.rep_id, ...row })
      written++
    } else if (
      cur.phoneHash !== row.phoneHash || cur.kind !== row.kind || cur.status !== row.status || cur.device !== row.device ||
      (cur.quoteAmount === null ? null : Number(cur.quoteAmount)) !== row.quoteAmount ||
      (cur.quoteSentAt?.getTime() ?? null) !== (row.quoteSentAt?.getTime() ?? null) || cur.cancelled !== row.cancelled
    ) {
      // A new quote (sent again after a change) reopens the customer's answer.
      const newQuote = (cur.quoteSentAt?.getTime() ?? null) !== (row.quoteSentAt?.getTime() ?? null)
      await db.repairTracking.update({
        where: { ref: t.rep_id },
        data:  { ...row, ...(newQuote && { quoteDecision: null, quoteDecidedAt: null, decisionApplied: false }) },
      })
      written++
    }
  }
  if (creates.length) await db.repairTracking.createMany({ data: creates, skipDuplicates: true })
  return { written }
}

/** Applies customers' online quote answers to their tickets. */
export async function pullQuoteDecisions(): Promise<number> {
  const pending = await storefrontDb().repairTracking.findMany({
    where: { quoteDecision: { not: null }, decisionApplied: false },
  })
  let applied = 0
  for (const p of pending) {
    const ticket = await prisma.reparations.findUnique({
      where:  { rep_id: p.ref },
      select: { rep_id: true, statut: true, store_id: true, notes: true, is_deleted: true },
    })
    if (ticket && !ticket.is_deleted && ticket.statut === 'devis_envoye') {
      const accepted = p.quoteDecision === 'ACCEPTED'
      const when     = p.quoteDecidedAt ?? new Date()
      const line     = accepted ? 'Devis accepté en ligne par le client' : 'Devis refusé en ligne par le client — appareil à restituer'
      await prisma.reparations.update({
        where: { rep_id: ticket.rep_id },
        data: {
          statut: accepted ? 'en_cours' : 'pret',
          ...(accepted ? { devis_accepte_le: when } : { devis_refuse_le: when }),
          notes: [ticket.notes, line].filter(Boolean).join(' — '),
        },
      })
      await prisma.activity_log.create({
        data: {
          store_id: ticket.store_id, user_id: null, user_name: 'Client (site web)',
          action_type: 'modification', module: 'reparations', record_id: ticket.rep_id, notes: line,
        },
      })
      applied++
    }
    await storefrontDb().repairTracking.update({ where: { ref: p.ref }, data: { decisionApplied: true } })
  }
  return applied
}

/** Both directions, never throwing (called after writes and on polls). */
export async function repairTrackingQuietly(reason: string): Promise<void> {
  if (!storefrontConfigured() || !process.env.STOREFRONT_REVALIDATE_SECRET) return
  try {
    const applied = await pullQuoteDecisions()
    const { written } = await syncRepairTracking()
    if (applied || written) console.log(`[repair-tracking] ${reason}: ${applied} réponse(s) client, ${written} ticket(s) publiés`)
  } catch (err) {
    console.error(`[repair-tracking] ${reason} failed:`, err)
  }
}
