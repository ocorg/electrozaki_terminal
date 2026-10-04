// End-to-end checks of the website notifications against a running ERP dev
// server (default http://localhost:3100) whose env points at TEST branches:
// DIRECT_URL (ERP) and STOREFRONT_DIRECT_URL (website).
//
// Owner's rules (2026-10-04): a new web order or request is announced once,
// to managers and owner — open screens, push on subscribed devices, Telegram.
//
//   node scripts/e2e-notify.mjs
import 'dotenv/config'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100'
const STORE = 'EZ-001'
const PROD = /ep-royal-cloud-b130i960|ep-still-tree-b1u5yng9/
const url = process.env.DIRECT_URL, siteUrl = process.env.STOREFRONT_DIRECT_URL
if (!url || !siteUrl) { console.error('DIRECT_URL and STOREFRONT_DIRECT_URL are required'); process.exit(1) }
if (PROD.test(url) || PROD.test(siteUrl)) { console.error('a URL points at PRODUCTION — use Neon test branches'); process.exit(1) }
const secret = process.env.STOREFRONT_REVALIDATE_SECRET

const erp = new pg.Client({ connectionString: url }); await erp.connect()
const web = new pg.Client({ connectionString: siteUrl }); await web.connect()
const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 300) })
const cleanups = []
const tag = crypto.randomBytes(3).toString('hex').toUpperCase()

async function login(email, password) {
  const jar = new Map()
  const absorb = (res) => { for (const c of res.headers.getSetCookie()) { const [p] = c.split(';'); const i = p.indexOf('='); jar.set(p.slice(0, i), p.slice(i + 1)) } }
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const csrf = await fetch(BASE + '/api/auth/csrf'); absorb(csrf)
  const { csrfToken } = await csrf.json()
  absorb(await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1', cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password }),
  }))
  return async (path, { method = 'GET', body } = {}) => {
    const r = await fetch(BASE + path, { method, redirect: 'manual', headers: { cookie: cookie(), ...(body && { 'content-type': 'application/json' }) }, body: body && JSON.stringify(body) })
    let data = null
    try { data = await r.json() } catch {}
    return { status: r.status, data }
  }
}
const userIds = []
async function makeUser(role) {
  const password = crypto.randomBytes(12).toString('base64url')
  const email = `zz-e2e-notify-${role}@migration.local`
  await erp.query(`delete from user_profiles where email = $1`, [email]).catch(() => {})
  const { rows: [u] } = await erp.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, $5, true, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E notify ${role}`, role, STORE])
  userIds.push(u.id)
  return await login(email, password)
}
const hook = (key) => fetch(BASE + '/api/site/notify', { method: 'POST', headers: key ? { 'x-site-secret': key } : {} }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }))

try {
  const manager = await makeUser('gerant')
  const staff   = await makeUser('employe')
  const reqId = `e2e${tag.toLowerCase()}${Date.now()}`
  cleanups.push(async () => {
    await web.query(`delete from "RepairRequest" where id = $1`, [reqId])
    await erp.query(`delete from site_notified where ref_id = $1`, [reqId])
    await erp.query(`delete from push_subscriptions where user_id = any($1)`, [userIds])
    await erp.query(`delete from activity_log where user_id = any($1)`, [userIds])
    await erp.query(`delete from user_profiles where id = any($1)`, [userIds])
  })

  // ── The website's call ────────────────────────────────────────────
  check('the shared secret is configured', !!secret)
  check('no secret: refused (401)', (await hook(null)).status === 401)
  check('wrong secret: refused (401)', (await hook('x'.repeat(secret?.length ?? 8))).status === 401)
  await hook(secret)   // whatever was already waiting on the test branch is announced now

  await web.query(
    `insert into "RepairRequest" (id, kind, "customerName", "customerPhone", "deviceBrand", "deviceModel", "problemAreas", status, ref, "updatedAt")
     values ($1, 'HARDWARE', 'Client E2E', '0611223344', 'Apple', $2, '{}', 'NEW', $3, now())`, [reqId, `E2E ${tag}`, `DEM-E${tag}`.slice(0, 10)])
  const first = await hook(secret)
  const { rows: [row] } = await erp.query(`select kind from site_notified where ref_id = $1`, [reqId])
  check('a new request is announced once', first.status === 200 && first.data?.announced === 1 && row?.kind === 'request', { first, row })
  const again = await hook(secret)
  check('…and not a second time', again.status === 200 && again.data?.announced === 0, again)
  const counts = await manager('/api/site/counts')
  const { rows: [n] } = await erp.query(`select count(*)::int n from site_notified where ref_id = $1`, [reqId])
  check('the screens\' own check does not announce it again', counts.status === 200 && counts.data?.data?.repairs >= 1 && n.n === 1, { counts: counts.data, n })

  // ── Devices ───────────────────────────────────────────────────────
  const sub = { endpoint: `https://push.example.invalid/${tag}`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }
  check('staff cannot subscribe a device (403)', (await staff('/api/push/subscribe', { method: 'POST', body: sub })).status === 403)
  check('a subscription needs its keys (400)', (await manager('/api/push/subscribe', { method: 'POST', body: { endpoint: sub.endpoint } })).status === 400)
  const ok = await manager('/api/push/subscribe', { method: 'POST', body: sub })
  const twice = await manager('/api/push/subscribe', { method: 'POST', body: sub })
  const { rows: subs } = await erp.query(`select user_id from push_subscriptions where endpoint = $1`, [sub.endpoint])
  check('a manager subscribes a device, once', ok.status === 200 && twice.status === 200 && subs.length === 1 && subs[0].user_id === userIds[0], { ok: ok.status, subs })
  const test = await manager('/api/push/test', { method: 'POST' })
  check('"Tester" answers even when the device is unreachable', test.status === 200 && test.data?.data?.pushConfigured === true && test.data?.data?.push === 0, test)
  check('staff cannot send a test (403)', (await staff('/api/push/test', { method: 'POST' })).status === 403)
  const off = await manager('/api/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } })
  const { rows: left } = await erp.query(`select 1 from push_subscriptions where endpoint = $1`, [sub.endpoint])
  check('the device can be removed', off.status === 200 && left.length === 0)
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
