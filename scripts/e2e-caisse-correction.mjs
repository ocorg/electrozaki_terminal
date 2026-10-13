// End-to-end checks of "correcting an earlier day's caisse" against a running
// ERP dev server (default http://localhost:3100) whose env points at a TEST
// branch (DIRECT_URL).
//
// Owner's rules (2026-10-13): a manager can correct the opening or counted
// amount of a day's caisse, or reopen a closed day to fix what was entered in
// it — 30 days back at most, with a reason each time. Days stand alone.
//
//   node scripts/e2e-caisse-correction.mjs
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
  const email = `zz-e2e-correction-${role}@migration.local`
  await db.query(`delete from user_profiles where email = $1`, [email]).catch(() => {})
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, $5, true, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E correction ${role}`, role, STORE])
  userIds.push(u.id)
  return await login(email, password)
}

try {
  const manager = await makeUser('gerant')
  const staff   = await makeUser('employe')
  // Two closed days borrowed from the test branch and put back at the end: one 8–25 days
  // back (beyond the catch-up week), one beyond the 30 days
  const borrow = async (from, to) => (await db.query(
    `select * from caisse where store_id = $1 and status = 'cloturee' and date between $2 and $3 order by date desc limit 1`, [STORE, minus(to), minus(from)])).rows[0]
  const dayRow = await borrow(8, 25), oldRow = await borrow(35, 60)
  if (!dayRow || !oldRow) throw new Error('no closed day to borrow on the test branch')
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  const DAY = iso(dayRow.date), ID = dayRow.caisse_id, OLD_ID = oldRow.caisse_id, OTHER = minus(12)
  const { rows: [acc] } = await db.query(`select acc_id, quantite from accessories where store_id = $1 and not is_deleted and quantite > 5 and categorie <> 'service' limit 1`, [STORE])
  cleanups.push(async () => {
    await db.query(`delete from activity_log where user_id = any($1)`, [userIds])
    await db.query(`delete from transactions where created_by = any($1)`, [userIds])
    const cols = ['status', 'ouverture', 'total_ventes', 'total_reparations', 'total_depenses', 'total_cash_drops', 'total_fournisseurs', 'solde_theorique', 'solde_reel', 'ecart', 'payment_breakdown', 'notes', 'closed_by', 'closed_at', 'eod_submitted_at', 'approved_by', 'approved_at']
    await db.query(`update caisse set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where caisse_id = $1`,
      [ID, ...cols.map(c => (c === 'payment_breakdown' && dayRow[c] != null ? JSON.stringify(dayRow[c]) : dayRow[c]))])
    await db.query(`update accessories set quantite = $2, updated_by = null where acc_id = $1`, [acc.acc_id, acc.quantite])
    await db.query(`delete from user_profiles where id = any($1)`, [userIds])
  })
  // A closed day as the ERP leaves it: 100 opening + 250 cash = 350 calculated, 350 counted
  await db.query(`update caisse set ouverture = 100, total_ventes = 250, solde_theorique = 350, solde_reel = 350, ecart = 0 where caisse_id = $1`, [ID])
  const fix = (api, body) => api('/api/caisse', { method: 'PATCH', body })
  const sale = (api, body) => api('/api/transactions', { method: 'POST', body: { store_id: STORE, device_type: 'accessoire', device_id: acc.acc_id, type_operation: 'vente', qty: 1, prix_vente: 200, payment_method: 'especes', ...body } })
  const caisse = async d => (await manager(`/api/caisse?store_id=${STORE}&date=${d}`)).data?.data
  const row = async () => (await db.query(`select status::text, ouverture, solde_theorique, solde_reel, ecart, total_ventes from caisse where caisse_id = $1`, [ID])).rows[0]
  const todayBefore = JSON.stringify(await caisse(today))

  // ── Who, how far back, and why ────────────────────────────────────
  check('staff cannot correct a caisse (403)', (await fix(staff, { action: 'corriger', caisse_id: ID, ouverture: 150, motif: 'test' })).status === 403)
  check('staff cannot reopen a caisse (403)', (await fix(staff, { action: 'rouvrir', caisse_id: ID, motif: 'test' })).status === 403)
  check('a reason is required (400)', (await fix(manager, { action: 'corriger', caisse_id: ID, ouverture: 150 })).status === 400)
  const old = await fix(manager, { action: 'corriger', caisse_id: OLD_ID, ouverture: 150, motif: 'trop ancien' })
  check('more than 30 days back is refused (400)', old.status === 400 && /30 derniers jours/.test(old.data?.error ?? ''), old)
  check('…reopening too (400)', (await fix(manager, { action: 'rouvrir', caisse_id: OLD_ID, motif: 'trop ancien' })).status === 400)
  check('a negative amount is refused (400)', (await fix(manager, { action: 'corriger', caisse_id: ID, ouverture: -5, motif: 'test' })).status === 400)
  check('unchanged amounts are refused (400)', (await fix(manager, { action: 'corriger', caisse_id: ID, ouverture: 100, solde_reel: 350, motif: 'test' })).status === 400)

  // ── Correcting the amounts of a closed day ────────────────────────
  const a = await fix(manager, { action: 'corriger', caisse_id: ID, ouverture: 150, motif: 'erreur de frappe ouverture' })
  let r = await row()
  check('opening 100 → 150: calculated 400, gap −50, still closed', a.status === 200 && n(r.ouverture) === 150 && n(r.solde_theorique) === 400 && n(r.ecart) === -50 && r.status === 'cloturee', r)
  const b = await fix(manager, { action: 'corriger', caisse_id: ID, solde_reel: 420, motif: 'erreur de frappe comptage' })
  r = await row()
  check('counted 350 → 420: gap +20, calculated unchanged', b.status === 200 && n(r.solde_reel) === 420 && n(r.solde_theorique) === 400 && n(r.ecart) === 20, r)
  check('the day\'s sales total is not touched', n(r.total_ventes) === 250, r)
  const { rows: [log] } = await db.query(`select action_type::text, notes from activity_log where record_id = $1 order by created_at desc limit 1`, [ID])
  check('the correction is logged with old and new amounts and the reason', log?.action_type === 'modification' && /350 → 420/.test(log.notes) && /erreur de frappe comptage/.test(log.notes), log)

  // ── Reopening it to fix its entries ───────────────────────────────
  const shut = await sale(manager, { date_vente: DAY })
  check('a closed day takes no entry, and says how to reopen it (409)', shut.status === 409 && /rouvrez-la/.test(shut.data?.error ?? ''), shut)
  const ro = await fix(manager, { action: 'rouvrir', caisse_id: ID, motif: 'une vente oubliée' })
  check('the manager reopens the day', ro.status === 200 && ro.data?.data?.status === 'ouverte', ro.data?.data && { s: ro.data.data.status })
  check('…once only (400)', (await fix(manager, { action: 'rouvrir', caisse_id: ID, motif: 'encore' })).status === 400)
  const live = n((await caisse(DAY))?.solde_theorique)   // 150 + whatever the test branch holds for that day
  const s = await sale(manager, { date_vente: DAY })
  check('a sale is recorded on the reopened day, beyond the catch-up week', s.status === 201 && String(s.data?.data?.date_vente).slice(0, 10) === DAY, s.data?.data ? { d: s.data.data.date_vente } : s)
  check('staff still cannot sell on it (403)', (await sale(staff, { date_vente: DAY })).status === 403)
  let c = await caisse(DAY)
  check('reopened, the day is calculated from its entries again: + 200 for the sale', n(c?.solde_theorique) === live + 200, c && { t: c.solde_theorique, live })
  check('the counted amount cannot be typed on an open day (400)', (await fix(manager, { action: 'corriger', caisse_id: ID, solde_reel: 500, motif: 'test' })).status === 400)
  const op = await fix(manager, { action: 'corriger', caisse_id: ID, ouverture: 100, motif: 'ouverture en fait 100' })
  c = await caisse(DAY)
  check('the opening of an open day can be corrected: 150 → 100 moves the calculated cash by −50', op.status === 200 && n(c?.solde_theorique) === live + 150, c && { t: c.solde_theorique, live })
  const close = await manager('/api/caisse', { method: 'PATCH', body: { caisse_id: ID, solde_reel: live + 150 } })
  check('closing it again recounts the day: gap 0, sale counted', close.status === 200 && close.data?.data?.status === 'cloturee' && n(close.data?.data?.ecart) === 0 && n(close.data?.data?.total_ventes) >= 200, close.data?.data && { s: close.data.data.status, e: close.data.data.ecart, v: close.data.data.total_ventes })

  // ── What must not change ──────────────────────────────────────────
  const newOld = await manager('/api/caisse', { method: 'POST', body: { store_id: STORE, ouverture: 100, date: OTHER } })
  check('a forgotten day is still opened within 7 days only (400)', newOld.status === 400, newOld)
  check('today\'s caisse is not touched', JSON.stringify(await caisse(today)) === todayBefore)
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
