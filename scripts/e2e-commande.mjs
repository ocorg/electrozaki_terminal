// End-to-end checks of a phone ordered for a client who pays an advance
// (owner, 2026-10-30, lib/phoneOrder) against a running ERP dev server
// (default http://localhost:3100) whose env points at a TEST branch.
// Run the dev server without STOREFRONT_* env (the site sync slows writes locally).
//
//   node scripts/e2e-commande.mjs
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
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 400) })
const n = v => (v == null ? null : Number(v))
const tag = crypto.randomBytes(3).toString('hex')
const today = new Date(Date.now() - (new Date().getUTCHours() < 4 ? 86_400_000 : 0)).toISOString().slice(0, 10)

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
  const email = `zz-e2e-commande-${role}@migration.local`
  await db.query(`delete from user_profiles where email = $1`, [email]).catch(() => {})
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, $5, true, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E commande ${role}`, role, STORE])
  userIds.push(u.id)
  return await login(email, password)
}
const made = { phones: [], clients: [], caisse: null }
const phoneRow = async id => (await db.query(`select status, en_commande, imei, is_deleted from phones where phone_id = $1`, [id])).rows[0]

try {
  const manager = await makeUser('gerant')
  const staff   = await makeUser('employe')
  const owner   = await makeUser('proprietaire')
  const { rows: [cz] } = await db.query(`select caisse_id from caisse where store_id = $1 and date = $2`, [STORE, today])
  if (!cz) made.caisse = (await db.query(`insert into caisse (date, ouverture, store_id, status) values ($1, 0, $2, 'ouverte') returning caisse_id`, [today, STORE])).rows[0].caisse_id
  const { rows: [client] } = await db.query(`insert into clients (nom, telephone, store_id) values ($1, $2, $3) returning client_id`, [`E2E Commande ${tag}`, `06${crypto.randomInt(1e7, 9e7)}`, STORE])
  made.clients.push(client.client_id)

  const order = async (model, prix) => {
    const r = await manager('/api/phones/commande', { method: 'POST', body: { store_id: STORE, marque: 'Apple', serie: 'iPhone 17', model, stockage: '256GB', couleur: 'Bleu', condition: 'neuf', prix } })
    if (r.data?.data?.phone_id) made.phones.push(r.data.data.phone_id)
    return r
  }
  const sell = (body) => manager('/api/transactions', { method: 'POST', body: { store_id: STORE, device_type: 'telephone', type_operation: 'vente', qty: 1, warranty_start: today, client_id: client.client_id, ...body } })
  const fileOf = async txn => (await db.query(`select credit_id, phone_remis, montant_total, montant_paye, statut from phone_credit_sales where txn_id = $1`, [txn])).rows[0]

  // ── Create the ordered phone ──────────────────────────────────────────
  const bad = await manager('/api/phones/commande', { method: 'POST', body: { marque: 'Apple', model: '17 Pro', prix: 100 } })
  check('ordered phone: the naming rule applies (short model refused, 400)', bad.status === 400, bad.status)
  const byStaff = await staff('/api/phones/commande', { method: 'POST', body: { marque: 'Apple', model: 'iPhone 17 Pro', prix: 100 } })
  check('an employee cannot order a phone (403)', byStaff.status === 403, byStaff.status)
  const o1 = await order(`iPhone 17 Pro E2E1 ${tag}`, 15000)
  const p1 = o1.data?.data?.phone_id
  const r1 = await phoneRow(p1)
  check('ordered phone created: "en commande", no IMEI', o1.status === 201 && r1.en_commande === true && r1.imei === null && r1.status === 'disponible', { s: o1.status, r1 })
  const stock = await manager(`/api/phones?status=disponible&store_id=${STORE}&limit=5000`)
  check('it is not in the phones for sale (POS grid)', !(stock.data?.data ?? []).some(p => p.phone_id === p1), stock.status)

  // ── Sold only "Plusieurs fois", kept at the shop ─────────────────────
  const cash = await sell({ device_id: p1, prix_vente: 15000, payment_method: 'especes' })
  check('a cash sale of an ordered phone is refused (400)', cash.status === 400, cash.status)
  const handed = await sell({ device_id: p1, prix_vente: 15000, payment_method: 'credit', avance: 3000, dossier: { phone_remis: true } })
  check('a plan sale "client takes it" is refused (400)', handed.status === 400, handed.status)
  const s1 = await sell({ device_id: p1, prix_vente: 15000, payment_method: 'credit', avance: 3000, dossier: { phone_remis: false } })
  const f1 = await fileOf(s1.data?.data?.txn_id)
  check('sold "Plusieurs fois" with a 3 000 advance, kept: phone Réservé, file open', s1.status === 201 && (await phoneRow(p1)).status === 'reserve' && f1?.phone_remis === false && n(f1?.montant_paye) === 3000, { s: s1.status, e: s1.data?.error, f1 })

  // ── Not handed over / discharged before it arrives ────────────────────
  const give = await manager(`/api/phone-credits/${f1?.credit_id}/remise`, { method: 'POST', body: { remis: true, motif: 'trop tôt' } })
  check('cannot hand it over before it arrives (400)', give.status === 400, { s: give.status, e: give.data?.error })
  const disc = await manager(`/api/phone-credits/${f1?.credit_id}/discharge`, { method: 'POST', body: {} })
  check('cannot discharge before it arrives (400)', disc.status === 400, disc.status)

  // ── Arrival: the IMEI validates it ───────────────────────────────────
  const { rows: [other] } = await db.query(`insert into phones (store_id, source, condition, marque, model, status, imei) values ($1,'fournisseur','neuf','Apple',$2,'disponible',$3) returning phone_id, imei`, [STORE, `iPhone E2E twin ${tag}`, `35${crypto.randomInt(1e12, 9e12)}`])
  made.phones.push(other.phone_id)
  const dup = await manager('/api/phones', { method: 'PATCH', body: { phone_id: p1, imei: other.imei } })
  check('an IMEI already in the shop is refused (409)', dup.status === 409, dup.status)
  const imei = `35${crypto.randomInt(1e12, 9e12)}`
  const arrive = await manager('/api/phones', { method: 'PATCH', body: { phone_id: p1, imei, prix_achat: 12000 } })
  const r1b = await phoneRow(p1)
  check('typing its IMEI validates it: no longer "en commande", still reserved for the client', arrive.status === 200 && r1b.en_commande === false && r1b.imei === imei && r1b.status === 'reserve', { s: arrive.status, r1b })
  const give2 = await manager(`/api/phone-credits/${f1?.credit_id}/remise`, { method: 'POST', body: { remis: true, motif: 'le client vient le chercher' } })
  check('once arrived, the client can take it (Vendu)', give2.status === 200 && (await phoneRow(p1)).status === 'vendu', { s: give2.status, e: give2.data?.error })

  // ── Cancelled orders: the money chosen each time ─────────────────────
  const cancelCase = async (label, argent, avance) => {
    const o = await order(`iPhone 17 Pro E2E${label} ${tag}`, 14000)
    const s = await sell({ device_id: o.data?.data?.phone_id, prix_vente: 14000, payment_method: 'credit', avance, dossier: { phone_remis: false } })
    const f = await fileOf(s.data?.data?.txn_id)
    return { phone: o.data?.data?.phone_id, txn: s.data?.data?.txn_id, file: f }
  }
  const c2 = await cancelCase('2', 'avoir', 2000)
  const byStaffC = await staff(`/api/phone-credits/${c2.file?.credit_id}/cancel`, { method: 'POST', body: { motif: 'test', argent: 'avoir' } })
  check('an employee cannot cancel an order (403)', byStaffC.status === 403, byStaffC.status)
  const can2 = await manager(`/api/phone-credits/${c2.file?.credit_id}/cancel`, { method: 'POST', body: { motif: 'client renonce', argent: 'avoir' } })
  const ret2 = (await db.query(`select qty, montant, mode, avoir_solde from retours where txn_id = $1`, [c2.txn])).rows[0]
  const sale2 = (await db.query(`select prix_vente, voided from transactions where txn_id = $1`, [c2.txn])).rows[0]
  check('cancel → store credit: 2 000 in avoir, sale kept at what was paid, ordered phone removed, file cancelled',
    can2.status === 200 && n(ret2?.montant) === 2000 && ret2?.mode === 'avoir' && n(ret2?.avoir_solde) === 2000 && n(sale2.prix_vente) === 2000 && sale2.voided === false
    && (await phoneRow(c2.phone)).is_deleted === true && (await fileOf(c2.txn)).statut === 'annule', { s: can2.status, e: can2.data?.error, ret2, sale2 })

  const c3 = await cancelCase('3', 'garder', 1000)
  const can3 = await manager(`/api/phone-credits/${c3.file?.credit_id}/cancel`, { method: 'POST', body: { motif: 'client disparu', argent: 'garder' } })
  const ret3 = (await db.query(`select count(*)::int c from retours where txn_id = $1`, [c3.txn])).rows[0].c
  const sale3 = (await db.query(`select prix_vente from transactions where txn_id = $1`, [c3.txn])).rows[0]
  check('cancel → kept: no refund, the 1 000 advance stays as income', can3.status === 200 && ret3 === 0 && n(sale3.prix_vente) === 1000, { s: can3.status, e: can3.data?.error, ret3, sale3 })

  const c4 = await cancelCase('4', 'rembourser_especes', 1500)
  const can4 = await manager(`/api/phone-credits/${c4.file?.credit_id}/cancel`, { method: 'POST', body: { motif: 'pas trouvé', argent: 'rembourser_especes' } })
  const ret4 = (await db.query(`select montant, mode, date::text d from retours where txn_id = $1`, [c4.txn])).rows[0]
  check('cancel → refund in cash: 1 500 back today (leaves today\'s caisse)', can4.status === 200 && n(ret4?.montant) === 1500 && ret4?.mode === 'especes' && ret4?.d === today, { s: can4.status, e: can4.data?.error, ret4 })

  // a normal (not ordered) file is still cancelled by the owner only
  const { rows: [normal] } = await db.query(`insert into phones (store_id, source, condition, marque, serie, model, status, prix_achat, prix_vente_recommande) values ($1,'fournisseur','occasion','Apple','iPhone 13',$2,'disponible',1000,3000) returning phone_id`, [STORE, `iPhone 13 E2E normal ${tag}`])
  made.phones.push(normal.phone_id)
  const sN = await sell({ device_id: normal.phone_id, prix_vente: 3000, payment_method: 'credit', avance: 500, dossier: { phone_remis: true } })
  const fN = await fileOf(sN.data?.data?.txn_id)
  const canN = await manager(`/api/phone-credits/${fN?.credit_id}/cancel`, { method: 'POST', body: { motif: 'test' } })
  check('a normal file: a manager still cannot cancel it (owner only, 403)', canN.status === 403, canN.status)
  const canO = await owner(`/api/phone-credits/${fN?.credit_id}/cancel`, { method: 'POST', body: { motif: 'test proprio' } })
  check('…the owner still can (as before)', canO.status === 200, canO.status)

  // ── An order abandoned at the POS ─────────────────────────────────────
  const o5 = await order(`iPhone 17 Pro E2E5 ${tag}`, 13000)
  const del5 = await manager(`/api/phones/commande?phone_id=${o5.data?.data?.phone_id}`, { method: 'DELETE' })
  check('an ordered phone removed from the cart before its sale is deleted', del5.status === 200 && (await phoneRow(o5.data?.data?.phone_id)).is_deleted === true, del5.status)
  const delSold = await manager(`/api/phones/commande?phone_id=${p1}`, { method: 'DELETE' })
  check('…but not once it has a sale (409 / 404)', delSold.status === 409 || delSold.status === 404, delSold.status)
} catch (err) {
  check('script ran to the end', false, String(err?.stack ?? err))
} finally {
  try {
    const txns = (await db.query(`select txn_id from transactions where created_by = any($1)`, [userIds])).rows.map(r => r.txn_id)
    await db.query(`delete from activity_log where user_id = any($1)`, [userIds])
    await db.query(`delete from retours where txn_id = any($1)`, [txns])
    await db.query(`delete from phone_credit_echeances where credit_id in (select credit_id from phone_credit_sales where txn_id = any($1))`, [txns]).catch(() => {})
    await db.query(`delete from phone_credit_payments where credit_id in (select credit_id from phone_credit_sales where txn_id = any($1))`, [txns])
    await db.query(`delete from phone_credit_sales where txn_id = any($1)`, [txns])
    await db.query(`delete from transactions where txn_id = any($1)`, [txns])
    await db.query(`delete from phones where phone_id = any($1)`, [made.phones])
    await db.query(`delete from clients where client_id = any($1)`, [made.clients])
    if (made.caisse) await db.query(`delete from caisse where caisse_id = $1`, [made.caisse])
  } catch (e) { console.error('cleanup:', e.message) }
  await db.query(`delete from user_profiles where id = any($1)`, [userIds]).catch(() => {})
  await db.end()
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  → ${r.detail}`}`)
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
