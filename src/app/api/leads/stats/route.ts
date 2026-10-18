import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, dateOnly, todayDate, HttpError, MANAGERS } from '@/lib/api'
import { OPEN } from '@/lib/leads'

// GET ?store_id=&from=&to= — the CRM's numbers for leads that came in over the
// period (owner, 2026-10-18): per channel how many came, were won, lost or are
// still open, what the won ones brought, why leads are lost, what people ask
// for (in stock or not), and per manager.
export async function GET(request: NextRequest) {
  try {
    await requireUser(MANAGERS)
    const sp       = new URL(request.url).searchParams
    const store_id = sp.get('store_id')
    if (!store_id) throw new HttpError(400, 'store_id requis')
    const to   = dateOnly(sp.get('to')) ?? todayDate()
    const from = dateOnly(sp.get('from')) ?? new Date(to.getTime() - 29 * 86_400_000)
    const end  = new Date(to.getTime() + 86_400_000)

    const leads = await prisma.leads.findMany({
      where:  { store_id, is_deleted: false, created_at: { gte: from, lt: end } },
      select: { canal: true, etape: true, motif_perte: true, montant: true, type_demande: true, cherche: true,
                marque: true, model: true, accessoire: true, created_by: true, created_at: true, closed_at: true },
    })
    const users = await prisma.user_profiles.findMany({ select: { id: true, display_name: true } })
    const userName = new Map(users.map(u => [u.id, u.display_name]))

    type Row = { total: number; gagne: number; perdu: number; ouverts: number; montant: number }
    const blank = (): Row => ({ total: 0, gagne: 0, perdu: 0, ouverts: 0, montant: 0 })
    const add = (r: Row, l: (typeof leads)[number]) => {
      r.total++
      if (l.etape === 'gagne') { r.gagne++; if (l.type_demande !== 'vente') r.montant += Number(l.montant ?? 0) }
      else if (l.etape === 'perdu') r.perdu++
      else r.ouverts++
    }
    const totals = blank()
    const byCanal = new Map<string, Row>(), byUser = new Map<string, Row>(), byType = new Map<string, Row>()
    const motifs = new Map<string, number>(), demandes = new Map<string, { n: number; gagne: number }>()
    let closeDays = 0, closedWon = 0
    for (const l of leads) {
      add(totals, l)
      for (const [map, key] of [[byCanal, l.canal], [byUser, l.created_by ?? '—'], [byType, l.type_demande]] as const) {
        if (!map.has(key)) map.set(key, blank())
        add(map.get(key)!, l)
      }
      if (l.etape === 'perdu' && l.motif_perte) motifs.set(l.motif_perte, (motifs.get(l.motif_perte) ?? 0) + 1)
      if (l.etape === 'gagne' && l.closed_at) { closeDays += (l.closed_at.getTime() - l.created_at.getTime()) / 86_400_000; closedWon++ }
      // What people ask for: "Apple 13", "Samsung", or the accessory
      if (l.type_demande === 'achat' || l.type_demande === 'reprise') {
        const what = l.cherche === 'accessoire'
          ? (l.accessoire ? `Accessoire : ${l.accessoire}` : null)
          : [l.marque, l.model].filter(Boolean).join(' ') || null
        if (what) {
          const k = what.trim().replace(/\s+/g, ' ')
          const d = demandes.get(k.toLowerCase()) ?? { n: 0, gagne: 0, label: k } as { n: number; gagne: number; label?: string }
          d.n++; if (l.etape === 'gagne') d.gagne++
          demandes.set(k.toLowerCase(), d)
        }
      }
    }
    const rate = (r: Row) => (r.gagne + r.perdu ? Math.round((r.gagne / (r.gagne + r.perdu)) * 100) : null)
    const rows = (m: Map<string, Row>, label?: (k: string) => string) =>
      [...m].map(([k, r]) => ({ key: k, label: label ? label(k) : k, ...r, montant: Math.round(r.montant), taux: rate(r) }))
        .sort((a, b) => b.total - a.total)

    // Still open today (whatever their start date), and what to follow up
    const [open, toFollow] = await Promise.all([
      prisma.leads.count({ where: { store_id, is_deleted: false, etape: { in: OPEN } } }),
      prisma.leads.count({ where: { store_id, is_deleted: false, etape: { in: OPEN }, relance_le: { lte: todayDate() } } }),
    ])

    return json({
      data: {
        from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
        totals: { ...totals, montant: Math.round(totals.montant), taux: rate(totals), delai_moyen: closedWon ? Math.round((closeDays / closedWon) * 10) / 10 : null },
        open_now: open, to_follow: toFollow,
        canaux: rows(byCanal),
        types: rows(byType),
        managers: rows(byUser, k => userName.get(k) ?? '—'),
        motifs: [...motifs].map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n),
        demandes: [...demandes.values()].map(d => ({ label: (d as { label?: string }).label ?? '', n: d.n, gagne: d.gagne })).sort((a, b) => b.n - a.n).slice(0, 15),
      },
    })
  } catch (err) {
    return handleError(err, 'GET /api/leads/stats')
  }
}
