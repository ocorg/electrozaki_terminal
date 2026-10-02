// End-to-end checks of staff (employé) permissions against a running ERP dev
// server (default http://localhost:3100, override with E2E_BASE) whose env
// points at a TEST database branch (DIRECT_URL).
//
// Owner's rules (2026-10-01): an employee has the POS, the caisse (open,
// submit the closure), phones and accessories only. They add phones/accessories and change their details
// (and accessory quantities) — never prices (purchase price never even
// shown), status, promo or deleting. Everything else is managers' —
// refused by the APIs, pages redirected to the POS.
//
//   node scripts/e2e-staff.mjs
import 'dotenv/config'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100'
const STORE = 'EZ-001'
const url = process.env.DIRECT_URL
if (!url) { console.error('DIRECT_URL is not set'); process.exit(1) }
if (/ep-royal-cloud-b130i960|ep-still-tree-b1u5yng9/.test(url)) { console.error('DIRECT_URL points at PRODUCTION — use a Neon test branch'); process.exit(1) }

const db = new pg.Client({ connectionString: url })
await db.connect()
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
  const call = async (path, { method = 'GET', body } = {}) => {
    const r = await fetch(BASE + path, { method, redirect: 'manual', headers: { cookie: cookie(), ...(body && { 'content-type': 'application/json' }) }, body: body && JSON.stringify(body) })
    let data = null
    try { data = await r.json() } catch {}
    return { status: r.status, data, location: r.headers.get('location') }
  }
  return call
}

async function makeUser(role) {
  const password = crypto.randomBytes(12).toString('base64url')
  const email = `zz-e2e-staff-${role}@migration.local`
  const forget = async id => {
    for (const t of ['phones', 'accessories']) await db.query(`update ${t} set updated_by = null, created_by = null where updated_by = $1 or created_by = $1`, [id]).catch(() => {})
    await db.query(`delete from activity_log where user_id = $1`, [id])
  }
  const { rows: old } = await db.query(`select id from user_profiles where email = $1`, [email])
  for (const o of old) { await forget(o.id); await db.query(`delete from user_profiles where id = $1`, [o.id]) }
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, $5, true, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E staff ${role}`, role, STORE])
  cleanups.push(async () => { await forget(u.id); await db.query(`delete from user_profiles where id = $1`, [u.id]) })
  return await login(email, password)
}

try {
  const staff   = await makeUser('employe')
  const manager = await makeUser('gerant')
  const { rows: [client] } = await db.query(`select client_id from clients where store_id = $1 limit 1`, [STORE])

  // ── Staff can read what their screens need ────────────────────────────
  const phones = await staff(`/api/phones?status=disponible&store_id=${STORE}&limit=50`)
  const p0 = phones.data?.data?.[0]
  check('staff: phone list (POS / stock)', phones.status === 200 && Array.isArray(phones.data?.data), phones.status)
  check('staff: phones without purchase price or iCloud password', p0 && !('prix_achat' in p0) && !('icloud_mdp' in p0), p0 && Object.keys(p0))
  const accs = await staff(`/api/accessories?store_id=${STORE}`)
  const a0 = accs.data?.data?.[0]
  check('staff: accessory list without purchase price', accs.status === 200 && a0 && !('prix_achat' in a0), a0 && Object.keys(a0))
  const laps = await staff(`/api/laptops?store_id=${STORE}`)
  check('staff: laptop list (POS) without purchase price', laps.status === 200 && (laps.data?.data ?? []).every(l => !('prix_achat' in l)), laps.status)
  // what the POS and the caisse need (client search, returns, clock-in)
  for (const path of [
    `/api/caisse?store_id=${STORE}&date=${new Date().toISOString().slice(0, 10)}`,
    `/api/clients?store_id=${STORE}`, '/api/users?mode=names', '/api/categories', '/api/phones/catalog',
    `/api/retours?store_id=${STORE}`, `/api/retours/avoirs?store_id=${STORE}`, `/api/attendance?store_id=${STORE}&date=${new Date().toISOString().slice(0, 10)}`,
  ]) {
    const r = await staff(path)
    check(`staff: can read ${path.split('?')[0]}`, r.status === 200, { status: r.status, error: r.data?.error })
  }
  const names = await staff('/api/users?mode=names')
  check('staff: user list gives names only', (names.data?.data ?? []).every(u => Object.keys(u).sort().join() === 'display_name,id,is_active'), names.data?.data?.[0])

  // ── Staff are refused managers' data ──────────────────────────────────
  for (const path of [
    '/api/suppliers?mode=dropdown', '/api/supplier-payments', `/api/expenses?store_id=${STORE}`, '/api/credits',
    '/api/credit-imports', '/api/movements', '/api/deliveries', '/api/documents', '/api/phone-credits',
    `/api/dashboard?store_id=${STORE}&start=2026-09-01&end=2026-09-30`, `/api/prospects?store_id=${STORE}`, '/api/warranty',
    '/api/site/orders', '/api/site/requests', '/api/site/catalog', '/api/site/promos', '/api/site/landing', '/api/site/stats',
    '/api/users', `/api/transactions?store_id=${STORE}`, '/api/settings', '/api/log', `/api/inventory?store_id=${STORE}`, '/api/bzg/dashboard',
    `/api/repairs?store_id=${STORE}`, `/api/cash-drops?store_id=${STORE}`,
    ...(client ? [`/api/transactions?client_id=${client.client_id}&limit=5`] : []),
  ]) {
    const r = await staff(path)
    check(`staff: refused ${path.split('?')[0]}${path.includes('client_id') ? ' (client history)' : ''}`, r.status === 403, { status: r.status })
  }

  // ── Staff can't change prices, status, promo, or delete ───────────────
  const writes = [
    ['/api/accessories', 'PATCH', { acc_id: a0?.acc_id, prix_achat: 1 }],
    ['/api/accessories', 'PATCH', { acc_id: a0?.acc_id, prix_vente_recommande: 1, prix_vente_minimum: 1 }],
    ['/api/phones', 'PATCH', { phone_id: p0?.phone_id, prix_vente_minimum: 1 }],
    ['/api/phones', 'PATCH', { phone_id: p0?.phone_id, status: 'vendu' }],
    ['/api/phones', 'PATCH', { phone_id: p0?.phone_id, promo_type: 'valeur', promo_montant: 100 }],
    [`/api/phones?phone_id=${p0?.phone_id}`, 'DELETE', undefined],
    [`/api/accessories?acc_id=${a0?.acc_id}`, 'DELETE', undefined],
    ['/api/laptops', 'POST', { store_id: STORE, marque: 'X', model: 'X' }],
    ['/api/clients', 'PATCH', { client_id: client?.client_id, nom: 'X' }],
    ['/api/repairs', 'POST', { store_id: STORE, client_nom: 'X' }],
    ['/api/phones/catalog', 'POST', { marque: 'X', serie: 'X', model: 'X' }],
    ['/api/expenses', 'POST', { store_id: STORE, montant: 1, categorie: 'autre' }],
    ['/api/prospects', 'POST', { store_id: STORE, nom: 'X' }],
    ['/api/phone-credits', 'POST', { phone_id: p0?.phone_id }],
    ['/api/phones/bulk-price', 'POST', { store_id: STORE, condition: 'neuf', field: 'vente', mode: 'montant', amount: 200, apply: false }],
  ]
  for (const [path, method, body] of writes) {
    const r = await staff(path, { method, body })
    const fields = body ? Object.keys(body).filter(k => !['acc_id', 'phone_id', 'store_id', 'client_id'].includes(k)).join('+') : ''
    check(`staff: ${method} ${path.split('?')[0]} ${fields} refused`, r.status === 403, { status: r.status, error: r.data?.error })
  }

  // ── Caisse: staff open the drawer (201, or 409 if today's is already open)
  const { rows: [todayCaisse] } = await db.query(`select caisse_id from caisse where store_id = $1 and date = current_date`, [STORE])
  const open = await staff('/api/caisse', { method: 'POST', body: { store_id: STORE, ouverture: 0 } })
  if (!todayCaisse && open.data?.data?.caisse_id) {
    cleanups.push(() => db.query(`delete from activity_log where record_id = $1`, [open.data.data.caisse_id]).then(() => db.query(`delete from caisse where caisse_id = $1`, [open.data.data.caisse_id])))
  }
  check('staff: can open the caisse', open.status === 201 || open.status === 409, { status: open.status, error: open.data?.error })

  const hist = await staff(`/api/phones/${p0.phone_id}/history`)
  check('staff: refused /api/phones/[id]/history (prices, suppliers)', hist.status === 403, { status: hist.status })

  // ── Staff change details; prices/status sent along are ignored ────────
  const pCols = 'couleur, status, prix_vente_recommande, prix_vente_minimum, prix_achat'
  const { rows: [pBefore] } = await db.query(`select ${pCols} from phones where phone_id = $1`, [p0.phone_id])
  const pEdit = await staff('/api/phones', { method: 'PATCH', body: { phone_id: p0.phone_id, couleur: 'E2E-Couleur', status: 'vendu', prix_vente_recommande: 1, prix_achat: 1 } })
  const { rows: [pAfter] } = await db.query(`select ${pCols} from phones where phone_id = $1`, [p0.phone_id])
  cleanups.push(() => db.query(`update phones set couleur = $2 where phone_id = $1`, [p0.phone_id, pBefore.couleur]))
  check('staff: changes a phone detail (colour)', pEdit.status === 200 && pAfter.couleur === 'E2E-Couleur', { status: pEdit.status, error: pEdit.data?.error })
  check('staff: phone status and prices untouched by that edit',
    pAfter.status === pBefore.status && String(pAfter.prix_vente_recommande) === String(pBefore.prix_vente_recommande) && String(pAfter.prix_achat) === String(pBefore.prix_achat),
    { before: pBefore, after: pAfter })
  check('staff: edit answer hides the purchase price', pEdit.data?.data && !('prix_achat' in pEdit.data.data), pEdit.data?.data && Object.keys(pEdit.data.data))
  const { rows: [sold] } = await db.query(`select phone_id from phones where store_id = $1 and status = 'vendu' and not is_deleted limit 1`, [STORE])
  if (sold) {
    const r = await staff('/api/phones', { method: 'PATCH', body: { phone_id: sold.phone_id, couleur: 'X' } })
    check('staff: cannot edit a sold phone', r.status === 403, { status: r.status })
  }

  const { rows: [aBefore] } = await db.query(`select quantite, prix_vente_recommande, prix_achat from accessories where acc_id = $1`, [a0.acc_id])
  const aEdit = await staff('/api/accessories', { method: 'PATCH', body: { acc_id: a0.acc_id, quantite: aBefore.quantite + 1, prix_vente_recommande: 1 } })
  const { rows: [aAfter] } = await db.query(`select quantite, prix_vente_recommande, prix_achat from accessories where acc_id = $1`, [a0.acc_id])
  cleanups.push(() => db.query(`update accessories set quantite = $2 where acc_id = $1`, [a0.acc_id, aBefore.quantite]))
  check('staff: changes an accessory quantity, price ignored',
    aEdit.status === 200 && aAfter.quantite === aBefore.quantite + 1 && String(aAfter.prix_vente_recommande) === String(aBefore.prix_vente_recommande),
    { status: aEdit.status, before: aBefore, after: aAfter })
  check('staff: accessory edit answer hides the purchase price', aEdit.data?.data && !('prix_achat' in aEdit.data.data), aEdit.data?.data && Object.keys(aEdit.data.data))

  // ── Staff add stock: details only, no prices, always "disponible" ─────
  const newAcc = await staff('/api/accessories', { method: 'POST', body: { store_id: STORE, nom: `E2E acc ${crypto.randomBytes(3).toString('hex')}`, categorie: a0.categorie, quantite: 3, prix_achat: 5, prix_vente_recommande: 9 } })
  const newAccId = newAcc.data?.data?.acc_id
  if (newAccId) cleanups.push(() => db.query(`delete from activity_log where record_id = $1`, [newAccId]).then(() => db.query(`delete from accessories where acc_id = $1`, [newAccId])))
  const { rows: [na] } = newAccId ? await db.query(`select quantite, prix_achat, prix_vente_recommande from accessories where acc_id = $1`, [newAccId]) : { rows: [] }
  check('staff: adds an accessory without prices', newAcc.status === 201 && na?.quantite === 3 && na.prix_achat == null && na.prix_vente_recommande == null, { status: newAcc.status, row: na, error: newAcc.data?.error })
  const newPh = await staff('/api/phones', { method: 'POST', body: {
    store_id: STORE, source: 'fournisseur', condition: 'occasion', marque: 'Apple', model: `E2E ajout ${crypto.randomBytes(3).toString('hex')}`,
    status: 'vendu', prix_achat: 1, prix_vente_recommande: 2, fournisseur_id: 'SUP-0001', promo_type: 'valeur', promo_montant: 1,
  } })
  const newPhId = newPh.data?.data?.phone_id
  if (newPhId) cleanups.push(() => db.query(`delete from activity_log where record_id = $1`, [newPhId]).then(() => db.query(`delete from phones where phone_id = $1`, [newPhId])))
  const { rows: [np] } = newPhId ? await db.query(`select status, prix_achat, prix_vente_recommande, fournisseur_id, promo_type from phones where phone_id = $1`, [newPhId]) : { rows: [] }
  check('staff: adds a phone — disponible, no prices, supplier or promo',
    newPh.status === 201 && np?.status === 'disponible' && np.prix_achat == null && np.prix_vente_recommande == null && np.fournisseur_id == null && np.promo_type == null,
    { status: newPh.status, row: np, error: newPh.data?.error })

  // …except the phone a customer traded in at the POS
  const tradeIn = await staff('/api/phones', { method: 'POST', body: {
    store_id: STORE, source: 'echange', condition: 'occasion', marque: 'Apple', model: `E2E reprise ${crypto.randomBytes(3).toString('hex')}`,
    status: 'disponible', prix_achat: 1500, prix_vente_recommande: 2000,
  } })
  const tradeId = tradeIn.data?.data?.phone_id
  if (tradeId) cleanups.push(() => db.query(`delete from activity_log where record_id = $1`, [tradeId]).then(() => db.query(`delete from phones where phone_id = $1`, [tradeId])))
  check('staff: can add the phone traded in at the POS', tradeIn.status === 201 && !!tradeId, tradeIn)

  // ── Pages: staff land on their screens, others redirect to the POS ────
  for (const page of ['/ez/pos', '/ez/caisse', '/ez/stock/phones', '/ez/stock/accessories']) {
    const r = await staff(page)
    check(`staff page: ${page} opens`, r.status === 200, { status: r.status, location: r.location })
  }
  for (const page of ['/ez/dashboard', '/ez/repairs', '/ez/clients', '/ez/prix', '/ez/suppliers', '/ez/transactions', '/ez/expenses', '/ez/credits', '/ez/site/orders', '/ez/stock/laptops', '/ez/documents', '/ez/prospects', '/ez/inventory', '/ez/analyses']) {
    const r = await staff(page)
    check(`staff page: ${page} → POS`, [302, 303, 307, 308].includes(r.status) && (r.location ?? '').endsWith('/ez/pos'), { status: r.status, location: r.location })
  }

  // ── Managers keep everything ──────────────────────────────────────────
  const mAcc = await manager(`/api/accessories?store_id=${STORE}`)
  check('manager: accessories include purchase price', mAcc.status === 200 && 'prix_achat' in (mAcc.data?.data?.[0] ?? {}), mAcc.status)
  for (const path of ['/api/suppliers?mode=dropdown', `/api/dashboard?store_id=${STORE}&start=2026-09-01&end=2026-09-30`, '/api/site/orders', `/api/transactions?store_id=${STORE}&limit=5`, '/api/users']) {
    const r = await manager(path)
    check(`manager: can read ${path.split('?')[0]}`, r.status === 200, { status: r.status, error: r.data?.error })
  }
  const mPage = await manager('/ez/suppliers')
  check('manager page: /ez/suppliers opens', mPage.status === 200, { status: mPage.status, location: mPage.location })
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
