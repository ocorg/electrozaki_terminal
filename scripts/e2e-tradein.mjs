// End-to-end checks of the trade-in chain against a running ERP dev server
// (default http://localhost:3100, override with E2E_BASE) whose env points at
// a TEST database branch (DIRECT_URL).
//
// Owner's rule (2026-10-02): a phone taken in exchange joins the supplier of
// the phone sold; the supplier is owed (owed − trade-in) now and the rest when
// the trade-in sells — down the chain until a cash-only sale.
//
//   node scripts/e2e-tradein.mjs
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
async function makeUser(role) {
  const password = crypto.randomBytes(12).toString('base64url')
  const email = `zz-e2e-tradein-${role}@migration.local`
  const { rows: old } = await db.query(`select id from user_profiles where email = $1`, [email])
  for (const o of old) { await db.query(`delete from activity_log where user_id = $1`, [o.id]); await db.query(`delete from user_profiles where id = $1`, [o.id]) }
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, $5, true, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E tradein ${role}`, role, STORE])
  cleanups.push(async () => { await db.query(`delete from activity_log where user_id = $1`, [u.id]); await db.query(`delete from user_profiles where id = $1`, [u.id]) })
  return await login(email, password)
}

const phones = []
const txns = []
async function newPhone(prix, supplier) {
  const { rows: [p] } = await db.query(
    `insert into phones (store_id, source, condition, marque, serie, model, status, prix_achat, prix_vente_recommande, fournisseur_id)
     values ($1, 'fournisseur', 'occasion', 'Apple', 'iPhone 13', $2, 'disponible', $3, $4, $5) returning phone_id`, [STORE, `E2E chain ${tag}`, prix, prix + 500, supplier])
  phones.push(p.phone_id)
  return p.phone_id
}
const phone = async id => (await db.query(`select phone_id, fournisseur_id, du_fournisseur, origine_phone_id, status from phones where phone_id = $1`, [id])).rows[0]
const owedNow = async id => n((await db.query(`select cash_recu from phones_unsettled_a where phone_id = $1`, [id])).rows[0]?.cash_recu)

// POS: sale with a trade-in, then the trade-in recorded (as the POS does)
async function sellWithTradeIn(api, soldId, price, tradeValue) {
  const sale = await api('/api/transactions', { method: 'POST', body: {
    store_id: STORE, device_type: 'telephone', device_id: soldId, type_operation: tradeValue ? 'echange' : 'vente',
    prix_vente: price, payment_method: 'especes', valeur_echange: tradeValue || 0,
  } })
  const txnId = sale.data?.data?.txn_id
  if (txnId) txns.push(txnId)
  if (!tradeValue) return { txnId }
  const intake = await api('/api/phones', { method: 'POST', body: {
    store_id: STORE, marque: 'Samsung', model: `E2E repris ${tag}`, imei: `35${Date.now()}`.slice(0, 15), prix_achat: tradeValue,
    condition: 'occasion', source: 'echange', status: 'disponible', txn_ref_id: txnId, tradein_for: [soldId],
  } })
  const tradeInId = intake.data?.data?.phone_id
  if (tradeInId) phones.push(tradeInId)
  return { txnId, tradeInId, intake }
}

try {
  const manager = await makeUser('gerant')
  const staff   = await makeUser('employe')
  const { rows: [sup] } = await db.query(`insert into suppliers (nom, type_fournisseur, store_id) values ($1, 'A', $2) returning supplier_id`, [`E2E Fournisseur ${tag}`, STORE])
  cleanups.push(async () => {
    const credits = (await db.query(`select credit_id from phone_credit_sales where phone_id = any($1)`, [phones])).rows.map(r => r.credit_id)
    await db.query(`delete from activity_log where record_id = any($1)`, [[...phones, ...txns, ...credits]])
    await db.query(`delete from phone_credit_payments where credit_id = any($1)`, [credits])
    await db.query(`delete from phone_credit_sales where credit_id = any($1)`, [credits])
    // trade-ins point at their sale (txn_ref_id) and at each other (origine)
    await db.query(`update phones set origine_phone_id = null, txn_ref_id = null where phone_id = any($1)`, [phones])
    await db.query(`delete from transactions where txn_id = any($1)`, [txns])
    await db.query(`delete from phones where phone_id = any($1)`, [phones])
    await db.query(`delete from suppliers where supplier_id = $1`, [sup.supplier_id])
  })

  // ── The owner's example: A 3100 → B 600 → C 400 → cash ────────────
  const A = await newPhone(3100, sup.supplier_id)
  const s1 = await sellWithTradeIn(manager, A, 3400, 600)
  const B = s1.tradeInId
  const a1 = await phone(A), b1 = await phone(B)
  check('A sold with trade-in B (600): owed now 2500', await owedNow(A) === 2500, { du: a1.du_fournisseur })
  check('B joins the same supplier, owed 600, linked to A', b1.fournisseur_id === sup.supplier_id && n(b1.du_fournisseur) === 600 && b1.origine_phone_id === A, b1)

  const s2 = await sellWithTradeIn(manager, B, 1000, 400)
  const C = s2.tradeInId
  const c1 = await phone(C)
  check('B sold with trade-in C (400): owed now 200', await owedNow(B) === 200)
  check('C joins the supplier, owed 400, linked to B', c1.fournisseur_id === sup.supplier_id && n(c1.du_fournisseur) === 400 && c1.origine_phone_id === B, c1)

  await sellWithTradeIn(manager, C, 700, 0)
  check('C sold for cash: owed 400 — chain closed', await owedNow(C) === 400)
  const total = (await owedNow(A)) + (await owedNow(B)) + (await owedNow(C))
  check('supplier owed 3100 in total = purchase price of A', total === 3100, total)
  const { rows: [sum] } = await db.query(`select solde_du::float du, total_achats::float achats, nb_a_regler from suppliers_summary where supplier_id = $1`, [sup.supplier_id])
  check('supplier summary: owes 3100, purchases 3100 (trade-ins not counted as purchases)', sum.du === 3100 && sum.achats === 3100, sum)

  const histA = await manager(`/api/phones/${A}/history`)
  const histB = await manager(`/api/phones/${B}/history`)
  const titles = [...(histA.data?.data?.events ?? []), ...(histB.data?.data?.events ?? [])].map(e => e.title).join(' | ')
  check('history shows the sale and the trade-in chain', histA.status === 200 && /Vendu avec échange/.test(titles) && /A reçu en reprise/.test(titles) && /Repris en échange de/.test(titles), titles.slice(0, 250))

  const stmt = await manager(`/api/suppliers/${sup.supplier_id}/statement`)
  const sd = stmt.data?.data
  const chainTotal = n => n.owed_on_sale + n.children.reduce((t, c) => t + chainTotal(c), 0)
  check('statement: ledger of 3 sales adds up to 3100, closing = à payer', stmt.status === 200 && sd.ledger.filter(l => l.kind === 'vente').length === 3 && sd.closing === 3100 && sd.summary.a_payer === 3100, sd && { closing: sd.closing, a_payer: sd.summary.a_payer, n: sd.ledger.length })
  check('statement: one chain A → B → C totalling 3100, phones described with IMEI', sd?.chains?.length === 1 && chainTotal(sd.chains[0]) === 3100 && sd.chains[0].children[0]?.children[0]?.phone?.phone_id === C && !!sd.ledger.find(l => l.phone?.imei), sd?.chains?.[0] && { total: chainTotal(sd.chains[0]) })
  check('statement: the sale of A explains the trade-in carried over to B', /reprise 600 DH reportée sur/.test(sd?.ledger?.find(l => l.label.startsWith(`Vente ${A}`))?.detail ?? ''), sd?.ledger?.[0]?.detail)
  const stmtStaff = await staff(`/api/suppliers/${sup.supplier_id}/statement`)
  check('statement refused to staff', stmtStaff.status === 403, stmtStaff.status)

  // ── Trade-in worth more than what is owed ─────────────────────────
  const D = await newPhone(5500, sup.supplier_id)
  const s3 = await sellWithTradeIn(manager, D, 6500, 6000)
  const e = await phone(s3.tradeInId)
  check('trade-in 6000 > owed 5500: owed now 0', await owedNow(D) === 0)
  check('…and the trade-in carries only 5500', n(e.du_fournisseur) === 5500 && e.fournisseur_id === sup.supplier_id, e)

  // ── Already settled sold phone: nothing moves ─────────────────────
  const F = await newPhone(2000, sup.supplier_id)
  const sF = await manager('/api/transactions', { method: 'POST', body: { store_id: STORE, device_type: 'telephone', device_id: F, type_operation: 'echange', prix_vente: 2500, payment_method: 'especes', valeur_echange: 300 } })
  if (sF.data?.data?.txn_id) txns.push(sF.data.data.txn_id)
  await db.query(`update phones set settled_at = now() where phone_id = $1`, [F])
  const iF = await manager('/api/phones', { method: 'POST', body: { store_id: STORE, marque: 'Samsung', model: `E2E repris ${tag}`, imei: `36${Date.now()}`.slice(0, 15), prix_achat: 300, condition: 'occasion', source: 'echange', status: 'disponible', txn_ref_id: sF.data?.data?.txn_id } })
  if (iF.data?.data?.phone_id) phones.push(iF.data.data.phone_id)
  const g = await phone(iF.data?.data?.phone_id)
  check('sold phone already paid to its supplier: trade-in stays ours', g && g.fournisseur_id === null && g.du_fournisseur === null, g)

  // ── Staff record the trade-in: chain applies, amounts hidden ──────
  const H = await newPhone(1500, sup.supplier_id)
  const sH = await sellWithTradeIn(staff, H, 1800, 500)
  check('staff POS sale + trade-in: chain applies (owed now 1000)', sH.tradeInId && await owedNow(H) === 1000, sH.intake)
  check('staff never get the supplier amount back', sH.intake?.data?.data && !('du_fournisseur' in sH.intake.data.data) && !('prix_achat' in sH.intake.data.data), sH.intake?.data?.data && Object.keys(sH.intake.data.data))
  const list = await staff(`/api/phones?store_id=${STORE}&limit=5000`)
  const seen = (list.data?.data ?? []).find(p => p.phone_id === sH.tradeInId)
  check('staff phone list hides du_fournisseur', seen && !('du_fournisseur' in seen), seen && Object.keys(seen))
  const typed = await manager('/api/phones', { method: 'POST', body: { store_id: STORE, marque: 'X', model: `E2E repris ${tag}`, source: 'echange', status: 'disponible', prix_achat: 100, fournisseur_id: 'SUP-0001', txn_ref_id: sH.txnId } })
  if (typed.data?.data?.phone_id) phones.push(typed.data.data.phone_id)
  check('a trade-in recorded twice for the same sale moves nothing more, supplier never typed by hand',
    typed.data?.data?.fournisseur_id == null && await owedNow(H) === 1000, { t: typed.data?.data?.fournisseur_id, owed: await owedNow(H) })

  // ── Credit sale with a trade-in, discharged ───────────────────────
  const K = await newPhone(4000, sup.supplier_id)
  const cr = await manager('/api/phone-credits', { method: 'POST', body: { phone_id: K, client_name: 'E2E chaine', montant_total: 4500, avance_initiale: 3500, payment_method: 'especes', has_reprise: true, reprise_marque: 'Samsung', reprise_model: `E2E reprise ${tag}`, reprise_valeur: 1000 } })
  const dis = await manager(`/api/phone-credits/${cr.data?.data?.credit?.credit_id}/discharge`, { method: 'POST', body: {} })
  const rid = dis.data?.data?.reprise_phone_id
  if (rid) phones.push(rid)
  const r = rid ? await phone(rid) : null
  check('credit with trade-in, discharged: owed now 3000, trade-in carries 1000 for the supplier',
    dis.status === 200 && await owedNow(K) === 3000 && r?.fournisseur_id === sup.supplier_id && n(r?.du_fournisseur) === 1000, { dis: dis.status, r })
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
