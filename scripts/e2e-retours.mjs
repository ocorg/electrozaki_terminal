// End-to-end checks of returns v2 (search, partial returns, refunds dated the
// return day, store credit, caisse, guards) against a running ERP dev server
// (default http://localhost:3100, override with E2E_BASE) whose env points at
// a TEST database branch: DIRECT_URL (ERP).
//
//   node scripts/e2e-retours.mjs
//
// Refuses to run against production. Everything it creates is removed at the end.
import 'dotenv/config'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100'
const STORE = 'EZ-001'
const PRODUCTION_HOSTS = ['ep-royal-cloud-b130i960', 'ep-still-tree-b1u5yng9']
const url = process.env.DIRECT_URL
if (!url) { console.error('DIRECT_URL is not set'); process.exit(1) }
if (PRODUCTION_HOSTS.some(h => url.includes(h))) { console.error('DIRECT_URL points at PRODUCTION — use a Neon test branch'); process.exit(1) }

const erp = new pg.Client({ connectionString: url })
await erp.connect()

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 400) })
const cleanups = []
const TODAY = new Date().toISOString().slice(0, 10)
const TAG = crypto.randomBytes(3).toString('hex').toUpperCase()

async function login(email, password) {
  const jar = new Map()
  const absorb = (res) => { for (const c of res.headers.getSetCookie()) { const [p] = c.split(';'); const i = p.indexOf('='); jar.set(p.slice(0, i), p.slice(i + 1)) } }
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const csrf = await fetch(BASE + '/api/auth/csrf'); absorb(csrf)
  const { csrfToken } = await csrf.json()
  const res = await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1', cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password }),
  })
  absorb(res)
  return async (path, { method = 'GET', body } = {}) => {
    const r = await fetch(BASE + path, { method, redirect: 'manual', headers: { cookie: cookie(), ...(body && { 'content-type': 'application/json' }) }, body: body && JSON.stringify(body) })
    let data = null
    try { data = await r.json() } catch {}
    return { status: r.status, data }
  }
}

async function makeUser(role) {
  const password = crypto.randomBytes(12).toString('base64url')
  const email = `zz-e2e-ret-${role}@migration.local`
  const forget = async id => {
    for (const t of ['phones', 'accessories', 'transactions']) await erp.query(`update ${t} set updated_by = null where updated_by = $1`, [id])
    await erp.query(`update transactions set created_by = null where created_by = $1`, [id])
    await erp.query(`update clients set created_by = null, updated_by = null where created_by = $1 or updated_by = $1`, [id])
    await erp.query(`delete from activity_log where user_id = $1`, [id])
  }
  const { rows: old } = await erp.query(`select id from user_profiles where email = $1`, [email])
  for (const o of old) { await forget(o.id); await erp.query(`delete from user_profiles where id = $1`, [o.id]) }
  const { rows: [u] } = await erp.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, null, false, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E ret ${role}`, role])
  cleanups.push(async () => { await forget(u.id); await erp.query(`delete from user_profiles where id = $1`, [u.id]) })
  return { id: u.id, api: await login(email, password) }
}

const txns = []
const cash = async api => (await api(`/api/caisse?store_id=${STORE}&date=${TODAY}`)).data?.data?.payment_breakdown?.cash ?? null
const accQty = async id => (await erp.query(`select quantite from accessories where acc_id = $1`, [id])).rows[0]?.quantite
const avoirSolde = async id => Number((await erp.query(`select avoir_solde from retours where retour_id = $1`, [id])).rows[0]?.avoir_solde)

try {
  const manager  = await makeUser('gerant')
  const employee = await makeUser('employe')

  // Today's caisse must be open for cash refunds; restore whatever was there.
  const { rows: [caisseRow] } = await erp.query(`select caisse_id, status from caisse where store_id = $1 and date = $2`, [STORE, TODAY])
  if (!caisseRow) {
    const { rows: [c] } = await erp.query(`insert into caisse (date, store_id, ouverture, status) values ($1, $2, 0, 'ouverte') returning caisse_id`, [TODAY, STORE])
    cleanups.push(() => erp.query(`delete from caisse where caisse_id = $1`, [c.caisse_id]))
  } else if (caisseRow.status !== 'ouverte') {
    await erp.query(`update caisse set status = 'ouverte' where caisse_id = $1`, [caisseRow.caisse_id])
    cleanups.push(() => erp.query(`update caisse set status = $2 where caisse_id = $1`, [caisseRow.caisse_id, caisseRow.status]))
  }

  // Test client, accessory (5 in stock) and phone
  const PHONE = '0611' + String(Math.floor(100000 + Math.random() * 899999))
  const { rows: [client] } = await erp.query(`insert into clients (nom, telephone, store_id) values ($1, $2, $3) returning client_id`, [`E2E Retour ${TAG}`, PHONE, STORE])
  const { rows: [acc] } = await erp.query(
    `insert into accessories (nom, categorie, quantite, prix_achat, prix_vente_recommande, store_id)
     values ($1, (select code from categories where type = 'accessoire' and code <> 'service' limit 1), 5, 50, 100, $2) returning acc_id`, [`Coque E2E ${TAG}`, STORE])
  const IMEI = '35' + String(Math.floor(1e12 + Math.random() * 9e12))
  const { rows: [phone] } = await erp.query(
    `insert into phones (source, condition, marque, model, stockage, imei, prix_achat, prix_vente_recommande, status, store_id, is_damaged)
     values ('fournisseur', 'occasion', 'Apple', $1, '128GB', $2, 2500, 3000, 'disponible', $3, false) returning phone_id`, [`E2E ${TAG}`, IMEI, STORE])
  cleanups.push(async () => {
    await erp.query(`update transactions set avoir_retour_id = null where txn_id = any($1)`, [txns])
    await erp.query(`delete from retours where txn_id = any($1) and type = 'solde_avoir'`, [txns])
    await erp.query(`delete from retours where txn_id = any($1)`, [txns])
    await erp.query(`delete from activity_log where record_id = any($1) or record_id like 'RET-%' and notes like $2`, [txns, `%${TAG}%`])
    await erp.query(`delete from transactions where txn_id = any($1)`, [txns])
    await erp.query(`delete from phones where phone_id = $1`, [phone.phone_id])
    await erp.query(`delete from accessories where acc_id = $1`, [acc.acc_id])
    await erp.query(`delete from clients where client_id = $1`, [client.client_id])
  })
  const sell = async (body, who = manager) => {
    const r = await who.api('/api/transactions', { method: 'POST', body: { store_id: STORE, client_id: client.client_id, type_operation: 'vente', payment_method: 'especes', warranty_start: TODAY, ...body } })
    if (r.data?.data?.txn_id) txns.push(r.data.data.txn_id)
    return r
  }
  const giveBack = (body, who = manager) => who.api('/api/retours', { method: 'POST', body: { motif: `Test E2E ${TAG}`, ...body } })

  // ── 1. Sale + search ──────────────────────────────────────────────────
  const cash0 = await cash(manager.api)
  const s1 = await sell({ device_type: 'accessoire', device_id: acc.acc_id, qty: 3, prix_vente: 300 })
  const saleId = s1.data?.data?.txn_id
  check('sale: 3 accessories sold', s1.status === 201 && (await accQty(acc.acc_id)) === 2, s1)
  const cash1 = await cash(manager.api)
  check('caisse: +300 cash for the sale', cash0 !== null && cash1 - cash0 === 300, { cash0, cash1 })

  const byName = await employee.api(`/api/retours?store_id=${STORE}&q=${encodeURIComponent(`coque e2e ${TAG}`)}`)
  const hit = byName.data?.data?.find(x => x.txn_id === saleId)
  check('search: by product words (any case)', !!hit && hit.qty === 3 && hit.returned_qty === 0 && !!hit.warranty_expiry, byName.data?.data?.slice?.(0, 2))
  const byPhone = await employee.api(`/api/retours?store_id=${STORE}&q=${PHONE.slice(-6)}`)
  check('search: by client phone digits', byPhone.data?.data?.some(x => x.txn_id === saleId), byPhone.data?.data?.length)
  const byTxn = await employee.api(`/api/retours?store_id=${STORE}&q=${saleId?.toLowerCase()}`)
  check('search: by sale number', byTxn.data?.data?.[0]?.txn_id === saleId, byTxn.data?.data?.[0])
  const outOfRange = await employee.api(`/api/retours?store_id=${STORE}&q=${saleId}&from=2020-01-01&to=2020-01-31`)
  check('search: date range filters out', outOfRange.data?.data?.length === 0, outOfRange.data)

  // ── 2. Guards ─────────────────────────────────────────────────────────
  const emp = await giveBack({ txn_id: saleId, qty: 1, montant: 100, mode: 'especes', destination: 'stock' }, employee)
  check('return: employee refused (403)', emp.status === 403, emp)
  const tooMany = await giveBack({ txn_id: saleId, qty: 4, montant: 100, mode: 'especes', destination: 'stock' })
  check('return: more units than sold refused (400)', tooMany.status === 400, tooMany)
  const tooMuch = await giveBack({ txn_id: saleId, qty: 1, montant: 301, mode: 'especes', destination: 'stock' })
  check('return: more money than paid refused (400)', tooMuch.status === 400, tooMuch)
  const noMotif = await giveBack({ txn_id: saleId, qty: 1, montant: 100, mode: 'especes', destination: 'stock', motif: '' })
  check('return: reason required (400)', noMotif.status === 400, noMotif)
  const accRepair = await giveBack({ txn_id: saleId, qty: 1, montant: 100, mode: 'especes', destination: 'reparation' })
  check('return: accessory can’t go to repair (400)', accRepair.status === 400, accRepair)

  // ── 3. Partial cash return ────────────────────────────────────────────
  const r1 = await giveBack({ txn_id: saleId, qty: 1, montant: 100, mode: 'especes', destination: 'stock' })
  const { rows: [saleAfter] } = await erp.query(`select voided, prix_vente, date_vente from transactions where txn_id = $1`, [saleId])
  check('return: 1 of 3 back in cash, item back in stock', r1.status === 201 && r1.data?.data?.retour_id?.startsWith('RET-') && (await accQty(acc.acc_id)) === 3, r1)
  check('return: the original sale is untouched', saleAfter.voided === false && Number(saleAfter.prix_vente) === 300, saleAfter)
  const cash2 = await cash(manager.api)
  check('caisse: cash refund comes off today’s drawer (−100)', cash2 - cash1 === -100, { cash1, cash2 })
  const { data: live } = await manager.api(`/api/caisse?store_id=${STORE}&date=${TODAY}`)
  check('caisse: refunds shown (retours_cash, nb_retours)', live?.data?.payment_breakdown?.retours_cash >= 100 && live?.data?.nb_retours >= 1, live?.data?.payment_breakdown)
  const again = await employee.api(`/api/retours?store_id=${STORE}&q=${saleId}`)
  check('search: shows what was already returned', again.data?.data?.[0]?.returned_qty === 1 && again.data?.data?.[0]?.refunded === 100, again.data?.data?.[0])

  // ── 4. Store credit (avoir) ───────────────────────────────────────────
  const r2 = await giveBack({ txn_id: saleId, qty: 1, montant: 100, mode: 'avoir', destination: 'defectueux' })
  const avoirId = r2.data?.data?.retour_id
  check('avoir: created, damaged accessory not restocked', r2.status === 201 && Number(r2.data?.data?.avoir_solde) === 100 && (await accQty(acc.acc_id)) === 3, r2)
  check('avoir: no cash leaves the drawer', (await cash(manager.api)) === cash2)
  const listed = await employee.api(`/api/retours/avoirs?store_id=${STORE}&q=${avoirId}`)
  check('avoir: listed for the POS with its balance', listed.data?.data?.[0]?.avoir_solde === 100, listed.data)

  const cash3 = await cash(manager.api)
  const s2 = await sell({ device_type: 'telephone', device_id: phone.phone_id, qty: 1, prix_vente: 3000, avoir_montant: 100, avoir_retour_id: avoirId }, employee)
  const phoneSale = s2.data?.data?.txn_id
  check('avoir: spent on a phone sale (employee)', s2.status === 201 && (await avoirSolde(avoirId)) === 0, s2)
  check('caisse: only the money actually paid counts (+2900)', (await cash(manager.api)) - cash3 === 2900)
  const reuse = await sell({ device_type: 'accessoire', device_id: acc.acc_id, qty: 1, prix_vente: 100, avoir_montant: 100, avoir_retour_id: avoirId })
  check('avoir: can’t be spent twice (409)', reuse.status === 409, reuse)
  const onCredit = await sell({ device_type: 'accessoire', device_id: acc.acc_id, qty: 1, prix_vente: 100, payment_method: 'credit', avoir_montant: 50, avoir_retour_id: avoirId })
  check('avoir: refused on a credit sale (400)', onCredit.status === 400, onCredit)

  // Cancelling a same-day sale paid with an avoir gives the credit back
  const cancel = await manager.api('/api/transactions/void', { method: 'PATCH', body: { txn_id: phoneSale, voided_reason: `Erreur de saisie E2E ${TAG}` } })
  const { rows: [ph1] } = await erp.query(`select status from phones where phone_id = $1`, [phone.phone_id])
  check('cancel: same-day sale cancelled, avoir given back, phone available', cancel.status === 200 && (await avoirSolde(avoirId)) === 100 && ph1.status === 'disponible', { cancel, ph1 })
  const cancelWithReturn = await manager.api('/api/transactions/void', { method: 'PATCH', body: { txn_id: saleId, voided_reason: `Erreur de saisie E2E ${TAG}` } })
  check('cancel: refused on a sale that has a return (409)', cancelWithReturn.status === 409, cancelWithReturn)

  // Paying back the rest of an avoir
  const empPay = await employee.api('/api/retours/avoirs', { method: 'POST', body: { avoir_id: avoirId, montant: 60, mode: 'especes' } })
  check('avoir payout: employee refused (403)', empPay.status === 403, empPay)
  const cash4 = await cash(manager.api)
  const pay = await manager.api('/api/retours/avoirs', { method: 'POST', body: { avoir_id: avoirId, montant: 60, mode: 'especes' } })
  check('avoir payout: 60 paid back, 40 left, drawer −60', pay.status === 201 && (await avoirSolde(avoirId)) === 40 && (await cash(manager.api)) - cash4 === -60, pay)
  const overPay = await manager.api('/api/retours/avoirs', { method: 'POST', body: { avoir_id: avoirId, montant: 41, mode: 'especes' } })
  check('avoir payout: more than the balance refused (409)', overPay.status === 409, overPay)

  // ── 5. Last unit, fully returned ──────────────────────────────────────
  const r3 = await giveBack({ txn_id: saleId, qty: 1, montant: 100, mode: 'virement', destination: 'stock' })
  const cash5 = await cash(manager.api)
  check('return: by transfer — item restocked, drawer unchanged', r3.status === 201 && (await accQty(acc.acc_id)) === 4 && cash5 === (await cash(manager.api)), r3)
  const r4 = await giveBack({ txn_id: saleId, qty: 1, montant: 0, mode: 'especes', destination: 'stock' })
  check('return: a fully returned sale refused (409)', r4.status === 409, r4)

  // ── 6. Phone: repair destination, resold guard, closed drawer ─────────
  const s3 = await sell({ device_type: 'telephone', device_id: phone.phone_id, qty: 1, prix_vente: 3000 })
  const s3Id = s3.data?.data?.txn_id
  const { rows: [newer] } = await erp.query(
    `insert into transactions (device_type, device_id, client_id, type_operation, prix_vente, payment_method, store_id, date_vente, created_at)
     values ('telephone', $1, $2, 'vente', 3000, 'especes', $3, $4, now() + interval '1 minute') returning txn_id`, [phone.phone_id, client.client_id, STORE, TODAY])
  txns.push(newer.txn_id)
  const resold = await giveBack({ txn_id: s3Id, qty: 1, montant: 3000, mode: 'especes', destination: 'stock' })
  check('return: a phone resold since can’t come back on the older sale (409)', resold.status === 409, resold)
  await erp.query(`update transactions set voided = true where txn_id = $1`, [newer.txn_id])

  const { rows: [cz] } = await erp.query(`select caisse_id from caisse where store_id = $1 and date = $2`, [STORE, TODAY])
  await erp.query(`update caisse set status = 'en_attente_cloture' where caisse_id = $1`, [cz.caisse_id])
  const closedCash = await giveBack({ txn_id: s3Id, qty: 1, montant: 3000, mode: 'especes', destination: 'reparation' })
  check('return: cash refund refused once today’s caisse is closed (409)', closedCash.status === 409, closedCash)
  const closedTransfer = await giveBack({ txn_id: s3Id, qty: 1, montant: 3000, mode: 'virement', destination: 'reparation' })
  const { rows: [ph2] } = await erp.query(`select status from phones where phone_id = $1`, [phone.phone_id])
  check('return: transfer refund still possible, phone sent to repair', closedTransfer.status === 201 && ph2.status === 'en_reparation', { closedTransfer, ph2 })
  await erp.query(`update caisse set status = 'ouverte' where caisse_id = $1`, [cz.caisse_id])

  // ── 7. Credit sale, dashboard ─────────────────────────────────────────
  const credit = await sell({ device_type: 'accessoire', device_id: acc.acc_id, qty: 1, prix_vente: 100, payment_method: 'credit', avance: 0 })
  const creditRet = await giveBack({ txn_id: credit.data?.data?.txn_id, qty: 1, montant: 100, mode: 'especes', destination: 'stock' })
  check('return: unpaid credit sale refused here (409)', creditRet.status === 409, creditRet)

  const dash = await manager.api(`/api/dashboard?store_id=${STORE}&start=${TODAY}&end=${TODAY}`)
  const mine = (dash.data?.returns ?? []).filter(r => r.device_id === acc.acc_id || r.device_id === phone.phone_id)
  check('dashboard: returns of the period listed (to subtract)', mine.length === 4 && mine.every(r => typeof r.montant === 'number'), dash.data?.returns?.slice?.(0, 3))
} catch (err) {
  check('script ran to the end', false, String(err?.stack ?? err))
} finally {
  for (const fn of cleanups.reverse()) { try { await fn() } catch (e) { console.error('cleanup:', e.message) } }
  await erp.end()
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  → ${r.detail}`}`)
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
