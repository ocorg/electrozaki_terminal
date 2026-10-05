// End-to-end checks of the money entering / leaving the drawer against a
// running ERP dev server (default http://localhost:3100, override with
// E2E_BASE) whose env points at a TEST database branch (DIRECT_URL).
//
// Owner's rules (2026-10-04): guided "Entrée d'argent" (service = a sale;
// free-text entry managers only), supplier payments say where the money
// comes from (the drawer's cash leaves the caisse), stock bought with the
// drawer's cash is typed on the phone / accessory.
//
//   node scripts/e2e-cash.mjs
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
// The ERP's business day rolls at 4 AM (store clock = UTC)
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
  const email = `zz-e2e-cash-${role}@migration.local`
  await db.query(`delete from user_profiles where email = $1`, [email]).catch(() => {})
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, $5, true, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E cash ${role}`, role, STORE])
  userIds.push(u.id)
  return await login(email, password)
}

try {
  const manager = await makeUser('gerant')
  const staff   = await makeUser('employe')
  const made = { txns: [], phones: [], accs: [], pays: [], drops: [], exps: [] }
  const { rows: [sup] } = await db.query(`insert into suppliers (nom, type_fournisseur, store_id) values ($1, 'A', $2) returning supplier_id`, [`E2E Cash ${tag}`, STORE])
  const { rows: [cz] } = await db.query(`select caisse_id, status from caisse where store_id = $1 and date = $2`, [STORE, today])
  let madeCaisse = null
  if (!cz) madeCaisse = (await db.query(`insert into caisse (date, ouverture, store_id, status) values ($1, 0, $2, 'ouverte') returning caisse_id`, [today, STORE])).rows[0].caisse_id
  const caisse = async () => (await manager(`/api/caisse?store_id=${STORE}&date=${today}`)).data?.data
  cleanups.push(async () => {
    const exps = (await db.query(`select exp_id from expenses where created_by = any($1)`, [userIds])).rows.map(r => r.exp_id)
    const pays = (await db.query(`select payment_id from supplier_payments where supplier_id = $1`, [sup.supplier_id])).rows.map(r => r.payment_id)
    const drops = (await db.query(`select drop_id::text from cash_drops where created_by = any($1)`, [userIds])).rows.map(r => r.drop_id)
    await db.query(`delete from activity_log where user_id = any($1) or record_id = any($2)`, [userIds, [...made.txns, ...made.phones, ...made.accs, ...exps, ...pays, ...drops]])
    await db.query(`delete from expenses where exp_id = any($1)`, [exps])
    await db.query(`delete from cash_drops where created_by = any($1)`, [userIds])
    await db.query(`delete from supplier_payments where supplier_id = $1`, [sup.supplier_id])
    await db.query(`delete from transactions where txn_id = any($1)`, [made.txns])
    await db.query(`delete from phones where phone_id = any($1)`, [made.phones])
    await db.query(`delete from accessories where acc_id = any($1)`, [made.accs])
    await db.query(`update accessories set updated_by = null where updated_by = any($1)`, [userIds])
    await db.query(`delete from suppliers where supplier_id = $1`, [sup.supplier_id])
    if (madeCaisse) await db.query(`delete from caisse where caisse_id = $1`, [madeCaisse])
    await db.query(`delete from user_profiles where id = any($1)`, [userIds])
  })

  // ── Entrée d'argent ───────────────────────────────────────────────
  const { rows: [svc] } = await db.query(`select acc_id from accessories where nom = 'Service divers' and categorie = 'service'`)
  check('the catch-all "Service divers" item exists', !!svc)
  const c0 = await caisse()
  const sale = await staff('/api/transactions', { method: 'POST', body: { store_id: STORE, device_type: 'accessoire', device_id: svc?.acc_id, type_operation: 'vente', qty: 1, prix_vente: 300, payment_method: 'especes', notes: 'Service : changement écran' } })
  if (sale.data?.data?.txn_id) made.txns.push(sale.data.data.txn_id)
  const c1 = await caisse()
  check('staff: a service is a sale (+300 in sales and cash)', sale.status === 201 && n(c1.total_ventes) - n(c0.total_ventes) === 300 && n(c1.payment_breakdown.cash) - n(c0.payment_breakdown.cash) === 300, { s: sale.status, v0: c0?.total_ventes, v1: c1?.total_ventes })
  const freeStaff = await staff('/api/cash-drops', { method: 'POST', body: { amount: 50, reason: 'E2E libre', store_id: STORE } })
  check('staff: free-text money in refused (403)', freeStaff.status === 403, freeStaff)
  const freeMgr = await manager('/api/cash-drops', { method: 'POST', body: { amount: 50, reason: 'E2E libre', store_id: STORE } })
  check('manager: free-text money in still possible', freeMgr.status === 201 || freeMgr.status === 200, freeMgr)

  // ── Supplier payments: where the money comes from ─────────────────
  const c2 = await caisse()
  const out = await manager('/api/supplier-payments', { method: 'POST', body: { supplier_id: sup.supplier_id, store_id: STORE, payment_type: 'avance_a', montant: 400, phone_ids: [], source: 'hors_caisse' } })
  const c3 = await caisse()
  check('supplier paid with cash from elsewhere: caisse untouched', out.status === 201 && n(c3.solde_theorique) === n(c2.solde_theorique) && n(c3.total_fournisseurs) === n(c2.total_fournisseurs), { s: out.status, a: c2?.solde_theorique, b: c3?.solde_theorique })
  const drawer = await manager('/api/supplier-payments', { method: 'POST', body: { supplier_id: sup.supplier_id, store_id: STORE, payment_type: 'avance_a', montant: 250, phone_ids: [], source: 'caisse' } })
  const c4 = await caisse()
  check('supplier paid from the drawer: −250 on the expected cash, shown apart', drawer.status === 201 && n(c3.solde_theorique) - n(c4.solde_theorique) === 250 && n(c4.total_fournisseurs) - n(c3.total_fournisseurs) === 250, { a: c3?.solde_theorique, b: c4?.solde_theorique, f: c4?.total_fournisseurs })
  const wire = await manager('/api/supplier-payments', { method: 'POST', body: { supplier_id: sup.supplier_id, store_id: STORE, payment_type: 'avance_a', montant: 100, phone_ids: [], source: 'virement' } })
  const { rows: [w] } = await db.query(`select source, payment_method from supplier_payments where payment_id = $1`, [wire.data?.data?.payment_id])
  check('supplier paid by transfer: recorded as virement, caisse untouched', w?.source === 'virement' && w.payment_method === 'virement' && n((await caisse()).solde_theorique) === n(c4.solde_theorique), w)
  await db.query(`insert into caisse (date, ouverture, store_id, status) values ('2020-03-03', 0, $1, 'cloturee')`, [STORE])
  cleanups.push(() => db.query(`delete from caisse where date = '2020-03-03' and store_id = $1`, [STORE]))
  const closed = await manager('/api/supplier-payments', { method: 'POST', body: { supplier_id: sup.supplier_id, store_id: STORE, payment_type: 'avance_a', montant: 100, phone_ids: [], source: 'caisse', date_paiement: '2020-03-03' } })
  check('drawer payment dated on a closed caisse day refused (409)', closed.status === 409, closed)

  // ── Owner corrects where a payment came from ──────────────────────
  const owner = await makeUser('proprietaire')
  const fixSrc = await owner('/api/supplier-payments', { method: 'PATCH', body: { payment_id: drawer.data?.data?.payment_id, action: 'montant', montant: 250, motif: 'payé de ma poche', source: 'hors_caisse' } })
  const c4b = await caisse()
  check('"caisse" chosen by mistake → "hors caisse": the 250 are back in the expected cash', fixSrc.status === 200 && n(c4b.solde_theorique) - n(c4.solde_theorique) === 250 && n(c4.total_fournisseurs) - n(c4b.total_fournisseurs) === 250, { s: fixSrc.status, a: c4?.solde_theorique, b: c4b?.solde_theorique })
  const old = await manager('/api/supplier-payments', { method: 'POST', body: { supplier_id: sup.supplier_id, store_id: STORE, payment_type: 'avance_a', montant: 100, phone_ids: [], source: 'hors_caisse', date_paiement: '2020-03-03' } })
  const toClosed = await owner('/api/supplier-payments', { method: 'PATCH', body: { payment_id: old.data?.data?.payment_id, action: 'montant', montant: 100, motif: 'test caisse close', source: 'caisse' } })
  check('…but a payment cannot be moved onto a closed caisse (409)', old.status === 201 && toClosed.status === 409, { o: old.status, t: toClosed.status })

  // ── Stock bought with the drawer's cash ───────────────────────────
  const c5 = await caisse()
  const ph = await manager('/api/phones', { method: 'POST', body: { store_id: STORE, source: 'reprise', condition: 'occasion', marque: 'Apple', model: `E2E cash ${tag}`, status: 'disponible', prix_achat: 1200, paye_caisse: 1200 } })
  if (ph.data?.data?.phone_id) made.phones.push(ph.data.data.phone_id)
  const { rows: [e1] } = await db.query(`select categorie, montant, notes from expenses where notes like $1`, [`Achat ${ph.data?.data?.phone_id}%`])
  const c6 = await caisse()
  check('phone bought with the drawer: "marchandises" outflow linked to the phone, −1200', ph.status === 201 && e1?.categorie === 'marchandises' && n(e1.montant) === 1200 && n(c5.solde_theorique) - n(c6.solde_theorique) === 1200, { s: ph.status, e1 })
  const ph2 = await manager('/api/phones', { method: 'POST', body: { store_id: STORE, source: 'fournisseur', condition: 'occasion', marque: 'Apple', model: `E2E cash ${tag}`, status: 'disponible', prix_achat: 900 } })
  if (ph2.data?.data?.phone_id) made.phones.push(ph2.data.data.phone_id)
  check('phone added without "payé de la caisse": no outflow', n((await caisse()).solde_theorique) === n(c6.solde_theorique))
  const { rows: [cat] } = await db.query(`select code from categories where type = 'accessoire' and code <> 'service' limit 1`)
  const acc = await manager('/api/accessories', { method: 'POST', body: { store_id: STORE, nom: `E2E cash ${tag}`, categorie: cat.code, quantite: 5, prix_achat: 10, paye_caisse: 50 } })
  if (acc.data?.data?.acc_id) made.accs.push(acc.data.data.acc_id)
  const restock = await manager('/api/accessories', { method: 'PATCH', body: { acc_id: acc.data?.data?.acc_id, quantite: 15, paye_caisse: 100 } })
  const c7 = await caisse()
  check('accessory bought (50) then restocked (100) with the drawer: −150', acc.status === 201 && restock.status === 200 && n(c6.solde_theorique) - n(c7.solde_theorique) === 150, { a: c6?.solde_theorique, b: c7?.solde_theorique })
  const accStaff = await staff('/api/accessories', { method: 'POST', body: { store_id: STORE, nom: `E2E cash staff ${tag}`, categorie: cat.code, quantite: 1, paye_caisse: 999 } })
  if (accStaff.data?.data?.acc_id) made.accs.push(accStaff.data.data.acc_id)
  check('staff cannot take money out of the caisse through a stock form', accStaff.status === 201 && n((await caisse()).solde_theorique) === n(c7.solde_theorique), accStaff.status)
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
