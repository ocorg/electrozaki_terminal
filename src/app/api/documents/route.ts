import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, dateOnly, todayDate, HttpError } from '@/lib/api'

const TYPE_MAP: Record<string, { prefix: string; seq: string }> = {
  FAC: { prefix: 'EZ',  seq: 'ez_fac_seq' },
  RCH: { prefix: 'RCH', seq: 'ez_rch_seq' },
  ECH: { prefix: 'ECH', seq: 'ez_ech_seq' },
  PEC: { prefix: 'SAV', seq: 'ez_sav_seq' },
  RST: { prefix: 'RST', seq: 'ez_rst_seq' },
}

// ── GET /api/documents ────────────────────────────────────────────────────────
// Mode 1 : ?lookup_imei=XXXXXXX  → phone data (autocomplete)
// Mode 2 : filtered archive (type, search, from, to, limit)
export async function GET(request: Request) {
  try {
    await requireUser()
    const { searchParams } = new URL(request.url)
    const lookup_imei = searchParams.get('lookup_imei')

    if (lookup_imei) {
      const phone = await prisma.phones.findFirst({
        where: { imei: lookup_imei.trim(), store_id: 'EZ-001', is_deleted: false, status: { not: 'vendu' } },
        select: {
          phone_id: true, imei: true, marque: true, model: true, stockage: true, ram: true, couleur: true, condition: true,
          prix_vente_recommande: true, prix_vente_minimum: true, warranty_months: true,
          status: true, source: true, description: true, is_damaged: true, damage_notes: true, serie: true, type: true,
        },
      })
      return json({ status: 'success', data: phone })
    }

    const type   = searchParams.get('type')
    const search = searchParams.get('search')?.trim()
    const from   = searchParams.get('from')
    const to     = searchParams.get('to')
    const limit  = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)

    const data = await prisma.ez_documents.findMany({
      where: {
        store_id: 'EZ-001',
        ...(type && { doc_type: type }),
        ...((from || to) && { doc_date: { gte: dateOnly(from), lte: dateOnly(to) } }),
        ...(search && { OR: ['doc_ref', 'client_name', 'imei', 'device_label'].map(f => ({ [f]: { contains: search, mode: 'insensitive' } })) }),
      },
      select: {
        doc_id: true, doc_type: true, doc_ref: true, doc_date: true, client_name: true, client_tel: true,
        device_label: true, imei: true, montant: true, warranty_end: true, warranty_months: true,
        txn_id: true, phone_id: true, created_at: true, printed_at: true,
      },
      orderBy: { created_at: 'desc' },
      take:    limit,
    })
    return json({ status: 'success', data })
  } catch (err) {
    return handleError(err, 'GET /api/documents')
  }
}

// ── POST /api/documents ───────────────────────────────────────────────────────
// Creates the document and its reference when the user clicks "Imprimer".
// txn_id stays null here — set later by /confirm-sale.
export async function POST(request: Request) {
  try {
    const user = await requireActiveUser()
    const body = await request.json()
    const { doc_type } = body
    if (!doc_type || !TYPE_MAP[doc_type]) throw new HttpError(400, 'doc_type invalide')
    const { prefix, seq } = TYPE_MAP[doc_type]

    // Sequence-safe reference from the database (EZ-2026-000042)
    const [{ ref }] = await prisma.$queryRaw<{ ref: string }[]>`SELECT next_doc_ref(${prefix}, ${seq}) AS ref`

    const data = await prisma.ez_documents.create({
      data: {
        store_id:        'EZ-001',
        doc_type,
        doc_ref:         ref,
        doc_date:        todayDate(),
        phone_id:        body.phone_id        || null,
        client_id:       body.client_id       || null,
        client_name:     body.client_name     || null,
        client_tel:      body.client_tel      || null,
        client_cin:      body.client_cin      || null,
        device_label:    body.device_label    || null,
        imei:            body.imei            || null,
        montant:         body.montant         ?? null,
        warranty_months: body.warranty_months ?? null,
        warranty_start:  dateOnly(body.warranty_start) ?? null,
        warranty_end:    dateOnly(body.warranty_end)   ?? null,
        linked_doc_ref:  body.linked_doc_ref  || null,
        doc_data:        (body.doc_data ?? {}) as Prisma.InputJsonValue,
        created_by:      user.id,
      },
      select: { doc_id: true, doc_ref: true },
    })
    return json({ status: 'success', data })
  } catch (err) {
    return handleError(err, 'POST /api/documents')
  }
}
