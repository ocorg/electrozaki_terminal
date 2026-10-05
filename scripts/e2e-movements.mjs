// End-to-end checks of stock transfers against a running ERP dev server
// (default http://localhost:3100) whose env points at a TEST branch (DIRECT_URL).
//
// Owner's report (2026-10-05): typing a phone's IMEI answered "Élément
// introuvable" — the form only knew the internal number. A transfer now
// takes the IMEI (or the internal number), and refuses a phone that left.
//
//   node scripts/e2e-movements.mjs
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
try {
  const password = crypto.randomBytes(12).toString('base64url')
  const email = 'zz-e2e-mov-gerant@migration.local'
  await db.query(`delete from user_profiles where email = $1`, [email]).catch(() => {})
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, 'E2E mov', 'gerant', $3, true, true) returning id`, [email, await bcrypt.hash(password, 10), STORE])
  const manager = await login(email, password)
  const newPhone = async (status = 'disponible') => {
    const imei = '3599' + String(crypto.randomInt(1e10, 1e11 - 1))
    const { rows: [p] } = await db.query(
      `insert into phones (store_id, source, condition, marque, model, status, prix_achat, imei, date_entree)
       values ($1, 'fournisseur', 'occasion', 'Apple', 'E2E mov', $2, 1000, $3, current_date) returning phone_id`, [STORE, status, imei])
    phones.push(p.phone_id)
    return { id: p.phone_id, imei }
  }
  cleanups.push(async () => {
    await db.query(`delete from activity_log where user_id = $1`, [u.id])
    await db.query(`delete from stock_movements where device_id = any($1)`, [phones])
    await db.query(`delete from phones where phone_id = any($1)`, [phones])
    await db.query(`delete from user_profiles where id = $1`, [u.id])
  })
  const state = async id => (await db.query(`select status, location from phones where phone_id = $1`, [id])).rows[0]
  const move = body => manager('/api/movements', { method: 'POST', body: { device_type: 'telephone', from_location: 'magasin_principal', to_location: 'externe', reason: 'reparation_externe', store_id: STORE, ...body } })

  const A = await newPhone()
  const byImei = await move({ device_id: A.imei })
  check('transfer by IMEI: recorded on the phone', byImei.status === 201 && byImei.data?.data?.device_id === A.id, byImei)
  const sA = await state(A.id)
  check('…phone is out for repair, outside', sA.status === 'en_reparation' && sA.location === 'externe', sA)
  const back = await move({ device_id: A.id.toLowerCase(), from_location: 'externe', to_location: 'magasin_principal', reason: 'retour' })
  check('the internal number still works (any case)', back.status === 201 && (await state(A.id)).status === 'disponible', back)
  const spaced = await move({ device_id: `  ${A.imei} ` })
  check('spaces around the IMEI are ignored', spaced.status === 201, spaced)

  const unknown = await move({ device_id: '359900000000000' })
  check('unknown IMEI: a clear message, not "Élément introuvable"', unknown.status === 404 && /Aucun téléphone/.test(unknown.data?.error ?? ''), unknown)
  const B = await newPhone('vendu')
  const sold = await move({ device_id: B.imei })
  check('a sold phone cannot be transferred', sold.status === 400 && (await state(B.id)).status === 'vendu', sold)
  const C = await newPhone('void')
  check('…nor a phone in The Void', (await move({ device_id: C.imei })).status === 400 && (await state(C.id)).status === 'void')
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
