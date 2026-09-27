// End-to-end checks of supplier payments against a running ERP dev server
// (default http://localhost:3100, override with E2E_BASE) whose env points at
// a TEST database branch (DIRECT_URL).
//
// Owner's rule (2026-09-28): one logic for every supplier category — owed
// once sold, paying settles chosen sold phones (credit used first), an
// advance adds credit, the old "paiement_b" can no longer be created.
//
//   node scripts/e2e-suppliers.mjs
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

try {
  const password = crypto.randomBytes(12).toString('base64url')
  const email = 'zz-e2e-suppliers@migration.local'
  await db.query(`delete from user_profiles where email = $1`, [email])
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, 'E2E suppliers', 'gerant', $3, true, true) returning id`, [email, await bcrypt.hash(password, 10), STORE])
  cleanups.push(async () => { await db.query(`delete from activity_log where user_id = $1`, [u.id]); await db.query(`delete from user_profiles where id = $1`, [u.id]) })
  const api = await login(email, password)

  // A non-"A" supplier with at least 2 sold phones waiting
  const { rows: [sup] } = await db.query(
    `select supplier_id, type_fournisseur from suppliers_summary where store_id = $1 and type_fournisseur <> 'A' and nb_a_regler >= 2 order by nb_a_regler desc limit 1`, [STORE])
  if (!sup) throw new Error('no non-A supplier with 2 sold phones waiting on the test branch')
  const summary = async () => (await api(`/api/suppliers?store_id=${STORE}`)).data?.data?.find(s => s.supplier_id === sup.supplier_id)
  const before = await summary()
  check(`summary has the new figures (supplier ${sup.type_fournisseur})`, before && 'credit_total' in before && 'nb_a_regler' in before, before && Object.keys(before))

  const list = await api(`/api/supplier-payments?mode=unsettled_phones&supplier_id=${sup.supplier_id}`)
  const rows = list.data?.data ?? []
  check(`category ${sup.type_fournisseur}: sold phones to settle listed`, list.status === 200 && rows.length === n(before.nb_a_regler), { status: list.status, rows: rows.length, nb: before?.nb_a_regler })

  const payIds = []
  const pay = async body => {
    const r = await api('/api/supplier-payments', { method: 'POST', body: { supplier_id: sup.supplier_id, store_id: STORE, date_paiement: new Date().toISOString().slice(0, 10), ...body } })
    const id = r.data?.data?.payment_id
    if (id) payIds.push(id)
    return r
  }
  cleanups.push(async () => {
    const two = rows.slice(0, 2).map(r => r.phone_id)
    await db.query(`update phones set settled_at = null, settled_by = null where phone_id = any($1)`, [two])
    if (payIds.length) {
      await db.query(`delete from activity_log where record_id = any($1)`, [payIds])
      await db.query(`delete from supplier_payments where payment_id = any($1)`, [payIds])
    }
  })

  const old = await pay({ payment_type: 'paiement_b', montant: 10, phone_ids: [rows[0].phone_id] })
  check('old "paiement_b" refused', old.status === 400, old)
  const short = await pay({ payment_type: 'reglement_a', montant: 1, phone_ids: [rows[0].phone_id] })
  check('règlement below the amount owed refused', short.status >= 400 && short.status < 500 || n(before.credit_total) + 1 >= n(rows[0].cash_recu), short)

  const adv = await pay({ payment_type: 'avance_a', montant: 100, phone_ids: [] })
  check('advance accepted', adv.status === 201 || adv.status === 200, adv)
  const afterAdv = await summary()
  check('advance adds 100 to the credit', Math.abs(n(afterAdv.credit_total) - n(before.credit_total) - 100) < 0.01, { before: before.credit_total, after: afterAdv.credit_total })
  check('advance lowers what is left to pay', n(afterAdv.solde_du) <= n(before.solde_du), { before: before.solde_du, after: afterAdv.solde_du })

  const two = rows.slice(0, 2)
  const due = two.reduce((s, r) => s + n(r.cash_recu), 0)
  const toPay = Math.max(0, Math.round((due - n(afterAdv.credit_total)) * 100) / 100)
  const reg = await pay({ payment_type: 'reglement_a', montant: toPay, phone_ids: two.map(r => r.phone_id) })
  check('règlement of 2 sold phones (credit used first)', reg.status === 201 || reg.status === 200, reg)
  const list2 = (await api(`/api/supplier-payments?mode=unsettled_phones&supplier_id=${sup.supplier_id}`)).data?.data ?? []
  check('paid phones leave the list', two.every(t => !list2.some(r => r.phone_id === t.phone_id)) && list2.length === rows.length - 2, { left: list2.length })
  const afterReg = await summary()
  // the credit already lowered the balance; what was paid now lowers it by the rest
  check('what is left to pay went down by the amount paid', Math.abs((n(afterAdv.solde_du) - n(afterReg.solde_du)) - toPay) < 0.01,
    { before: afterAdv.solde_du, after: afterReg.solde_du, paid: toPay })
  check('credit used up by the règlement', n(afterReg.credit_total) === Math.max(0, n(afterAdv.credit_total) - due), afterReg.credit_total)
  const again = await pay({ payment_type: 'reglement_a', montant: due, phone_ids: [two[0].phone_id] })
  check('settling the same phone twice refused', again.status === 409, again)
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
