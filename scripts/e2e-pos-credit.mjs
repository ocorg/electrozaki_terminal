// End-to-end checks of "paid in several times" at the POS against a running
// ERP dev server (default http://localhost:3100, override with E2E_BASE)
// whose env points at a TEST database branch (DIRECT_URL).
//
// Owner's rules (2026-10-04): one credit system. A phone paid in several
// times = a real POS sale + its credit file (dossier), managers only;
// accessories go on the client's account; employees can't sell on credit.
//
//   node scripts/e2e-pos-credit.mjs
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
const n = v => (v == null ? null : Number(v))
const tag = crypto.randomBytes(3).toString('hex')

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
  const email = `zz-e2e-poscredit-${role}@migration.local`
  await db.query(`delete from user_profiles where email = $1`, [email]).catch(() => {})
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, $5, true, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E poscredit ${role}`, role, STORE])
  userIds.push(u.id)
  return await login(email, password)
}

const phones = [], txns = []
async function newPhone(prix) {
  const { rows: [p] } = await db.query(
    `insert into phones (store_id, source, condition, marque, serie, model, status, prix_achat, prix_vente_recommande)
     values ($1, 'fournisseur', 'occasion', 'Apple', 'iPhone 13', $2, 'disponible', $3, $4) returning phone_id`, [STORE, `E2E pf ${tag}`, prix - 500, prix])
  phones.push(p.phone_id)
  return p.phone_id
}
const sell = async (api, body) => {
  const r = await api('/api/transactions', { method: 'POST', body: { store_id: STORE, type_operation: 'vente', ...body } })
  if (r.data?.data?.txn_id) txns.push(r.data.data.txn_id)
  return r
}
const dossierOf = async phoneId => (await db.query(`select c.*, s.montant_restant from phone_credit_sales c join phone_credits_summary s using (credit_id) where c.phone_id = $1 order by c.created_at desc limit 1`, [phoneId])).rows[0]
const phoneStatus = async id => (await db.query(`select status from phones where phone_id = $1`, [id])).rows[0]?.status

try {
  const manager = await makeUser('gerant')
  const owner   = await makeUser('proprietaire')
  const staff   = await makeUser('employe')
  const { rows: [client] } = await db.query(`insert into clients (nom, telephone, store_id) values ($1, $2, $3) returning client_id`, [`E2E PF ${tag}`, `06${Date.now()}`.slice(0, 10), STORE])
  const { rows: [acc] } = await db.query(`select acc_id, quantite from accessories where store_id = $1 and not is_deleted and quantite > 5 limit 1`, [STORE])
  const solde = async () => n((await db.query(`select solde_impaye from client_summary where client_id = $1`, [client.client_id])).rows[0].solde_impaye)
  cleanups.push(async () => {
    const credits = (await db.query(`select credit_id from phone_credit_sales where phone_id = any($1)`, [phones])).rows.map(r => r.credit_id)
    const pays = (await db.query(`select payment_id from phone_credit_payments where credit_id = any($1)`, [credits])).rows.map(r => r.payment_id)
    await db.query(`delete from activity_log where record_id = any($1) or user_id = any($2)`, [[...phones, ...txns, ...credits, ...pays], userIds])
    await db.query(`delete from phone_credit_payments where credit_id = any($1)`, [credits])
    await db.query(`delete from phone_credit_sales where credit_id = any($1)`, [credits])
    await db.query(`update phones set origine_phone_id = null, txn_ref_id = null where phone_id = any($1)`, [phones])
    await db.query(`delete from transactions where txn_id = any($1)`, [txns])
    await db.query(`delete from phones where phone_id = any($1)`, [phones])
    await db.query(`update accessories set quantite = $2, updated_by = null where acc_id = $1`, [acc.acc_id, acc.quantite])
    await db.query(`delete from clients where client_id = $1`, [client.client_id])
    await db.query(`delete from user_profiles where id = any($1)`, [userIds])
  })

  // ── Employees: paid in full only ──────────────────────────────────
  const P0 = await newPhone(3000)
  const s1 = await sell(staff, { device_type: 'telephone', device_id: P0, client_id: client.client_id, prix_vente: 3000, payment_method: 'credit' })
  check('staff: sale on credit refused (403)', s1.status === 403, s1)
  const s2 = await sell(staff, { device_type: 'telephone', device_id: P0, client_id: client.client_id, prix_vente: 3000, payment_method: 'especes', avance: 1000 })
  check('staff: sale with a down payment refused (403)', s2.status === 403, s2)
  const s3 = await sell(staff, { device_type: 'telephone', device_id: P0, client_id: client.client_id, prix_vente: 3000, payment_method: 'especes', dossier: { phone_remis: true } })
  check('staff: cannot create a credit file (403)', s3.status === 403, s3)
  check('…and the phone is still for sale', await phoneStatus(P0) === 'disponible')

  // ── Manager: phone in several times, client takes it ──────────────
  const m1 = await sell(manager, { device_type: 'telephone', device_id: P0, client_id: client.client_id, prix_vente: 3000, payment_method: 'especes', avance: 1000, dossier: { phone_remis: true } })
  const d1 = await dossierOf(P0)
  check('manager: sale + file created together', m1.status === 201 && d1?.txn_id === m1.data?.data?.txn_id && d1.client_id === client.client_id, { s: m1.status, d1: d1 && { txn: d1.txn_id } })
  check('file: total 3000, down payment 1000 counted, 2000 left, phone sold', d1 && n(d1.montant_total) === 3000 && n(d1.avance_vente) === 1000 && n(d1.montant_paye) === 1000 && n(d1.montant_restant) === 2000 && await phoneStatus(P0) === 'vendu', d1 && { paye: d1.montant_paye, reste: d1.montant_restant })
  check('the sale is a real transaction (figures, warranty)', !!m1.data?.data?.warranty_expiry && m1.data?.data?.voided === false, m1.data?.data && Object.keys(m1.data.data).length)
  check('client account does not count a sale followed by a file', await solde() === 0, await solde())
  const { rows: [noLine] } = await db.query(`select count(*)::int n from credit_imports where client_id = $1`, [client.client_id])
  check('no duplicate "POS —" line is created any more', noLine.n === 0, noLine)

  // ── Accessories on credit go on the client's account ──────────────
  const a1 = await sell(manager, { device_type: 'accessoire', device_id: acc.acc_id, client_id: client.client_id, prix_vente: 150, payment_method: 'credit' })
  check('accessory on credit: on the client account (150)', a1.status === 201 && await solde() === 150, { s: a1.status, solde: await solde() })
  const a2 = await sell(manager, { device_type: 'accessoire', device_id: acc.acc_id, client_id: client.client_id, prix_vente: 150, payment_method: 'credit', dossier: { phone_remis: true } })
  check('a file is for a phone only (400)', a2.status === 400, a2)

  // ── Payments on the file ──────────────────────────────────────────
  const pay = await manager(`/api/phone-credits/${d1.credit_id}/payments`, { method: 'POST', body: { montant: 500, payment_method: 'especes' } })
  const d1b = await dossierOf(P0)
  check('payment 500: paid 1500, 1500 left', pay.status === 201 && n(d1b.montant_paye) === 1500 && n(d1b.montant_restant) === 1500, d1b && { paye: d1b.montant_paye })
  const pid = pay.data?.data?.payment?.payment_id ?? pay.data?.data?.payment_id
  const del = await manager(`/api/phone-credits/${d1.credit_id}/payments/${pid}?motif=erreur%20saisie`, { method: 'DELETE' })
  check('payment deleted: back to 1000 paid (down payment kept)', del.status === 200 && n((await dossierOf(P0)).montant_paye) === 1000, del)
  const tot = await manager(`/api/phone-credits/${d1.credit_id}`, { method: 'PATCH', body: { montant_total: 2800, motif: 'remise 200' } })
  const { rows: [tx1] } = await db.query(`select prix_vente from transactions where txn_id = $1`, [d1.txn_id])
  check('total changed on the file → the sale price follows (2800)', tot.status === 200 && n(tx1.prix_vente) === 2800 && n((await dossierOf(P0)).montant_restant) === 1800, { tx: tx1 })
  const full = await manager(`/api/phone-credits/${d1.credit_id}/payments`, { method: 'POST', body: { montant: 1800, payment_method: 'virement' } })
  const dis = await manager(`/api/phone-credits/${d1.credit_id}/discharge`, { method: 'POST', body: {} })
  check('paid in full → soldé → discharged, phone sold', full.status === 201 && dis.status === 200 && await phoneStatus(P0) === 'vendu' && (await dossierOf(P0)).statut === 'solde', { full: full.status, dis: dis.status })

  // ── Reserved phone, then the owner cancels: sale voided ───────────
  const P1 = await newPhone(4000)
  const m2 = await sell(manager, { device_type: 'telephone', device_id: P1, client_id: client.client_id, prix_vente: 4000, payment_method: 'credit', dossier: { phone_remis: false } })
  const d2 = await dossierOf(P1)
  check('no down payment, phone kept: reserved, 4000 left', m2.status === 201 && await phoneStatus(P1) === 'reserve' && n(d2.montant_restant) === 4000 && d2.phone_remis === false, { s: m2.status, st: await phoneStatus(P1) })
  const again = await sell(manager, { device_type: 'telephone', device_id: P1, client_id: client.client_id, prix_vente: 4000, payment_method: 'credit', dossier: { phone_remis: true } })
  check('a phone with an open file cannot get a second one', again.status === 400, again)
  const cancel = await owner(`/api/phone-credits/${d2.credit_id}/cancel`, { method: 'POST', body: { motif: 'le client renonce' } })
  const { rows: [tx2] } = await db.query(`select voided, voided_reason from transactions where txn_id = $1`, [d2.txn_id])
  check('owner cancels the file: sale voided, phone back for sale', cancel.status === 200 && tx2.voided === true && await phoneStatus(P1) === 'disponible', { c: cancel.status, tx2 })

  // ── With a trade-in handed over at the POS ────────────────────────
  const P2 = await newPhone(5000)
  const m3 = await sell(manager, { device_type: 'telephone', device_id: P2, client_id: client.client_id, type_operation: 'echange', prix_vente: 5000, payment_method: 'especes', avance: 1000, valeur_echange: 1500, marque_echange: 'Samsung', model_echange: `E2E pf repris ${tag}`, dossier: { phone_remis: true } })
  const d3 = await dossierOf(P2)
  check('file with trade-in: 5000 − 1500 − 1000 = 2500 left', m3.status === 201 && d3.has_reprise && n(d3.reprise_valeur) === 1500 && n(d3.montant_restant) === 2500, d3 && { reste: d3.montant_restant })
  const intake = await manager('/api/phones', { method: 'POST', body: { store_id: STORE, marque: 'Samsung', model: `E2E pf repris ${tag}`, imei: `37${Date.now()}`.slice(0, 15), prix_achat: 1500, condition: 'occasion', source: 'echange', status: 'disponible', txn_ref_id: m3.data?.data?.txn_id, tradein_for: [P2] } })
  if (intake.data?.data?.phone_id) phones.push(intake.data.data.phone_id)
  check('trade-in recorded at the POS is linked to the file', (await dossierOf(P2)).reprise_phone_id === intake.data?.data?.phone_id, intake.status)
  await manager(`/api/phone-credits/${d3.credit_id}/payments`, { method: 'POST', body: { montant: 2500, payment_method: 'especes' } })
  const before = (await db.query(`select count(*)::int n from phones where model = $1`, [`E2E pf repris ${tag}`])).rows[0].n
  const dis3 = await manager(`/api/phone-credits/${d3.credit_id}/discharge`, { method: 'POST', body: {} })
  const after = (await db.query(`select count(*)::int n from phones where model = $1`, [`E2E pf repris ${tag}`])).rows[0].n
  check('discharge does not create the trade-in a second time', dis3.status === 200 && before === 1 && after === 1, { before, after })

  // ── Nothing left to pay → no file ─────────────────────────────────
  const P3 = await newPhone(2000)
  const m4 = await sell(manager, { device_type: 'telephone', device_id: P3, client_id: client.client_id, prix_vente: 2000, payment_method: 'especes', avance: 2000, dossier: { phone_remis: true } })
  check('down payment covers everything: refused, sell it normally', m4.status === 400 && await phoneStatus(P3) === 'disponible', m4)
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
