import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, pickInput, todayDate, HttpError, MANAGERS, isManager } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { validateRequired, sanitizeText } from '@/lib/utils/validation'
import { withNotify } from '@/lib/realtime'
import { attachTradeIn, phonesSoldWithTradeIn } from '@/lib/tradeinChain'
import { payFromDrawer } from '@/lib/stockPurchase'
import { assertManualStatus } from '@/lib/phoneExit'
import { sameImei, inShop } from '@/lib/phoneExit'
import { codeLabel } from '@/lib/codes'

// Hidden from staff: purchase price, iCloud password, settlement and audit fields
const STAFF_OMIT = {
  icloud_mdp: true, prix_achat: true, created_by: true, updated_by: true,
  is_deleted: true, settled_at: true, settled_by: true, du_fournisseur: true,
} as const

const EDITABLE = [
  'imei', 'source', 'fournisseur_id', 'txn_ref_id', 'condition',
  'marque', 'serie', 'type', 'couleur', 'model', 'stockage',
  'battery_level', 'ram', 'description', 'icloud_compte', 'icloud_mdp',
  'prix_achat', 'prix_vente_recommande', 'prix_vente_minimum',
  'warranty_months', 'status', 'location', 'date_entree', 'image_url',
  'replaced_components', 'is_damaged', 'damage_notes',
  'promo_type', 'promo_montant',
] as const

// What staff may fill or change (owner's rules, 2026-10-01): the phone's
// details — never its prices, status (only a POS sale makes it "vendu"),
// promo, supplier or iCloud password.
const STAFF_EDITABLE = [
  'imei', 'condition', 'marque', 'serie', 'type', 'couleur', 'model', 'stockage',
  'battery_level', 'ram', 'description', 'icloud_compte', 'warranty_months',
  'location', 'image_url', 'replaced_components', 'is_damaged', 'damage_notes',
] as const

const clean = (v: unknown) => (typeof v === 'string' ? sanitizeText(v) : v)

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()
    const { searchParams } = new URL(request.url)
    const status         = searchParams.get('status') as Prisma.phonesWhereInput['status']
    const marque         = searchParams.get('marque')
    const location       = searchParams.get('location') as Prisma.phonesWhereInput['location']
    const stockage       = searchParams.get('stockage')
    const promo          = searchParams.get('promo')
    const search         = searchParams.get('search')?.trim()
    const store_id       = searchParams.get('store_id')
    const fournisseur_id = searchParams.get('fournisseur_id')
    const limit          = Math.min(parseInt(searchParams.get('limit') || '200', 10), 5000)

    const where: Prisma.phonesWhereInput = {
      is_deleted: false,
      ...(store_id       && { store_id }),
      ...(status         && { status }),
      ...(marque         && { marque: { contains: marque, mode: 'insensitive' } }),
      ...(location       && { location }),
      ...(stockage       && { stockage }),
      ...(fournisseur_id && { fournisseur_id }),
      ...(promo === '1'  && { promo_type: { not: null } }),
    }
    // A phone that came back has a record per stay; the list shows the current
    // one only (owner, 2026-10-08) — the earlier stays are in its history. A
    // supplier's own list keeps them: that is where an old sale is settled.
    if (!fournisseur_id) {
      const later = await prisma.phones.findMany({ where: { vie_precedente_id: { not: null }, is_deleted: false }, select: { vie_precedente_id: true } })
      if (later.length) where.phone_id = { notIn: later.map(p => p.vie_precedente_id!) }
    }
    if (search) {
      where.OR = /^\d{6,}$/.test(search)
        ? [{ imei: { contains: search } }]
        : [{ model: { contains: search, mode: 'insensitive' } }, { marque: { contains: search, mode: 'insensitive' } }]
    }

    const data = await prisma.phones.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take:    limit,
      ...(!MANAGERS.includes(user.role) && { omit: STAFF_OMIT }),
    })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/phones')
  }
}

async function POST_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json() as Record<string, unknown>
    // Staff: the phone a customer traded in at the POS (its value was part
    // of the sale they just made) as before; any other phone they add gets
    // its details only — prices and supplier are completed by a manager.
    const staffEntry = !isManager(user.role) && body.source !== 'echange'
    if (staffEntry) body.status = 'disponible'
    validateRequired(body, ['marque', 'model', 'status'])
    // A phone enters the stock; it leaves it through a sale, a credit file or The Void
    if (['vendu', 'reserve', 'void'].includes(String(body.status))) throw new HttpError(400, 'Un téléphone s’ajoute « disponible » (ou en réparation) : la vente se fait ensuite')

    const input = staffEntry
      ? { ...pickInput('phones', body, STAFF_EDITABLE), status: 'disponible', source: 'fournisseur' }
      : pickInput('phones', body, EDITABLE)
    // A phone traded in at a POS sale joins the supplier of the phone it paid
    // for (lib/tradeinChain) — its supplier is never typed by hand
    const tradeInOf = body.source === 'echange' && typeof body.txn_ref_id === 'string' ? body.txn_ref_id : null
    if (tradeInOf) delete (input as Record<string, unknown>).fournisseur_id

    // A phone that comes back (sold long ago, taken back): a new record for its
    // second life, linked to the old one, which keeps its sale. Never two
    // records of the same IMEI in the shop at once.
    const fields = input as Record<string, unknown>
    if (typeof fields.imei === 'string') fields.imei = fields.imei.trim() || null
    const earlier = await sameImei(prisma, fields.imei as string | null)
    const stillHere = earlier.find(p => inShop(p.status))
    if (stillHere) throw new HttpError(409, `Ce téléphone est déjà au magasin (« ${codeLabel('device_status', stillHere.status, 'fr')} », entré le ${stillHere.date_entree?.toISOString().slice(0, 10) ?? '?'}) : pas de deuxième fiche`)
    const previous = earlier[0] ?? null
    if (previous) {
      // what does not change between two lives fills what was left empty
      const blank = (v: unknown) => v === null || v === undefined || v === '' || v === 'Inconnu'
      for (const k of ['marque', 'serie', 'couleur', 'stockage', 'ram', 'type'] as const) {
        if (blank(fields[k]) && previous[k] != null) fields[k] = previous[k]
      }
    }
    const { data, chain } = await prisma.$transaction(async (tx) => {
      const created = await tx.phones.create({
        data: {
          ...(input as Prisma.phonesUncheckedCreateInput),
          marque:      clean(input.marque) as string,
          model:       clean(input.model) as string,
          description: clean(input.description) as string | null | undefined,
          date_entree: (input.date_entree as Date | null | undefined) ?? todayDate(),
          vie_precedente_id: previous?.phone_id ?? null,
          store_id:    (body.store_id as string | undefined) ?? user.store_id ?? null,
          created_by:  user.id,
          updated_by:  user.id,
        },
      })
      // Bought with the drawer's cash (managers): leaves the day's caisse
      if (isManager(user.role) && !tradeInOf) {
        await payFromDrawer(tx, { amount: body.paye_caisse, label: `Achat ${created.phone_id} — ${created.marque} ${created.model}`, storeId: created.store_id, userId: user.id })
      }
      if (!tradeInOf) return { data: created, chain: null }
      const soldIds = Array.isArray(body.tradein_for) ? (body.tradein_for as unknown[]).map(String) : undefined
      const sale = await phonesSoldWithTradeIn(tx, tradeInOf, soldIds)
      const chain = await attachTradeIn(tx, { tradeInId: created.phone_id, soldPhoneIds: sale.phoneIds, value: sale.value, userId: user.id })
      // The sale has a credit file: this is its trade-in (not created again at discharge)
      await tx.phone_credit_sales.updateMany({
        where: { txn_id: tradeInOf, has_reprise: true, reprise_phone_id: null, is_deleted: false },
        data:  { reprise_phone_id: created.phone_id, reprise_remise: true },
      })
      return { data: chain ? await tx.phones.findUniqueOrThrow({ where: { phone_id: created.phone_id } }) : created, chain }
    })

    await logActivity({
      store_id:    data.store_id,
      user_id:     user.id,
      user_name:   user.display_name,
      action_type: 'creation',
      module:      'telephones',
      record_id:   data.phone_id,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      ...(chain && { notes: `Reprise rattachée au fournisseur ${chain.supplier} (échange de ${chain.from}, ${chain.moved} DH)` }),
    })
    if (previous) {
      await logActivity({
        store_id: data.store_id, user_id: user.id, user_name: user.display_name, action_type: 'modification', module: 'telephones',
        record_id: previous.phone_id, ip_address: getIpFromRequest(request),
        notes: `Revenu au magasin le ${todayDate().toISOString().slice(0, 10)} : nouvelle fiche ${data.phone_id} (deuxième vie)`,
      })
    }

    // Staff never get purchase price / supplier amounts back
    const out = isManager(user.role) ? data : Object.fromEntries(Object.entries(data).filter(([k]) => !(k in STAFF_OMIT)))
    return json({ data: out, ...(previous && { previous: { phone_id: previous.phone_id, status: previous.status } }) }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/phones')
  }
}

async function PATCH_(request: NextRequest) {
  try {
    const user = await requireActiveUser()
    const body = await request.json() as Record<string, unknown>
    const phone_id = body.phone_id as string | undefined
    if (!phone_id) throw new HttpError(400, 'phone_id requis')

    const before = await prisma.phones.findUniqueOrThrow({ where: { phone_id } })
    const manager = isManager(user.role)
    // Staff change details of phones still in stock; other fields are ignored
    if (!manager && (before.is_deleted || before.status === 'vendu')) {
      throw new HttpError(403, 'Un téléphone vendu ne peut être modifié que par un gérant')
    }
    const input = manager ? pickInput('phones', body, [...EDITABLE, 'store_id']) : pickInput('phones', body, STAFF_EDITABLE)
    // "Vendu", "Réservé" and "The Void" come from a real operation, never from a list
    if (manager && typeof input.status === 'string') await assertManualStatus(prisma, before, input.status)
    if (!manager && !Object.keys(input).length) throw new HttpError(403, 'Réservé aux gérants : prix, statut et promotions')
    const data = await prisma.phones.update({
      where: { phone_id },
      data:  { ...input, updated_by: user.id },
      ...(!manager && { omit: STAFF_OMIT }),
    })

    await logActivity({
      store_id:     data.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'modification',
      module:       'telephones',
      record_id:    phone_id,
      before_state: before,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/phones')
  }
}

async function DELETE_(request: NextRequest) {
  try {
    const user = await requireActiveUser(MANAGERS)
    const phone_id = new URL(request.url).searchParams.get('phone_id')
    if (!phone_id) throw new HttpError(400, 'phone_id requis')

    const before = await prisma.phones.findUnique({ where: { phone_id } })
    if (!before) throw new HttpError(404, 'Téléphone introuvable')

    await prisma.phones.update({ where: { phone_id }, data: { is_deleted: true, updated_by: user.id } })

    await logActivity({
      store_id:     before.store_id,
      user_id:      user.id,
      user_name:    user.display_name,
      action_type:  'suppression',
      module:       'telephones',
      record_id:    phone_id,
      before_state: before,
      ip_address:   getIpFromRequest(request),
    })

    return json({ status: 'success' })
  } catch (err) {
    return handleError(err, 'DELETE /api/phones')
  }
}

export const POST = withNotify(POST_)
export const PATCH = withNotify(PATCH_)
export const DELETE = withNotify(DELETE_)
