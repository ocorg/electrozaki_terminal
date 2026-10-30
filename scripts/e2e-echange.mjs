// End-to-end checks of the SAV phone exchange (owner, 2026-10-30) against a
// running ERP dev server (default http://localhost:3100, override E2E_BASE)
// whose env points at a TEST database branch (DIRECT_URL).
//
// A client brings back the phone of a sale and leaves with another one: the
// sale (and its payment-plan file) moves to the new phone, the old one goes
// back, a price difference is settled today or on the plan.
//
//   node scripts/e2e-echange.mjs
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
  const email = `zz-e2e-echange-${role}@migration.local`
  await db.query(`delete from user_profiles where email = $1`, [email]).catch(() => {})
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, $5, true, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E échange ${role}`, role, STORE])
  userIds.push(u.id)
  return await login(email, password)
}

const made = { phones: [], txns: [], clients: [], credits: [], retours: [] }
const phone = async (label, price, cost = 1000) => {
  const { rows: [p] } = await db.query(
    `insert into phones (store_id, source, condition, marque, serie, model, status, prix_achat, prix_vente_recommande, imei)
     values ($1, 'fournisseur', 'occasion', 'Apple', 'iPhone 13', $2, 'disponible', $3, $4, $5) returning phone_id`,
    [STORE, `iPhone 13 E2E ${label} ${tag}`, cost, price, `35${crypto.randomInt(1e12, 9e12)}`])
  made.phones.push(p.phone_id)
  return p.phone_id
}
const status = async id => (await db.query(`select status, is_damaged from phones where phone_id = $1`, [id])).rows[0]

try {
  const manager = await makeUser('gerant')
  const staff   = await makeUser('employe')
  const { rows: [cz] } = await db.query(`select caisse_id from caisse where store_id = $1 and date = $2`, [STORE, today])
  let madeCaisse = null
  if (!cz) made.caisse = madeCaisse = (await db.query(`insert into caisse (date, ouverture, store_id, status) values ($1, 0, $2, 'ouverte') returning caisse_id`, [today, STORE])).rows[0].caisse_id
  // What the day's caisse counts as cash from sales (same rule as /api/caisse, read in the database)
  const caisse = async () => {
    const { rows: [r] } = await db.query(
      `select coalesce(sum(case when payment_method = 'especes' then prix_vente - coalesce(valeur_echange, 0) - coalesce(avoir_montant, 0) else 0 end), 0) as cash
       from transactions where store_id = $1 and date_vente = $2 and voided = false and payment_method = 'especes'`, [STORE, today])
    return { solde_theorique: Number(r.cash) }
  }
  const { rows: [client] } = await db.query(`insert into clients (nom, telephone, store_id) values ($1, $2, $3) returning client_id`, [`E2E Échange ${tag}`, `06${crypto.randomInt(1e7, 9e7)}`, STORE])
  made.clients.push(client.client_id)
  const sell = async (body) => {
    const r = await manager('/api/transactions', { method: 'POST', body: { store_id: STORE, device_type: 'telephone', type_operation: 'vente', qty: 1, warranty_start: today, client_id: client.client_id, ...body } })
    if (r.data?.data?.txn_id) made.txns.push(r.data.data.txn_id)
    return r
  }
  const swap = (body) => manager('/api/echanges', { method: 'POST', body: { destination: 'reparation', motif: 'son faible', ...body } })

  // ── 1. Cash sale, same price ──────────────────────────────────────────
  const A1 = await phone('A1', 4000), B1 = await phone('B1', 4000, 1200)
  const s1 = await sell({ device_id: A1, prix_vente: 4000, payment_method: 'especes' })
  const c0 = await caisse()
  const e1 = await swap({ txn_id: s1.data?.data?.txn_id, new_phone_id: B1, nouveau_prix: 4000 })
  const sale1 = (await db.query(`select device_id, prix_vente from transactions where txn_id = $1`, [s1.data?.data?.txn_id])).rows[0]
  const c1 = await caisse()
  check('same-price exchange: the sale now carries the new phone, the old one goes to repair, the new one is sold, caisse unchanged',
    e1.status === 201 && sale1.device_id === B1 && n(sale1.prix_vente) === 4000 && (await status(A1)).status === 'en_reparation' && (await status(B1)).status === 'vendu'
    && n(c1.solde_theorique) === n(c0.solde_theorique), { s: e1.status, e: e1.data?.error, sale1 })
  const again = await swap({ txn_id: s1.data?.data?.txn_id, new_phone_id: A1, nouveau_prix: 4000 })
  check('the returned phone (in repair) cannot be handed out again (409)', again.status === 409, again.status)

  // ── 2. More expensive, paid in cash today ─────────────────────────────
  const A2 = await phone('A2', 3000), B2 = await phone('B2', 3500)
  const s2 = await sell({ device_id: A2, prix_vente: 3000, payment_method: 'especes' })
  const c2a = await caisse()
  const e2 = await swap({ txn_id: s2.data?.data?.txn_id, new_phone_id: B2, nouveau_prix: 3500, reglement: 'especes', destination: 'stock' })
  const c2b = await caisse()
  const line = (await db.query(`select txn_id, prix_vente, payment_method, date_vente::text d from transactions where notes like $1`, [`Complément d'échange ${s2.data?.data?.txn_id}%`])).rows[0]
  if (line) made.txns.push(line.txn_id)
  check('more expensive phone: +500 cash as a "Complément d\'échange" line of today, in the caisse; the old phone back for sale',
    e2.status === 201 && n(line?.prix_vente) === 500 && line?.d === today && n(c2b.solde_theorique) - n(c2a.solde_theorique) === 500 && (await status(A2)).status === 'disponible',
    { s: e2.status, e: e2.data?.error, line, diff: n(c2b?.solde_theorique) - n(c2a?.solde_theorique) })

  // ── 3. Cheaper, given back as a store credit ──────────────────────────
  const A3 = await phone('A3', 3000), B3 = await phone('B3', 2600)
  const s3 = await sell({ device_id: A3, prix_vente: 3000, payment_method: 'especes' })
  const e3 = await swap({ txn_id: s3.data?.data?.txn_id, new_phone_id: B3, nouveau_prix: 2600, reglement: 'avoir', destination: 'defectueux' })
  const back3 = (await db.query(`select retour_id, qty, montant, mode, avoir_solde from retours where txn_id = $1`, [s3.data?.data?.txn_id])).rows[0]
  if (back3) made.retours.push(back3.retour_id)
  const a3 = await status(A3)
  check('cheaper phone: 400 back as a store credit (0 unit returned); the old phone flagged faulty',
    e3.status === 201 && back3?.qty === 0 && n(back3?.montant) === 400 && back3?.mode === 'avoir' && n(back3?.avoir_solde) === 400 && a3.status === 'disponible' && a3.is_damaged,
    { s: e3.status, e: e3.data?.error, back3, a3 })

  // ── 4. Payment plan ("Plusieurs fois"), difference added to the plan ──
  const A4 = await phone('A4', 5000), B4 = await phone('B4', 5600)
  const s4 = await sell({ device_id: A4, prix_vente: 5000, payment_method: 'credit', avance: 1000, dossier: { phone_remis: true } })
  const file = (await db.query(`select credit_id from phone_credit_sales where txn_id = $1`, [s4.data?.data?.txn_id])).rows[0]
  if (file) made.credits.push(file.credit_id)
  const look = await manager(`/api/echanges?phone_id=${A4}`)
  check('Téléphones lookup finds the sale and its open file', look.status === 200 && look.data?.data?.txn_id === s4.data?.data?.txn_id && look.data?.data?.file?.open === true, look.data)
  const refuse = await swap({ txn_id: s4.data?.data?.txn_id, new_phone_id: B4, nouveau_prix: 4800, reglement: 'especes' })
  check('cheaper phone on an unpaid plan: money cannot be given back (400)', refuse.status === 400, { s: refuse.status, e: refuse.data?.error })
  const e4 = await swap({ txn_id: s4.data?.data?.txn_id, new_phone_id: B4, nouveau_prix: 5600, reglement: 'dossier' })
  const f4 = (await db.query(`select phone_id, montant_total, montant_paye, statut from phone_credit_sales where credit_id = $1`, [file?.credit_id])).rows[0]
  const sale4 = (await db.query(`select device_id, prix_vente from transactions where txn_id = $1`, [s4.data?.data?.txn_id])).rows[0]
  check('payment plan: the file follows the new phone, +600 on its total (and on the sale), payments kept',
    e4.status === 201 && f4.phone_id === B4 && n(f4.montant_total) === 5600 && n(f4.montant_paye) === 1000 && f4.statut === 'en_cours'
    && sale4.device_id === B4 && n(sale4.prix_vente) === 5600 && (await status(B4)).status === 'vendu' && (await status(A4)).status === 'en_reparation',
    { s: e4.status, e: e4.data?.error, f4, sale4 })

  // ── 5. Refusals ───────────────────────────────────────────────────────
  const A5 = await phone('A5', 2000), B5 = await phone('B5', 2000)
  const s5 = await sell({ device_id: A5, prix_vente: 2000, payment_method: 'especes' })
  const byStaff = await staff('/api/echanges', { method: 'POST', body: { txn_id: s5.data?.data?.txn_id, new_phone_id: B5, nouveau_prix: 2000, destination: 'stock', motif: 'test' } })
  check('an employee cannot exchange (403)', byStaff.status === 403, byStaff.status)
  const sold = await swap({ txn_id: s5.data?.data?.txn_id, new_phone_id: B1, nouveau_prix: 2000 })
  check('the new phone must be in stock (sold one refused, 409)', sold.status === 409, sold.status)
  const noHow = await swap({ txn_id: s5.data?.data?.txn_id, new_phone_id: B5, nouveau_prix: 2300 })
  check('a price difference needs a way to settle it (400)', noHow.status === 400, noHow.status)

  // ── 6. History ────────────────────────────────────────────────────────
  // retried: this screen sends many queries at once, a dropped test-database connection is not a failure of the exchange
  const hist = async id => { for (let i = 0; i < 3; i++) { const r = await manager(`/api/phones/${id}/history`); if (r.status === 200) return r } return { status: 500 } }
  const hA = await hist(A1), hB = await hist(B1)
  const has = (h) => JSON.stringify(h.data ?? '').includes('Échange SAV')
  check('both phones show the exchange in their history', has(hA) && has(hB), { a: hA.status, b: hB.status })

  // ── 7. The POS return list offers the exchange on the unpaid plan sale ─
  const list = await manager(`/api/retours?store_id=${STORE}&q=${s4.data?.data?.txn_id}`)
  const row = (list.data?.data ?? []).find(r => r.txn_id === s4.data?.data?.txn_id)
  check('POS → Retours: the plan sale is "unpaid" but exchangeable', row?.unpaid === true && row?.swappable === true && row?.file?.credit_id === file?.credit_id, row)

} catch (err) {
  check('script ran to the end', false, String(err?.stack ?? err))
} finally {
  // always clean up, even after a failure (so a rerun starts clean)
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
  await db.query(`delete from activity_log where user_id = any($1)`, [userIds]).catch(() => {})
  await db.query(`delete from user_profiles where id = any($1)`, [userIds]).catch(() => {})
  await db.end()
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  → ${r.detail}`}`)
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
