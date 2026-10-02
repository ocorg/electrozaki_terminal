// End-to-end checks of phone credit sales (edit, payments, cancel, schedule)
// against a running ERP dev server (default http://localhost:3100, override
// with E2E_BASE) whose env points at a TEST database branch (DIRECT_URL).
//
// Owner's rules (2026-10-02): managers edit details, total, trade-in,
// payments (with a reason, never on a closed caisse day) and the schedule;
// only the owner cancels; a paid-up credit can be discharged.
//
//   node scripts/e2e-credits.mjs
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
const n = v => Number(v ?? 0)
const today = new Date().toISOString().slice(0, 10)

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

async function makeUser(role) {
  const password = crypto.randomBytes(12).toString('base64url')
  const email = `zz-e2e-credits-${role}@migration.local`
  const { rows: old } = await db.query(`select id from user_profiles where email = $1`, [email])
  for (const o of old) { await db.query(`delete from activity_log where user_id = $1`, [o.id]); await db.query(`delete from user_profiles where id = $1`, [o.id]) }
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, $5, true, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E credits ${role}`, role, STORE])
  cleanups.push(async () => { await db.query(`delete from activity_log where user_id = $1`, [u.id]); await db.query(`delete from user_profiles where id = $1`, [u.id]) })
  return { id: u.id, api: await login(email, password) }
}

const credit = async id => (await db.query(`select * from phone_credits_summary s join phone_credit_sales c using (credit_id) where credit_id = $1`, [id])).rows[0]

try {
  const { api: manager } = await makeUser('gerant')
  const { api: owner }   = await makeUser('proprietaire')

  // A test phone, available
  const { rows: [ph] } = await db.query(
    `insert into phones (store_id, source, condition, marque, serie, model, status, prix_achat, prix_vente_recommande)
     values ($1, 'fournisseur', 'occasion', 'Apple', 'iPhone 14', $2, 'disponible', 3000, 4000) returning phone_id`, [STORE, `E2E credit ${crypto.randomBytes(3).toString('hex')}`])
  const creditIds = []
  cleanups.push(async () => {
    for (const id of creditIds) {
      await db.query(`delete from activity_log where record_id = $1 or record_id in (select payment_id from phone_credit_payments where credit_id = $1)`, [id])
      await db.query(`delete from phone_credit_echeances where credit_id = $1`, [id])
      await db.query(`delete from phone_credit_payments where credit_id = $1`, [id])
      await db.query(`delete from phone_credit_sales where credit_id = $1`, [id])
    }
    await db.query(`delete from activity_log where record_id = $1`, [ph.phone_id])
    await db.query(`delete from phones where phone_id = $1`, [ph.phone_id])
  })
  // Today's caisse open (so payments can be fixed); remember to restore
  const { rows: [cz] } = await db.query(`select caisse_id, status from caisse where store_id = $1 and date = $2`, [STORE, today])
  if (!cz) {
    const { rows: [nc] } = await db.query(`insert into caisse (date, ouverture, store_id, status) values ($1, 0, $2, 'ouverte') returning caisse_id`, [today, STORE])
    cleanups.push(() => db.query(`delete from caisse where caisse_id = $1`, [nc.caisse_id]))
  }

  // ── Create: 4000, down payment 1000, phone reserved ───────────────
  const created = await manager('/api/phone-credits', { method: 'POST', body: { phone_id: ph.phone_id, client_name: 'E2E Client', client_tel: '0600000000', montant_total: 4000, avance_initiale: 1000, payment_method: 'especes' } })
  const cid = created.data?.data?.credit?.credit_id
  if (cid) creditIds.push(cid)
  check('credit created (phone reserved)', created.status === 201 && cid, created)

  // ── Edit details and total ────────────────────────────────────────
  const info = await manager(`/api/phone-credits/${cid}`, { method: 'PATCH', body: { client_name: 'E2E Client Modifié', client_cin: 'AB123' } })
  check('manager edits client details (no reason needed)', info.status === 200 && (await credit(cid)).client_name === 'E2E Client Modifié', info)
  const noMotif = await manager(`/api/phone-credits/${cid}`, { method: 'PATCH', body: { montant_total: 3800 } })
  check('changing the total needs a reason', noMotif.status === 400, noMotif)
  const lower = await manager(`/api/phone-credits/${cid}`, { method: 'PATCH', body: { montant_total: 900, motif: 'test' } })
  check('total below what was paid refused', lower.status === 400, lower)
  const total = await manager(`/api/phone-credits/${cid}`, { method: 'PATCH', body: { montant_total: 3800, motif: 'remise 200' } })
  check('total 4000 → 3800, reste 2800', total.status === 200 && n((await credit(cid)).montant_restant) === 2800, { status: total.status, c: await credit(cid) })

  // ── Trade-in added later ──────────────────────────────────────────
  const rep = await manager(`/api/phone-credits/${cid}`, { method: 'PATCH', body: { has_reprise: true, reprise_marque: 'Samsung', reprise_model: 'A12', reprise_valeur: 500, motif: 'reprise ajoutée' } })
  check('trade-in added: reste 2300', rep.status === 200 && n((await credit(cid)).montant_restant) === 2300, rep)

  // ── Schedule: 2 monthly lines, then status ────────────────────────
  const plan = await manager(`/api/phone-credits/${cid}/echeances`, { method: 'PUT', body: { rebase: true, lines: [{ date_echeance: '2020-01-01', montant: 1300 }, { date_echeance: '2099-01-01', montant: 1000 }] } })
  const base = n((await db.query(`select echeancier_base from phone_credit_sales where credit_id = $1`, [cid])).rows[0].echeancier_base)
  check('schedule saved, base = paid so far (1000)', plan.status === 200 && plan.data?.data?.length === 2 && base === 1000, { status: plan.status, base })
  const list = await manager(`/api/phone-credits?store_id=${STORE}&with=echeances`)
  const row = list.data?.data?.find(c => c.credit_id === cid)
  check('reminders list carries the schedule', row?.echeances?.length === 2, row && Object.keys(row))

  // ── Payments: add, fix, delete ────────────────────────────────────
  const pay = await manager(`/api/phone-credits/${cid}/payments`, { method: 'POST', body: { montant: 500, payment_method: 'especes' } })
  const pid = pay.data?.data?.payment?.payment_id ?? pay.data?.data?.payment_id
  check('payment of 500 added', pay.status === 201 && pid, pay)
  const fix = await manager(`/api/phone-credits/${cid}/payments/${pid}`, { method: 'PATCH', body: { montant: 700, motif: 'erreur de saisie' } })
  check('payment fixed 500 → 700, paid 1700', fix.status === 200 && n((await credit(cid)).montant_paye) === 1700, fix)
  const tooHigh = await manager(`/api/phone-credits/${cid}/payments/${pid}`, { method: 'PATCH', body: { montant: 99999, motif: 'x x x' } })
  check('payment above what is owed refused', tooHigh.status === 400, tooHigh)
  // a closed day's payment can't change
  const { rows: [oldPay] } = await db.query(
    `insert into phone_credit_payments (credit_id, montant, payment_method, date_paiement, store_id) values ($1, 100, 'especes', '2020-02-02', $2) returning payment_id`, [cid, STORE])
  await db.query(`insert into caisse (date, ouverture, store_id, status) values ('2020-02-02', 0, $1, 'cloturee') on conflict do nothing`, [STORE])
  cleanups.push(() => db.query(`delete from caisse where date = '2020-02-02' and store_id = $1`, [STORE]))
  const closed = await manager(`/api/phone-credits/${cid}/payments/${oldPay.payment_id}?motif=test%20test`, { method: 'DELETE' })
  check('payment on a closed caisse day refused (409)', closed.status === 409, closed)
  await db.query(`delete from phone_credit_payments where payment_id = $1`, [oldPay.payment_id])
  const backdate = await manager(`/api/phone-credits/${cid}/payments`, { method: 'POST', body: { montant: 50, payment_method: 'especes', date_paiement: '2020-02-02' } })
  check('new payment dated on a closed caisse day refused', backdate.status === 409, backdate)
  const del = await manager(`/api/phone-credits/${cid}/payments/${pid}?motif=doublon%20saisi`, { method: 'DELETE' })
  check('payment deleted, paid back to 1000', del.status === 200 && n((await credit(cid)).montant_paye) === 1000, del)

  // ── Pay in full → soldé → discharge allowed ───────────────────────
  const full = await manager(`/api/phone-credits/${cid}/payments`, { method: 'POST', body: { montant: 2300, payment_method: 'especes' } })
  check('last payment marks the credit soldé', full.status === 201 && (await credit(cid)).statut === 'solde', full)
  const recv = await manager(`/api/phone-credits/${cid}/receive-reprise`, { method: 'POST', body: {} })
  check('trade-in can be received on a soldé credit', recv.status === 200 || recv.status === 201, recv)

  // ── Cancel: owner only ────────────────────────────────────────────
  const mgrCancel = await manager(`/api/phone-credits/${cid}/cancel`, { method: 'POST', body: { motif: 'test' } })
  check('manager cannot cancel', mgrCancel.status === 403, mgrCancel)
  const cancel = await owner(`/api/phone-credits/${cid}/cancel`, { method: 'POST', body: { motif: 'le client renonce' } })
  const { rows: [phAfter] } = await db.query(`select status from phones where phone_id = $1`, [ph.phone_id])
  check('owner cancels: phone back on sale, amount paid reported', cancel.status === 200 && phAfter.status === 'disponible' && cancel.data?.data?.montant_deja_verse === 3300, { status: cancel.status, phone: phAfter, data: cancel.data })
  const afterCancel = await manager(`/api/phone-credits/${cid}`, { method: 'PATCH', body: { client_name: 'X' } })
  check('a cancelled credit can no longer be edited', afterCancel.status === 400, afterCancel)
  const dis = await owner(`/api/phone-credits/${cid}/discharge`, { method: 'POST', body: {} })
  check('a cancelled credit cannot be discharged', dis.status === 400, dis)

  // ── New credit on the same phone, then discharge when paid ────────
  const again = await manager('/api/phone-credits', { method: 'POST', body: { phone_id: ph.phone_id, client_name: 'E2E Client 2', montant_total: 1000, avance_initiale: 1000, payment_method: 'especes' } })
  const cid2 = again.data?.data?.credit?.credit_id
  if (cid2) creditIds.push(cid2)
  const d2 = await manager(`/api/phone-credits/${cid2}/discharge`, { method: 'POST', body: {} })
  const { rows: [ph2] } = await db.query(`select status from phones where phone_id = $1`, [ph.phone_id])
  check('paid-up credit (soldé at once) can be discharged → vendu', again.status === 201 && d2.status === 200 && ph2.status === 'vendu', { again: again.status, d2 })
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
