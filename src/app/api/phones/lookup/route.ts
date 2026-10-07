import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { json, handleError, requireActiveUser } from '@/lib/api'
import { sameImei, inShop } from '@/lib/phoneExit'

// GET /api/phones/lookup?imei= — does the shop already know this phone?
// Used when a phone is taken back (POS trade-in): what does not change
// between two stays is pre-filled, to be corrected where it changed.
// Description only — never a price or a supplier (staff can call it).
export async function GET(request: NextRequest) {
  try {
    await requireActiveUser()
    const imei = (new URL(request.url).searchParams.get('imei') ?? '').replace(/\D/g, '')
    if (imei.length < 14) return json({ data: { known: false } })
    const records = await sameImei(prisma, imei)
    if (!records.length) return json({ data: { known: false } })
    const here = records.find(p => inShop(p.status))
    const p = here ?? records[0]
    const lastSale = here ? null : await prisma.transactions.findFirst({
      where:   { device_id: p.phone_id, device_type: 'telephone', voided: false },
      orderBy: { date_vente: 'desc' }, select: { date_vente: true },
    })
    return json({
      data: {
        known: true, in_shop: !!here,
        marque: p.marque, serie: p.serie, model: p.model, couleur: p.couleur, stockage: p.stockage, ram: p.ram,
        sold_on: lastSale?.date_vente?.toISOString().slice(0, 10) ?? null,
      },
    })
  } catch (err) {
    return handleError(err, 'GET /api/phones/lookup')
  }
}
