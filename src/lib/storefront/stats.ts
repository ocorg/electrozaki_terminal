import { Prisma, type PrismaClient } from '@/generated/storefront/client'

// The website's statistics for "Site web → Statistiques": visits, pages,
// sources, loading time, sales funnel, cart values, searches and robots.
// Read straight from the website database (anonymous events written by the
// site, see its app/api/a/route.ts). Read-only.

const RANGES = [7, 30, 90, 365]
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)))

type Db = PrismaClient

async function kpis(db: Db, from: Date, to: Date) {
  const [e] = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT
      count(*) FILTER (WHERE type = 'view')                                          AS views,
      count(DISTINCT "visitorHash") FILTER (WHERE type = 'view')                     AS visitors,
      count(DISTINCT "visitorHash") FILTER (WHERE type = 'view' AND path LIKE '/products/%') AS product_viewers,
      count(DISTINCT "visitorHash") FILTER (WHERE type = 'add_to_cart')              AS cart_visitors,
      count(*) FILTER (WHERE type = 'add_to_cart')                                   AS adds,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "loadMs") FILTER (WHERE "loadMs" IS NOT NULL) AS load_p50
    FROM "AnalyticsEvent" WHERE "createdAt" >= ${from} AND "createdAt" < ${to}`
  // A visit = views from one visitor with less than 30 minutes between them.
  const [s] = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT count(*) FILTER (WHERE prev IS NULL OR "createdAt" - prev > interval '30 minutes') AS sessions
    FROM (
      SELECT "createdAt", lag("createdAt") OVER (PARTITION BY "visitorHash" ORDER BY "createdAt") AS prev
      FROM "AnalyticsEvent" WHERE type = 'view' AND "createdAt" >= ${from} AND "createdAt" < ${to}
    ) v`
  const [o] = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT
      count(*)                                                        AS orders,
      count(*) FILTER (WHERE status <> 'CANCELLED')                   AS orders_kept,
      count(*) FILTER (WHERE status = 'CONFIRMED')                    AS orders_confirmed,
      count(*) FILTER (WHERE status = 'CANCELLED')                    AS orders_cancelled,
      avg("totalEstimate") FILTER (WHERE status <> 'CANCELLED')       AS avg_order,
      coalesce(sum("totalEstimate") FILTER (WHERE status = 'CONFIRMED'), 0) AS confirmed_value
    FROM "OrderRequest" WHERE "createdAt" >= ${from} AND "createdAt" < ${to}`
  // What a visitor put in the cart, per visitor and day.
  const [c] = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT avg(total) AS avg_cart FROM (
      SELECT sum(value) AS total FROM "AnalyticsEvent"
      WHERE type = 'add_to_cart' AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY "visitorHash"
    ) t`
  const [b] = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT
      coalesce(sum(count) FILTER (WHERE category NOT IN ('probe', 'blocked')), 0) AS bots,
      coalesce(sum(count) FILTER (WHERE category = 'probe'), 0)                   AS probes,
      coalesce(sum(count) FILTER (WHERE category = 'blocked'), 0)                 AS blocked
    FROM "BotHit" WHERE day >= ${from}::date AND day < ${to}::date`
  return {
    views: n(e.views), visitors: n(e.visitors), sessions: n(s.sessions),
    productViewers: n(e.product_viewers), cartVisitors: n(e.cart_visitors), adds: n(e.adds),
    loadP50: nOrNull(e.load_p50),
    orders: n(o.orders), ordersKept: n(o.orders_kept), ordersConfirmed: n(o.orders_confirmed),
    ordersCancelled: n(o.orders_cancelled), avgOrder: nOrNull(o.avg_order), confirmedValue: n(o.confirmed_value),
    avgCart: nOrNull(c.avg_cart),
    bots: n(b.bots), probes: n(b.probes), blocked: n(b.blocked),
  }
}

/** Statistics over the last `asked` days (7, 30, 90 or 365; else 30), with the previous period for comparison. */
export async function siteStats(db: Db, asked: number) {
  const days = RANGES.includes(asked) ? asked : 30

  const to       = new Date()
  const from     = new Date(to.getTime() - days * 86_400_000)
  const prevFrom = new Date(from.getTime() - days * 86_400_000)
  const bucket   = Prisma.raw(days > 90 ? `'week'` : `'day'`)
  const range    = Prisma.sql`"createdAt" >= ${from} AND "createdAt" < ${to}`

  const [current, previous, series, pages, sources, devices, loads, slowPages, adds, searches, noResults, botKinds, botNames, blocked] =
    await Promise.all([
      kpis(db, from, to),
      kpis(db, prevFrom, from),
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT date_trunc(${bucket}, "createdAt")::date AS d, count(*) AS views, count(DISTINCT "visitorHash") AS visitors
        FROM "AnalyticsEvent" WHERE type = 'view' AND ${range} GROUP BY 1 ORDER BY 1`,
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT path, count(*) AS views, count(DISTINCT "visitorHash") AS visitors
        FROM "AnalyticsEvent" WHERE type = 'view' AND ${range} GROUP BY path ORDER BY views DESC LIMIT 15`,
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT source AS key, count(DISTINCT "visitorHash") AS visitors
        FROM "AnalyticsEvent" WHERE type = 'view' AND ${range} GROUP BY source ORDER BY visitors DESC`,
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT device AS key, count(DISTINCT "visitorHash") AS visitors
        FROM "AnalyticsEvent" WHERE type = 'view' AND ${range} GROUP BY device ORDER BY visitors DESC`,
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT count(*) AS measured,
               percentile_cont(0.5)  WITHIN GROUP (ORDER BY "loadMs") AS p50,
               percentile_cont(0.75) WITHIN GROUP (ORDER BY "loadMs") AS p75,
               count(*) FILTER (WHERE "loadMs" > 3000) AS slow,
               count(*) FILTER (WHERE device = 'mobile') AS mobile_measured,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "loadMs") FILTER (WHERE device = 'mobile') AS mobile_p50
        FROM "AnalyticsEvent" WHERE type = 'view' AND "loadMs" IS NOT NULL AND ${range}`,
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT path, count(*) AS measured, percentile_cont(0.5) WITHIN GROUP (ORDER BY "loadMs") AS p50
        FROM "AnalyticsEvent" WHERE type = 'view' AND "loadMs" IS NOT NULL AND ${range}
        GROUP BY path HAVING count(*) >= 3 ORDER BY p50 DESC LIMIT 5`,
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT "productId" AS id, count(*) AS adds, count(DISTINCT "visitorHash") AS visitors
        FROM "AnalyticsEvent" WHERE type = 'add_to_cart' AND "productId" IS NOT NULL AND ${range}
        GROUP BY "productId" ORDER BY adds DESC LIMIT 10`,
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT query, count(*) AS times, max(results) AS results
        FROM "AnalyticsEvent" WHERE type = 'search' AND query IS NOT NULL AND ${range}
        GROUP BY query ORDER BY times DESC LIMIT 15`,
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT query, count(*) AS times
        FROM "AnalyticsEvent" WHERE type = 'search' AND results = 0 AND query IS NOT NULL AND ${range}
        GROUP BY query ORDER BY times DESC LIMIT 15`,
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT category AS key, sum(count) AS hits
        FROM "BotHit" WHERE day >= ${from}::date GROUP BY category ORDER BY hits DESC`,
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT category, name, sum(count) AS hits
        FROM "BotHit" WHERE day >= ${from}::date AND category NOT IN ('probe', 'blocked')
        GROUP BY category, name ORDER BY hits DESC LIMIT 12`,
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT category, name, sum(count) AS hits
        FROM "BotHit" WHERE day >= ${from}::date AND category IN ('probe', 'blocked')
        GROUP BY category, name ORDER BY hits DESC LIMIT 10`,
    ])

  // Page paths → readable names (product, category, promo page).
  const slugOf = (prefix: string) => pages.concat(slowPages)
    .map(p => String(p.path)).filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length).split('/')[0])
  const [products, categories, landings, cartProducts] = await Promise.all([
    db.product.findMany({ where: { slug: { in: slugOf('/products/') } }, select: { slug: true, name: true } }),
    db.category.findMany({ where: { slug: { in: slugOf('/collections/') } }, select: { slug: true, name: true } }),
    db.landingPage.findMany({ where: { slug: { in: slugOf('/offres/') } }, select: { slug: true, title: true } }),
    db.product.findMany({ where: { id: { in: adds.map(a => String(a.id)) } }, select: { id: true, name: true, slug: true } }),
  ])
  const names = new Map<string, string>([
    ['/', 'Accueil'], ['/cart', 'Panier'], ['/search', 'Recherche'], ['/contact', 'Contact'],
    ['/reparation', 'Réparation'], ['/reparation/suivi', 'Suivi de réparation'],
    ...products.map(p => [`/products/${p.slug}`, p.name] as [string, string]),
    ...categories.map(c => [`/collections/${c.slug}`, c.name] as [string, string]),
    ...landings.map(l => [`/offres/${l.slug}`, `Promo : ${l.title}`] as [string, string]),
  ])
  const label = (path: string) => names.get(path) ?? path
  const productName = new Map(cartProducts.map(p => [p.id, p.name]))
  const load = loads[0] ?? {}

  return {
    data: {
      days,
      bucket: days > 90 ? 'week' : 'day',
      current,
      previous,
      series: series.map(r => ({ day: new Date(r.d as Date).toISOString().slice(0, 10), views: n(r.views), visitors: n(r.visitors) })),
      pages: pages.map(r => ({ path: String(r.path), label: label(String(r.path)), views: n(r.views), visitors: n(r.visitors) })),
      sources: sources.map(r => ({ key: String(r.key), visitors: n(r.visitors) })),
      devices: devices.map(r => ({ key: String(r.key), visitors: n(r.visitors) })),
      load: {
        measured: n(load.measured), p50: nOrNull(load.p50), p75: nOrNull(load.p75), slow: n(load.slow),
        mobileP50: nOrNull(load.mobile_p50),
      },
      slowPages: slowPages.map(r => ({ label: label(String(r.path)), p50: nOrNull(r.p50), measured: n(r.measured) })),
      cartProducts: adds.map(r => ({ name: productName.get(String(r.id)) ?? '(produit retiré)', adds: n(r.adds), visitors: n(r.visitors) })),
      searches: searches.map(r => ({ query: String(r.query), times: n(r.times), results: n(r.results) })),
      noResults: noResults.map(r => ({ query: String(r.query), times: n(r.times) })),
      bots: {
        kinds: botKinds.map(r => ({ key: String(r.key), hits: n(r.hits) })),
        names: botNames.map(r => ({ category: String(r.category), name: String(r.name), hits: n(r.hits) })),
        stopped: blocked.map(r => ({ category: String(r.category), name: String(r.name), hits: n(r.hits) })),
      },
    },
  }
}
