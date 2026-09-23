// End-to-end checks of the ERP → website link, against a running ERP dev server
// (default http://localhost:3100, override with E2E_BASE) whose env points at
// TEST database branches: DIRECT_URL (ERP) and STOREFRONT_DIRECT_URL (website).
//
//   node scripts/e2e-site-sync.mjs
//
// It refuses to run against the production databases: it reserves phones and
// creates orders. Everything it changes is put back at the end.
import 'dotenv/config'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100'
const PRODUCTION_HOSTS = ['ep-royal-cloud-b130i960', 'ep-still-tree-b1u5yng9'] // ERP, website
for (const [name, url] of [['DIRECT_URL', process.env.DIRECT_URL], ['STOREFRONT_DIRECT_URL', process.env.STOREFRONT_DIRECT_URL]]) {
  if (!url) { console.error(`${name} is not set`); process.exit(1) }
  if (PRODUCTION_HOSTS.some(h => url.includes(h))) { console.error(`${name} points at PRODUCTION — use a Neon test branch`); process.exit(1) }
}
if (!process.env.STOREFRONT_REF_SECRET) { console.error('STOREFRONT_REF_SECRET is not set'); process.exit(1) }

const erp = new pg.Client({ connectionString: process.env.DIRECT_URL })
const web = new pg.Client({ connectionString: process.env.STOREFRONT_DIRECT_URL })
await erp.connect(); await web.connect()

const refOf = (kind, value) => crypto.createHmac('sha256', process.env.STOREFRONT_REF_SECRET).update(`${kind}:${value}`).digest('base64url').slice(0, 22)
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms
  for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(500) }
}

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 300) })
const cleanups = []

async function login(email, password) {
  const jar = new Map()
  const absorb = (res) => { for (const c of res.headers.getSetCookie()) { const [p] = c.split(';'); const i = p.indexOf('='); jar.set(p.slice(0, i), p.slice(i + 1)) } }
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const csrf = await fetch(BASE + '/api/auth/csrf'); absorb(csrf)
  const { csrfToken } = await csrf.json()
  const res = await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1', cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password }),
  })
  absorb(res)
  return async (path, { method = 'GET', body } = {}) => {
    const r = await fetch(BASE + path, { method, redirect: 'manual', headers: { cookie: cookie(), ...(body && { 'content-type': 'application/json' }) }, body: body && JSON.stringify(body) })
    let data = null
    try { data = await r.json() } catch {}
    return { status: r.status, data }
  }
}

async function makeUser(role) {
  const password = crypto.randomBytes(12).toString('base64url')
  const email = `zz-e2e-site-${role}@migration.local`
  await erp.query(`delete from user_profiles where email = $1`, [email])
  const { rows: [u] } = await erp.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, null, false, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E site ${role}`, role])
  cleanups.push(async () => {
    await erp.query(`delete from activity_log where user_id = $1`, [u.id])
    await erp.query(`delete from user_profiles where id = $1`, [u.id])
  })
  return { id: u.id, api: await login(email, password) }
}

try {
  const manager  = await makeUser('gerant')
  const employee = await makeUser('employe')

  // ── 1. Full sync ────────────────────────────────────────────────────────
  const first = await manager.api('/api/site/sync', { method: 'POST' })
  check('sync: manager can run it', first.status === 200, first)
  const second = await manager.api('/api/site/sync', { method: 'POST' })
  check('sync: second run changes nothing (idempotent)', second.status === 200 && second.data.created === 0 && second.data.updated === 0 && second.data.removed === 0, second.data)

  const denied = await employee.api('/api/site/sync', { method: 'POST' })
  check('sync: employee refused (403)', denied.status === 403, denied)

  // ── 2. Nothing sensitive reaches the website ────────────────────────────
  const { rows: secrets } = await erp.query(`
    select phone_id, imei, icloud_compte, icloud_mdp, description, damage_notes, prix_achat::text, prix_vente_minimum::text
    from phones where not is_deleted`)
  const needles = new Set()
  for (const s of secrets) {
    needles.add(s.phone_id)
    for (const v of [s.imei, s.icloud_compte, s.icloud_mdp]) if (v && String(v).trim().length >= 4) needles.add(String(v).trim())
    for (const v of [s.description, s.damage_notes]) if (v && v.trim().length >= 12) needles.add(v.trim())
  }
  const { rows: accIds } = await erp.query(`select acc_id from accessories`)
  for (const a of accIds) needles.add(a.acc_id)

  const tables = ['Product', 'ProductVariant', 'ProductImage', 'ProductInternal', 'Category', 'ModelPhoto', 'OrderRequestItem']
  let dump = ''
  for (const t of tables) {
    const { rows } = await web.query(`select * from "${t}"`)
    dump += JSON.stringify(rows)
  }
  const leaks = [...needles].filter(n => dump.includes(n))
  check('leak scan: no IMEI / iCloud / ERP id / staff note anywhere in the website DB', leaks.length === 0, leaks.slice(0, 3).map(l => l.slice(0, 6) + '…'))
  const { rows: [cost] } = await web.query(`select count(*)::int n from "ProductInternal" i join "Product" p on p.id = i."productId" where p.source = 'ERP' and (i."purchasePrice" is not null or i."minSalePrice" is not null)`)
  check('leak scan: no cost / minimum price on synced products', cost.n === 0, cost)

  // ── 3. The site mirrors ERP stock ───────────────────────────────────────
  const { rows: [counts] } = await erp.query(`
    select count(*) filter (where condition = 'occasion')::int used, count(*) filter (where condition = 'neuf')::int new_
    from phones p left join stores s on s.store_id = p.store_id
    where p.status = 'disponible' and not p.is_deleted and p.is_damaged is not true and p.prix_vente_recommande is not null
      and (p.store_id is null or s.is_active)`)
  const { rows: [site] } = await web.query(`
    select coalesce(sum(v."stockQuantity"), 0)::int units, count(distinct p.id)::int products
    from "Product" p join "ProductVariant" v on v."productId" = p.id
    where p.source = 'ERP' and p."isPhone" and p.availability = 'IN_STOCK'`)
  check('stock: every sellable ERP phone is on the site', site.units === counts.used + counts.new_, { site, erp: counts })
  const { rows: [dmg] } = await erp.query(`select phone_id from phones where status = 'disponible' and is_damaged and not is_deleted limit 1`)
  if (dmg) {
    const { rows } = await web.query(`select 1 from "ProductVariant" where "erpRef" = $1`, [refOf('tel-unit', dmg.phone_id)])
    check('stock: damaged phones are not listed', rows.length === 0)
  }
  const { rows: [acc] } = await web.query(`select count(*)::int n, count(*) filter (where published)::int pub from "Product" where source = 'ERP' and not "isPhone"`)
  check('accessories: synced, hidden until staff publish them', acc.n > 0 && acc.pub === 0, acc)

  // ── 4. Live update after an ERP write (withNotify hook) ─────────────────
  const { rows: [unit] } = await erp.query(`
    select phone_id, prix_vente_recommande::float price, promo_type from phones
    where status = 'disponible' and condition = 'occasion' and not is_deleted and is_damaged is not true
      and prix_vente_recommande is not null and promo_type is null and store_id = 'EZ-001' limit 1`)
  const unitRef = refOf('tel-unit', unit.phone_id)
  cleanups.push(() => erp.query(`update phones set prix_vente_recommande = $2, status = 'disponible' where phone_id = $1`, [unit.phone_id, unit.price]))

  const edit = await manager.api('/api/phones', { method: 'PATCH', body: { phone_id: unit.phone_id, prix_vente_recommande: unit.price + 7 } })
  const repriced = await waitFor(async () => {
    const { rows: [v] } = await web.query(`select "priceOverride"::float p from "ProductVariant" where "erpRef" = $1`, [unitRef])
    return v?.p === unit.price + 7
  })
  check('live: a price edit in the ERP reaches the site by itself', edit.status === 200 && repriced, edit.status)
  await manager.api('/api/phones', { method: 'PATCH', body: { phone_id: unit.phone_id, prix_vente_recommande: unit.price } })

  // ── 5. Web order: confirm & reserve → till → cancel ─────────────────────
  const { rows: [variant] } = await web.query(`
    select v.id, v."productId", p.name from "ProductVariant" v join "Product" p on p.id = v."productId" where v."erpRef" = $1`, [unitRef])
  const orderId = `e2e${crypto.randomBytes(8).toString('hex')}`
  await web.query(`insert into "OrderRequest" (id, "customerName", "customerPhone", "totalEstimate", "updatedAt") values ($1, 'E2E Client', '0600000000', $2, now())`, [orderId, unit.price])
  await web.query(`insert into "OrderRequestItem" (id, "orderRequestId", "productId", "variantId", "unitRef", "productNameSnapshot", "priceAtRequest", quantity)
                   values ($1, $2, $3, $4, $5, $6, $7, 1)`, [`${orderId}i`, orderId, variant.productId, variant.id, unitRef, variant.name, unit.price])
  cleanups.push(() => web.query(`delete from "OrderRequest" where id = $1`, [orderId]))

  const list = await employee.api('/api/site/orders')
  check('orders: staff see the web order', list.status === 200 && list.data.data.some(o => o.id === orderId), list.status)
  const detail = await employee.api(`/api/site/orders/${orderId}`)
  check('orders: detail points at the exact ERP phone', detail.data?.data?.items?.[0]?.erpPhones?.[0]?.phone_id === unit.phone_id, detail.data?.data?.items?.[0]?.erpPhones)

  const reserve = await employee.api(`/api/site/orders/${orderId}/reserve`, { method: 'POST' })
  const { rows: [afterReserve] } = await erp.query(`select status from phones where phone_id = $1`, [unit.phone_id])
  check('orders: confirm & reserve sets the phone to reserve', reserve.status === 200 && afterReserve.status === 'reserve', { reserve: reserve.data, status: afterReserve.status })
  const gone = await waitFor(async () => (await web.query(`select 1 from "ProductVariant" where "erpRef" = $1`, [unitRef])).rows.length === 0)
  check('orders: the reserved phone leaves the site', gone)

  const again = await employee.api(`/api/site/orders/${orderId}/reserve`, { method: 'POST' })
  check('orders: confirming twice is harmless', again.status === 200 && again.data.reserved === 0, again.data)

  const checkout = await employee.api(`/api/site/orders/${orderId}/checkout`, { method: 'POST' })
  const { rows: [afterCheckout] } = await erp.query(`select status from phones where phone_id = $1`, [unit.phone_id])
  await manager.api('/api/site/sync', { method: 'POST' })
  const stillHidden = (await web.query(`select 1 from "ProductVariant" where "erpRef" = $1`, [unitRef])).rows.length === 0
  check('orders: "passer en caisse" makes it sellable at the POS but keeps it off the site', checkout.status === 200 && afterCheckout.status === 'disponible' && stillHidden, { status: afterCheckout.status, stillHidden })

  const release = await employee.api(`/api/site/orders/${orderId}/release`, { method: 'POST' })
  await manager.api('/api/site/sync', { method: 'POST' })
  const back = (await web.query(`select 1 from "ProductVariant" where "erpRef" = $1`, [unitRef])).rows.length === 1
  const { rows: [o] } = await web.query(`select status from "OrderRequest" where id = $1`, [orderId])
  check('orders: cancelling puts the phone back on the site', release.status === 200 && o.status === 'CANCELLED' && back, { order: o.status, back })

  // An order that never got confirmed must not free a phone someone else reserved
  await erp.query(`update phones set status = 'reserve' where phone_id = $1`, [unit.phone_id])
  const orderB = `e2e${crypto.randomBytes(8).toString('hex')}`
  await web.query(`insert into "OrderRequest" (id, "customerName", "customerPhone", "totalEstimate", "updatedAt") values ($1, 'E2E B', '0600000001', 1, now())`, [orderB])
  await web.query(`insert into "OrderRequestItem" (id, "orderRequestId", "productId", "unitRef", "productNameSnapshot", "priceAtRequest", quantity)
                   values ($1, $2, $3, $4, 'x', 1, 1)`, [`${orderB}i`, orderB, variant.productId, unitRef])
  cleanups.push(() => web.query(`delete from "OrderRequest" where id = $1`, [orderB]))
  await employee.api(`/api/site/orders/${orderB}/release`, { method: 'POST' })
  const { rows: [held] } = await erp.query(`select status from phones where phone_id = $1`, [unit.phone_id])
  check('orders: cancelling an unconfirmed order leaves other reservations alone', held.status === 'reserve', held)
  await erp.query(`update phones set status = 'disponible' where phone_id = $1`, [unit.phone_id])

  // ── 6. Permissions on the catalogue ─────────────────────────────────────
  const { rows: [anyProduct] } = await web.query(`select id from "Product" where source = 'ERP' limit 1`)
  const empEdit = await employee.api(`/api/site/catalog/${anyProduct.id}`, { method: 'PATCH', body: { description: 'x' } })
  check('catalogue: employee cannot edit (403)', empEdit.status === 403, empEdit)
  const cron = await fetch(BASE + '/api/cron/site-sync')
  check('cron: refused without CRON_SECRET', cron.status === 401, String(cron.status))
  const anon = await fetch(BASE + '/api/site/orders', { redirect: 'manual' })
  check('orders: signed-out request refused', anon.status === 307 || anon.status === 401, String(anon.status))
} catch (err) {
  check('script ran to the end', false, String(err?.stack ?? err))
} finally {
  for (const fn of cleanups.reverse()) { try { await fn() } catch (e) { console.error('cleanup:', e.message) } }
  await erp.end(); await web.end()
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  → ${r.detail}`}`)
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
