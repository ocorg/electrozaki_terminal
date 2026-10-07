// End-to-end checks of "a phone that comes back" against a running ERP dev
// server (default http://localhost:3100) whose env points at a TEST branch.
//
// Owner's rule (2026-10-08): a phone sold long ago and taken back starts a
// second life with a record of its own, same IMEI; the old record keeps its
// sale. One record "in the shop" per IMEI.
//
//   node scripts/e2e-secondlife.mjs
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

const IMEI = '3597' + String(crypto.randomInt(1e10, 1e11 - 1))
const phones = [], txns = []
try {
  const password = crypto.randomBytes(12).toString('base64url')
  const email = 'zz-e2e-life-gerant@migration.local'
  await db.query(`delete from user_profiles where email = $1`, [email]).catch(() => {})
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, 'E2E life', 'gerant', $3, true, true) returning id`, [email, await bcrypt.hash(password, 10), STORE])
  const manager = await login(email, password)
  const { rows: parked } = await db.query(`update inventory_sessions set statut = 'terminee' where store_id = $1 and statut = 'en_cours' returning session_id`, [STORE])
  let sessionId = null
  cleanups.push(async () => {
    if (sessionId) await db.query(`delete from inventory_sessions where session_id = $1`, [sessionId])
    if (parked.length) await db.query(`update inventory_sessions set statut = 'en_cours' where session_id = any($1)`, [parked.map(p => p.session_id)])
    const all = (await db.query(`select phone_id from phones where imei = $1`, [IMEI])).rows.map(r => r.phone_id)
    const sales = (await db.query(`select txn_id from transactions where device_id = any($1)`, [all])).rows.map(r => r.txn_id)
    await db.query(`delete from activity_log where user_id = $1 or record_id = any($2)`, [u.id, [...all, ...sales]])
    await db.query(`delete from stock_movements where device_id = any($1)`, [all])
    await db.query(`delete from retours where txn_id = any($1)`, [sales])
    await db.query(`delete from transactions where txn_id = any($1)`, [sales])
    await db.query(`delete from phones where phone_id = any($1)`, [all])
    await db.query(`delete from user_profiles where id = $1`, [u.id])
  })
  const state = async id => (await db.query(`select status, vie_precedente_id, marque, couleur, stockage from phones where phone_id = $1`, [id])).rows[0]
  const add = (body = {}) => manager('/api/phones', { method: 'POST', body: { store_id: STORE, source: 'fournisseur', condition: 'occasion', marque: 'Inconnu', model: 'E2E vie', imei: IMEI, status: 'disponible', prix_achat: 1500, ...body } })
  const sell = async id => {
    const r = await manager('/api/transactions', { method: 'POST', body: { store_id: STORE, device_type: 'telephone', device_id: id, type_operation: 'vente', prix_vente: 2600, payment_method: 'especes' } })
    if (r.data?.data?.txn_id) txns.push(r.data.data.txn_id)
    return r
  }

  // ── First life ────────────────────────────────────────────────────
  const { rows: [a] } = await db.query(
    `insert into phones (store_id, source, condition, marque, model, stockage, couleur, status, prix_achat, prix_vente_recommande, imei, date_entree, created_at)
     values ($1, 'fournisseur', 'occasion', 'Apple', 'E2E vie', '128GB', 'Bleu', 'disponible', 2000, 2600, $2, '2026-06-01', now() - interval '90 days') returning phone_id`, [STORE, IMEI])
  const A = a.phone_id
  const twice = await add()
  check('a phone still in the shop cannot get a second record (409)', twice.status === 409 && /déjà au magasin/.test(twice.data?.error ?? ''), twice)
  const saleA = await sell(A)
  check('first life: sold', saleA.status === 201 && (await state(A)).status === 'vendu', saleA.status)

  // ── It comes back ─────────────────────────────────────────────────
  const back = await add()
  const B = back.data?.data?.phone_id
  const sB = B ? await state(B) : null
  check('taken back: a new record, linked to the old one', back.status === 201 && sB?.vie_precedente_id === A && back.data?.previous?.phone_id === A, { s: back.status, e: back.data?.error, sB })
  check('…what does not change is filled in from the first life', sB?.marque === 'Apple' && sB?.couleur === 'Bleu' && sB?.stockage === '128GB', sB)
  check('…and the old record keeps its sale', (await state(A)).status === 'vendu')
  check('still one record in the shop per IMEI (409)', (await add()).status === 409)

  // ── The old record cannot come back next to the new one ───────────
  const ret = await manager('/api/retours', { method: 'POST', body: { txn_id: saleA.data?.data?.txn_id, qty: 1, montant: 2600, mode: 'virement', destination: 'stock', motif: 'E2E deuxième vie' } })
  check('a return on the old sale is refused: the phone is back under its new record (409)', ret.status === 409 && /revenu au magasin/.test(ret.data?.error ?? ''), ret)
  const voided = await manager('/api/transactions/void', { method: 'PATCH', body: { txn_id: saleA.data?.data?.txn_id, voided_reason: 'E2E deuxième vie' } })
  check('…and so is cancelling the old sale', voided.status === 409 && (await state(A)).status === 'vendu', voided)
  let guard = null
  try { await db.query(`update phones set status = 'disponible' where phone_id = $1`, [A]) } catch (e) { guard = e.code }
  check('the database itself refuses two records in the shop', guard === '23505', guard)

  // ── Everything that looks a phone up by IMEI finds the one in the shop ──
  const hist = await manager(`/api/phones/${B}/history`)
  const ev = hist.data?.data?.events ?? []
  const titles = ev.map(e => `${e.stay}:${e.title}`).join(' | ')
  check('history tells both stays, the current one first', hist.data?.data?.lives === 2 && ev[0]?.stay === 2 && ev.some(e => e.stay === 1 && /^Vendu/.test(e.title)) && ev.some(e => e.stay === 2 && e.title === 'Revenu au magasin') && hist.data?.data?.stays?.[1]?.current === true, titles.slice(0, 250))
  const list = await manager(`/api/phones?store_id=${STORE}&limit=5000`)
  const mine = (list.data?.data ?? []).filter(p => p.imei === IMEI)
  check('the phones list shows one record for the phone: the current one', mine.length === 1 && mine[0].phone_id === B, mine.map(p => p.phone_id))
  const look = await manager(`/api/phones/lookup?imei=${IMEI}`)
  check('lookup while it is in the shop: known, flagged "in the shop"', look.data?.data?.known === true && look.data?.data?.in_shop === true, look.data)
  const histA = await manager(`/api/phones/${A}/history`)
  check('…from the old record too', histA.data?.data?.lives === 2, histA.data?.data?.lives)
  const move = await manager('/api/movements', { method: 'POST', body: { device_type: 'telephone', device_id: IMEI, from_location: 'magasin_principal', to_location: 'externe', reason: 'reparation_externe', store_id: STORE } })
  check('a transfer by IMEI moves the record in the shop', move.status === 201 && move.data?.data?.device_id === B, move)
  await manager('/api/movements', { method: 'POST', body: { device_type: 'telephone', device_id: IMEI, from_location: 'externe', to_location: 'magasin_principal', reason: 'retour', store_id: STORE } })
  const start = await manager('/api/inventory', { method: 'POST', body: { store_id: STORE } })
  sessionId = start.data?.session?.session_id
  const scan = await manager(`/api/inventory/${sessionId}/scan`, { method: 'POST', body: { imei: IMEI } })
  check('an inventory scan finds it', scan.data?.type === 'trouve' && scan.data?.item?.phone_id === B, scan.data)

  // ── And it can leave and come back again ──────────────────────────
  const saleB = await sell(B)
  const look2 = await manager(`/api/phones/lookup?imei=${IMEI}`)
  check('lookup once sold: its description comes back, no price', look2.data?.data?.known === true && look2.data?.data?.in_shop === false && look2.data?.data?.model === 'E2E vie' && look2.data?.data?.couleur === 'Bleu' && !('prix_achat' in (look2.data?.data ?? {})) && !!look2.data?.data?.sold_on, look2.data)
  check('lookup of an unknown IMEI: nothing', (await manager('/api/phones/lookup?imei=359700000000001')).data?.data?.known === false)
  const third = await add({ marque: 'Apple' })
  const C = third.data?.data?.phone_id
  check('second life sold, third life: linked to the second', saleB.status === 201 && third.status === 201 && (await state(C))?.vie_precedente_id === B, { b: saleB.status, c: third.status })
  check('history then tells three lives', (await manager(`/api/phones/${C}/history`)).data?.data?.lives === 3)
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
