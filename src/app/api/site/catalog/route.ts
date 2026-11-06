import { json, handleError, requireUser, MANAGERS } from '@/lib/api'
import { site } from '@/lib/storefront/access'
import { prisma } from '@/lib/db'
import { refOf } from '@/lib/storefront/listing'

// GET — every website product (synced and hand-made) with what staff need to
// present it, plus the website's categories.
export async function GET() {
  try {
    await requireUser(MANAGERS)
    const db = site()
    const [products, categories, accIds] = await Promise.all([
      db.product.findMany({
        orderBy: [{ isPhone: 'desc' }, { name: 'asc' }],
        select: {
          id: true, slug: true, name: true, brand: true, isPhone: true, source: true, published: true,
          availability: true, condition: true, recommendedSalePrice: true, description: true,
          metaTitle: true, metaDescription: true, modelKey: true, categoryId: true, colorName: true, colorGroup: true, erpKey: true,
          category: { select: { name: true } },
          images:   { select: { url: true, colorName: true, designName: true, phoneShape: true }, orderBy: { sortOrder: 'asc' } },
          internal: { select: { stockQuantity: true } },
          variants: { select: { stockQuantity: true } },
          facets:   { select: { optionId: true, imageUrl: true } },
          _count:   { select: { compatibleAccessories: true } },
        },
      }),
      db.category.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select:  { id: true, name: true, slug: true, parentId: true, sortOrder: true, erpCode: true, _count: { select: { products: true, children: true } } },
      }),
      prisma.accessories.findMany({ select: { acc_id: true } }),
    ])
    // the ERP accessory behind a synced product: its fiche lives in
    // Stock → Accessoires (owner, 2026-11-06), the Catalogue opens it there
    const accOf = new Map(accIds.map(a => [refOf('acc', a.acc_id), a.acc_id]))
    return json({
      data: products.map(({ internal, variants, images, facets, _count, erpKey, ...p }) => ({
        ...p,
        accId:     !p.isPhone && erpKey ? accOf.get(erpKey) ?? null : null,
        images:    images.map(i => i.url),
        imageColors: images.map(i => i.colorName ?? ''),
        imageDesigns: images.map(i => i.designName ?? ''),
        imageShapes: images.map(i => i.phoneShape ?? ''),
        stock:     p.isPhone ? variants.reduce((n, v) => n + v.stockQuantity, 0) : internal?.stockQuantity ?? null,
        giftCount: _count.compatibleAccessories,
        facetIds:  facets.map(f => f.optionId),
        // this product's own photo of a ticked feature (Extras: its stand…)
        facetImages: Object.fromEntries(facets.filter(f => f.imageUrl).map(f => [f.optionId, f.imageUrl])),
      })),
      categories,
    })
  } catch (err) {
    return handleError(err, 'GET /api/site/catalog')
  }
}
