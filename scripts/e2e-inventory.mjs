// End-to-end checks of the phone inventory against a running ERP dev server
// (default http://localhost:3100) whose env points at a TEST branch (DIRECT_URL).
//
// Owner's request (2026-10-05): an open inventory follows the live stock —
// the shop sells, adds and corrects phones on another device while counting,
// and the list must not have to be started again.
//
//   node scripts/e2e-inventory.mjs
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

const phones = []
const newImei = () => '3598' + String(crypto.randomInt(1e10, 1e11 - 1))
try {
  const password = crypto.randomBytes(12).toString('base64url')
  const email = 'zz-e2e-inv-gerant@migration.local'
  await db.query(`delete from user_profiles where email = $1`, [email]).catch(() => {})
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, 'E2E inv', 'gerant', $3, true, true) returning id`, [email, await bcrypt.hash(password, 10), STORE])
  const manager = await login(email, password)

  // An inventory left open on the test branch would block ours: park it
  const { rows: parked } = await db.query(`update inventory_sessions set statut = 'terminee' where store_id = $1 and statut = 'en_cours' returning session_id`, [STORE])
  let sessionId = null
  cleanups.push(async () => {
    if (sessionId) await db.query(`delete from inventory_sessions where session_id = $1`, [sessionId])
    if (parked.length) await db.query(`update inventory_sessions set statut = 'en_cours' where session_id = any($1)`, [parked.map(p => p.session_id)])
    await db.query(`delete from activity_log where user_id = $1`, [u.id])
    await db.query(`delete from phones where phone_id = any($1)`, [phones])
    await db.query(`delete from user_profiles where id = $1`, [u.id])
  })
  const newPhone = async (status = 'disponible', imei = newImei()) => {
    const { rows: [p] } = await db.query(
      `insert into phones (store_id, source, condition, marque, model, status, prix_achat, imei, date_entree)
       values ($1, 'fournisseur', 'occasion', 'Apple', 'E2E inv', $2, 1000, $3, current_date) returning phone_id`, [STORE, status, imei])
    phones.push(p.phone_id)
    return { id: p.phone_id, imei }
  }
  const detail = async () => (await manager(`/api/inventory/${sessionId}`)).data
  const itemOf = (d, phoneId) => (d?.items ?? []).find(i => i.phone_id === phoneId)
  const scan = imei => manager(`/api/inventory/${sessionId}/scan`, { method: 'POST', body: { imei } })

  const A = await newPhone(), B = await newPhone(), E = await newPhone('vendu')
  const start = await manager('/api/inventory', { method: 'POST', body: { store_id: STORE } })
  sessionId = start.data?.session?.session_id
  let d = await detail()
  const before = d?.session?.snapshot_count
  check('start: the phones in stock are waited for, the sold one is not', start.status === 200 && itemOf(d, A.id)?.resultat === 'en_attente' && itemOf(d, B.id)?.resultat === 'en_attente' && !itemOf(d, E.id), { s: start.status })

  // ── The stock moves while we count ────────────────────────────────
  await db.query(`update phones set status = 'vendu' where phone_id = $1`, [A.id])
  const C = await newPhone()
  const B2 = newImei()
  await db.query(`update phones set imei = $2, model = 'E2E inv corrigé' where phone_id = $1`, [B.id, B2])
  d = await detail()
  check('a phone sold during the count is no longer waited for', !itemOf(d, A.id), itemOf(d, A.id))
  check('a phone added during the count is waited for', itemOf(d, C.id)?.resultat === 'en_attente', itemOf(d, C.id))
  check('a corrected IMEI and model show as they are now', itemOf(d, B.id)?.imei === B2 && /corrigé/.test(itemOf(d, B.id)?.phone_label ?? ''), itemOf(d, B.id))
  check('the number of phones in scope follows (−1 sold, +1 added)', d?.session?.snapshot_count === before, { before, now: d?.session?.snapshot_count })
  const again = await detail()
  check('nothing changes when the stock did not move', (again?.items ?? []).length === (d?.items ?? []).length)

  // ── Scans ─────────────────────────────────────────────────────────
  const sB = await scan(B2)
  check('scanning the corrected IMEI finds the phone', sB.data?.type === 'trouve' && sB.data?.item?.phone_id === B.id, sB.data)
  await db.query(`update phones set status = 'vendu' where phone_id = $1`, [B.id])
  d = await detail()
  check('a phone found then sold stays found', itemOf(d, B.id)?.resultat === 'trouve', itemOf(d, B.id))

  const X = newImei()
  const sX = await scan(X)
  check('an IMEI nobody registered is flagged', sX.data?.type === 'non_enregistre', sX.data)
  const D = await newPhone('disponible', X)
  d = await detail()
  check('…and counts as found once the phone is registered', itemOf(d, D.id)?.resultat === 'trouve' && (d.items ?? []).filter(i => i.imei === X).length === 1, itemOf(d, D.id))

  const sE = await scan(E.imei)
  check('a sold phone scanned in the shop is "hors périmètre"', sE.data?.type === 'hors_perimetre', sE.data)
  await db.query(`update phones set status = 'disponible' where phone_id = $1`, [E.id])
  d = await detail()
  check('…and found once it is back in stock', itemOf(d, E.id)?.resultat === 'trouve', itemOf(d, E.id))

  const F = await newPhone()
  const sF = await scan(F.imei)
  check('a phone added a moment ago is recognised at the first scan', sF.data?.type === 'trouve' && sF.data?.item?.phone_id === F.id, sF.data)

  // ── Closing ───────────────────────────────────────────────────────
  const G = await newPhone()
  const close = await manager(`/api/inventory/${sessionId}/close`, { method: 'PATCH' })
  const { rows } = await db.query(`select phone_id, resultat from inventory_session_items where session_id = $1 and phone_id = any($2)`, [sessionId, phones])
  const res = id => rows.find(r => r.phone_id === id)?.resultat
  check('closing: never scanned = missing, including a phone added just before', close.status === 200 && res(C.id) === 'manquant' && res(G.id) === 'manquant', rows)
  check('closing: the phone sold during the count is not reported missing', res(A.id) === undefined, res(A.id))
  await db.query(`update phones set status = 'vendu' where phone_id = $1`, [C.id])
  const { rows: [frozen] } = await db.query(`select resultat from inventory_session_items where session_id = $1 and phone_id = $2`, [sessionId, C.id])
  await detail()
  check('a closed inventory no longer moves', frozen?.resultat === 'manquant' && (await db.query(`select resultat from inventory_session_items where session_id = $1 and phone_id = $2`, [sessionId, C.id])).rows[0]?.resultat === 'manquant')
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
