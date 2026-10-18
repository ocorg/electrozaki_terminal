import { NextRequest } from 'next/server'
import type { Prisma, lead_canal, lead_etape } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, dateOnly, todayDate, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'
import { OPEN, phoneKey, pseudoKey } from '@/lib/leads'
import { leadInput } from '@/lib/leadsServer'

// CRM leads — managers and owner only (owner, 2026-10-18). Rules: lib/leads.ts
// Typed by hand; the outcome (won / lost) goes through PATCH /api/leads/[id].

// GET ?store_id=&etape=ouverts|<etape>&canal=&q=&relance=1&contact=<phone or @>
export async function GET(request: NextRequest) {
  try {
    await requireUser(MANAGERS)
    const sp       = new URL(request.url).searchParams
    const store_id = sp.get('store_id')
    const etape    = sp.get('etape')
    const canal    = sp.get('canal') as lead_canal | null
    const q        = (sp.get('q') ?? '').trim().slice(0, 60)
    const contact  = sp.get('contact')

    const where: Prisma.leadsWhereInput = {
      is_deleted: false,
      ...(store_id && { store_id }),
      ...(etape === 'ouverts' ? { etape: { in: OPEN } } : etape ? { etape: etape as lead_etape } : {}),
      ...(canal && { canal }),
      ...(sp.get('relance') === '1' && { relance_le: { lte: todayDate() }, etape: { in: OPEN } }),
    }
    if (contact) {
      // Has this person written before? Same number, or same @name
      const digits = phoneKey(contact), handle = pseudoKey(contact)
      where.OR = [
        ...(digits.length === 9 ? [{ telephone: { endsWith: digits } }] : []),
        ...(handle.length >= 2 ? [{ pseudo: { equals: handle, mode: 'insensitive' as const } }] : []),
      ]
      if (!where.OR.length) return json({ data: [] })
    } else if (q) {
      const words = q.split(/\s+/).filter(Boolean).slice(0, 4)
      where.AND = words.map(w => ({
        OR: ['nom', 'pseudo', 'telephone', 'marque', 'model', 'accessoire', 'leur_model', 'details', 'lead_id']
          .map(f => ({ [f]: { contains: w.replace(/^@/, ''), mode: 'insensitive' } })),
      }))
    }

    const data = await prisma.leads.findMany({
      where,
      include: { _count: { select: { lead_notes: true } } },
      orderBy: [{ updated_at: 'desc' }],
      take: 500,
    })
    return json({ data: data.map(({ _count, ...l }) => ({ ...l, nb_notes: _count.lead_notes })) })
  } catch (err) {
    return handleError(err, 'GET /api/leads')
  }
}

async function POST_(request: NextRequest) {
  try {
    const user  = await requireActiveUser(MANAGERS)
    const body  = await request.json() as Record<string, unknown>
    const input = leadInput(body)
    if (!input.canal) throw new HttpError(400, 'Canal obligatoire')
    if (!input.nom && !input.pseudo && !input.telephone) throw new HttpError(400, 'Nom, @ ou numéro : au moins un des trois')
    const etape = body.etape === 'attente_stock' ? 'attente_stock' : body.etape === 'en_discussion' ? 'en_discussion' : 'nouveau'
    const note  = typeof body.note === 'string' ? body.note.trim() : ''

    const data = await prisma.leads.create({
      data: {
        ...(input as Prisma.leadsUncheckedCreateInput),
        store_id:   String(body.store_id ?? user.store_id ?? 'EZ-001'),
        etape,
        relance_le: dateOnly(body.relance_le) ?? null,
        created_by: user.id,
        updated_by: user.id,
        ...(note && { lead_notes: { create: { texte: note.slice(0, 1000), created_by: user.id } } }),
      },
    })

    await logActivity({
      store_id: data.store_id, user_id: user.id, user_name: user.display_name, action_type: 'creation',
      module: 'prospects', record_id: data.lead_id, after_state: data, ip_address: getIpFromRequest(request),
      notes: `Lead ${data.lead_id} — ${data.canal}`,
    })
    return json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/leads')
  }
}

export const POST = withNotify(POST_)
