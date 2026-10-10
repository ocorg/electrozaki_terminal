// End-to-end checks of "catching up on a forgotten day" against a running
// ERP dev server (default http://localhost:3100) whose env points at a TEST
// branch (DIRECT_URL).
//
// Owner's rules (2026-10-10): a manager can open the caisse of a day that was
// forgotten (7 days back at most), enter its sales and money at their true
// date, and close it. Never on a closed day, never by an employee.
//
//   node scripts/e2e-catchup.mjs
import 'dotenv/config'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100'
const STORE = 'EZ-001'
const url = process.env.DIRECT_URL
if (!url) { console.error('DIRECT_URL is not set'); process.exit(1) }
if (/ep-royal-cloud-b130i960|ep-still-tree-b1u5yng9/.test(url)) { console.error('DIRECT_URL points at PRODUCTION — use a Neon test branch'); process.exit(1) }

const db = new pg.Client({ connectionString: url }); await db.connect()
const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 300) })
const cleanups = []
const n = v => (v == null ? null : Number(v))
const today = new Date(Date.now() - (new Date().getUTCHours() < 4 ? 86_400_000 : 0)).toISOString().slice(0, 10)
const minus = d => new Date(Date.parse(`${today}T00:00:00Z`) - d * 86_400_000).toISOString().slice(0, 10)

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
  const email = `zz-e2e-catchup-${role}@migration.local`
  await db.query(`delete from user_profiles where email = $1`, [email]).catch(() => {})
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, $5, true, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E rattrapage ${role}`, role, STORE])
  userIds.push(u.id)
  return await login(email, password)
}

try {
  const manager = await makeUser('gerant')
  const staff   = await makeUser('employe')
  // a day of the last week that has no caisse on the test branch
  const { rows: taken } = await db.query(`select date::text d from caisse where store_id = $1 and date >= $2`, [STORE, minus(7)])
  const DAY = [1, 2, 3, 4, 5, 6].map(minus).find(d => !taken.some(t => t.d === d))
  if (!DAY) throw new Error('no free day in the last week on the test branch')
  const { rows: [acc] } = await db.query(`select acc_id, quantite from accessories where store_id = $1 and not is_deleted and quantite > 5 and categorie <> 'service' limit 1`, [STORE])
  const txns = []
  cleanups.push(async () => {
    await db.query(`delete from activity_log where user_id = any($1)`, [userIds])
    await db.query(`delete from transactions where created_by = any($1)`, [userIds])
    await db.query(`delete from cash_drops where created_by = any($1)`, [userIds])
    await db.query(`delete from caisse where store_id = $1 and date = $2 and created_by = any($3)`, [STORE, DAY, userIds])
    await db.query(`update accessories set quantite = $2, updated_by = null where acc_id = $1`, [acc.acc_id, acc.quantite])
    await db.query(`delete from user_profiles where id = any($1)`, [userIds])
  })
  const sale = (api, body) => api('/api/transactions', { method: 'POST', body: { store_id: STORE, device_type: 'accessoire', device_id: acc.acc_id, type_operation: 'vente', qty: 1, prix_vente: 200, payment_method: 'especes', ...body } })
  const open = (api, date, ouverture = 100) => api('/api/caisse', { method: 'POST', body: { store_id: STORE, ouverture, date } })
  const caisse = async d => (await manager(`/api/caisse?store_id=${STORE}&date=${d}`)).data?.data
  const todayCash = async () => (await caisse(today))?.payment_breakdown?.cash ?? null

  // ── Who, and how far back ─────────────────────────────────────────
  check('staff cannot open a past day (403)', (await open(staff, DAY)).status === 403)
  check('more than 7 days back is refused (400)', (await open(manager, minus(9))).status === 400)
  check('a future day is refused (400)', (await open(manager, minus(-1))).status === 400)
  const early = await sale(manager, { date_vente: DAY })
  check('nothing is entered on a past day before its caisse is opened (409)', early.status === 409 && /Ouvrez d.abord la caisse/.test(early.data?.error ?? ''), early)

  // ── The forgotten day ─────────────────────────────────────────────
  const before = await todayCash()
  const o = await open(manager, DAY, 100)
  check('the manager opens the forgotten day', o.status === 201 && String(o.data?.data?.date).slice(0, 10) === DAY && o.data?.data?.status === 'ouverte', o)
  check('…once only (409)', (await open(manager, DAY)).status === 409)
  const s1 = await sale(manager, { date_vente: DAY })
  check('a sale is recorded on that day, warranty from that day', s1.status === 201 && String(s1.data?.data?.date_vente).slice(0, 10) === DAY && String(s1.data?.data?.warranty_start).slice(0, 10) === DAY, s1.data?.data && { d: s1.data.data.date_vente, w: s1.data.data.warranty_start })
  const { rows: [log] } = await db.query(`select notes from activity_log where record_id = $1 order by created_at desc limit 1`, [s1.data?.data?.txn_id])
  check('…and marked "après coup" in the log', /saisi après coup/.test(log?.notes ?? ''), log)
  const drop = await manager('/api/cash-drops', { method: 'POST', body: { amount: 50, reason: 'E2E rattrapage', store_id: STORE, date: DAY } })
  check('money in is recorded on that day', (drop.status === 201 || drop.status === 200) && String(drop.data?.data?.date).slice(0, 10) === DAY, drop)
  check('staff cannot sell on a past day (403)', (await sale(staff, { date_vente: DAY })).status === 403)
  const c = await caisse(DAY)
  check('that day adds up: 100 + 200 + 50 = 350', n(c?.solde_theorique) === 350, c && { t: c.solde_theorique })
  check('today is not touched', (await todayCash()) === before, { before, after: await todayCash() })

  // ── Closing it ────────────────────────────────────────────────────
  const close = await manager('/api/caisse', { method: 'PATCH', body: { caisse_id: c?.caisse_id, solde_reel: 350 } })
  check('the forgotten day is closed like any other', close.status === 200 && close.data?.data?.status === 'cloturee' && n(close.data?.data?.ecart) === 0, close.data?.data && { s: close.data.data.status, e: close.data.data.ecart })
  const late = await sale(manager, { date_vente: DAY })
  check('once closed, nothing more is entered on it (409)', late.status === 409 && /clôturée/.test(late.data?.error ?? ''), late)
  const fin = await manager(`/api/analytics?store_id=${STORE}&from=${DAY}&to=${DAY}`)
  check('the figures of that day include the sale', n(fin.data?.data?.totals?.salesRevenue) >= 200, fin.data?.data?.totals && { r: fin.data.data.totals.salesRevenue })
  const normal = await sale(manager, {})
  check('a sale without a date is still today', normal.status === 201 && String(normal.data?.data?.date_vente).slice(0, 10) === today, normal.data?.data && { d: normal.data.data.date_vente })
} catch (err) {
  check('script ran to the end', false, String(err?.stack ?? err))
} finally {
  for (const fn of cleanups.reverse()) { try { await fn() } catch (e) { console.error('cleanup:', e.message) } }
  await db.end()
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  → ${r.detail}`}`)
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
