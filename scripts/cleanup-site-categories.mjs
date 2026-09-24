// One-off cleanup of the website catalogue (owner's decision, 2026-09-24):
//  1. Merge the categories the ERP sync created into the site's original ones
//     (the original keeps its name/URL and becomes the one the sync feeds):
//       Pochette → Pochettes, Cable → Câbles, Chargeurs → Chargeurs,
//       Écouteurs → Écouteurs, Glass → Incassables
//  2. Delete the demo products the site was seeded with (source MANUAL) —
//     except any that an order still refers to.
//  3. Delete the synced "Service" items and category (no longer synced).
//
//   node scripts/cleanup-site-categories.mjs            → shows the plan only
//   node scripts/cleanup-site-categories.mjs --apply    → applies it (one transaction)
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const url = process.env.STOREFRONT_DIRECT_URL
  ?? fs.readFileSync('../electrozaki-storefront/.env', 'utf8').match(/^DATABASE_URL_UNPOOLED="?([^"\n]+)/m)?.[1]
if (!url) { console.error('No website database URL'); process.exit(1) }
const apply = process.argv.includes('--apply')

const MERGES = [
  { from: 'pochette',  into: 'pochettes' },   // erpCode → slug of the original category
  { from: 'cable',     into: 'cables' },
  { from: 'chargeurs', into: 'chargeurs' },
  { from: 'ecouteurs', into: 'ecouteurs' },
  { from: 'glass',     into: 'incassables' },
]

const db = new pg.Client({ connectionString: url })
await db.connect()
const q = async (sql, params = []) => (await db.query(sql, params)).rows

try {
  await db.query('begin')

  for (const m of MERGES) {
    const [src] = await q(`select id, name from "Category" where "erpCode" = $1`, [m.from])
    const [dst] = await q(`select id, name, "erpCode" from "Category" where slug = $1`, [m.into])
    if (!src || !dst || src.id === dst.id) { console.log(`skip ${m.from} → ${m.into} (already done or missing)`); continue }
    const [{ n }] = await q(`select count(*)::int n from "Product" where "categoryId" = $1`, [src.id])
    console.log(`merge « ${src.name} » (${n} products) → « ${dst.name} »`)
    await q(`update "Product" set "categoryId" = $1 where "categoryId" = $2`, [dst.id, src.id])
    await q(`update "LandingPage" set "categoryId" = $1 where "categoryId" = $2`, [dst.id, src.id])
    await q(`update "Category" set "erpCode" = null where id = $1`, [src.id])
    await q(`update "Category" set "erpCode" = $1 where id = $2`, [m.from, dst.id])
    await q(`delete from "Category" where id = $1`, [src.id])
  }

  const demo = await q(`
    select p.id, p.name from "Product" p
    where p.source = 'MANUAL' and not exists (select 1 from "OrderRequestItem" i where i."productId" = p.id)`)
  const kept = await q(`
    select p.name from "Product" p
    where p.source = 'MANUAL' and exists (select 1 from "OrderRequestItem" i where i."productId" = p.id)`)
  console.log(`delete ${demo.length} demo products${kept.length ? ` (kept, referenced by orders: ${kept.map(k => k.name).join(', ')})` : ''}`)
  if (demo.length) {
    const ids = demo.map(d => d.id)
    await q(`delete from "BundleItem" where "productId" = any($1)`, [ids])
    await q(`delete from "Product" where id = any($1)`, [ids]) // images, variants, compat, internal cascade
  }

  const [service] = await q(`select id from "Category" where "erpCode" = 'service'`)
  if (service) {
    const items = await q(`
      select p.id from "Product" p where p."categoryId" = $1
      and not exists (select 1 from "OrderRequestItem" i where i."productId" = p.id)`, [service.id])
    console.log(`delete ${items.length} service items and the Service category`)
    await q(`delete from "BundleItem" where "productId" = any($1)`, [items.map(i => i.id)])
    await q(`delete from "Product" where id = any($1)`, [items.map(i => i.id)])
    const [{ left }] = await q(`select count(*)::int "left" from "Product" where "categoryId" = $1`, [service.id])
    if (left === 0) await q(`delete from "Category" where id = $1`, [service.id])
    else console.log(`  Service category kept: ${left} item(s) are referenced by orders`)
  }

  const cats = await q(`
    select c.name, c."erpCode", count(p.id)::int n from "Category" c
    left join "Product" p on p."categoryId" = c.id group by c.id order by c.name`)
  console.log('\ncategories after:', cats.map(c => `${c.name}${c.erpCode ? ` [${c.erpCode}]` : ''} (${c.n})`).join(', '))

  if (apply) { await db.query('commit'); console.log('\nAPPLIED') }
  else { await db.query('rollback'); console.log('\nDry run only — nothing changed. Re-run with --apply.') }
} catch (err) {
  await db.query('rollback')
  console.error('FAILED, nothing changed:', err.message)
  process.exitCode = 1
} finally {
  await db.end()
}
