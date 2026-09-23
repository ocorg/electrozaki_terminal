import { json, handleError, requireUser } from '@/lib/api'
import { site } from '@/lib/storefront/access'

// GET — every website product (synced and hand-made) with what staff need to
// present it, plus the website's categories.
export async function GET() {
  try {
    await requireUser()
    const db = site()
    const [products, categories] = await Promise.all([
      db.product.findMany({
        orderBy: [{ isPhone: 'desc' }, { name: 'asc' }],
        select: {
          id: true, slug: true, name: true, brand: true, isPhone: true, source: true, published: true,
          availability: true, condition: true, recommendedSalePrice: true, description: true,
          metaTitle: true, metaDescription: true, modelKey: true, categoryId: true,
          category: { select: { name: true } },
          images:   { select: { url: true }, orderBy: { sortOrder: 'asc' } },
          internal: { select: { stockQuantity: true } },
          variants: { select: { stockQuantity: true } },
          _count:   { select: { compatibleAccessories: true } },
        },
      }),
      db.category.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select:  { id: true, name: true, slug: true, parentId: true, sortOrder: true, erpCode: true, _count: { select: { products: true, children: true } } },
      }),
    ])
    return json({
      data: products.map(({ internal, variants, images, _count, ...p }) => ({
        ...p,
        images:    images.map(i => i.url),
        stock:     p.isPhone ? variants.reduce((n, v) => n + v.stockQuantity, 0) : internal?.stockQuantity ?? null,
        giftCount: _count.compatibleAccessories,
      })),
      categories,
    })
  } catch (err) {
    return handleError(err, 'GET /api/site/catalog')
  }
}
