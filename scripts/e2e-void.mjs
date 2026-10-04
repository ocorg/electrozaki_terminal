// End-to-end checks of how a phone leaves the stock against a running ERP dev
// server (default http://localhost:3100, override with E2E_BASE) whose env
// points at a TEST database branch (DIRECT_URL).
//
// Owner's rules (2026-10-04): "Vendu" / "Réservé" never typed by hand; a
// sold phone comes back only through a return or a void of the sale; a sale
// remembered later is recorded at its true date; "The Void" for a phone gone
// with no trace or taken apart (a loss, still owed to its supplier).
//
//   node scripts/e2e-void.mjs
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
  const email = `zz-e2e-void-${role}@migration.local`
  await db.query(`delete from user_profiles where email = $1`, [email]).catch(() => {})
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, $5, true, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E void ${role}`, role, STORE])
  userIds.push(u.id)
  return await login(email, password)
}

const phones = [], txns = []
try {
  const manager = await makeUser('gerant')
  const staff   = await makeUser('employe')
  const { rows: [sup] } = await db.query(`insert into suppliers (nom, type_fournisseur, store_id) values ($1, 'A', $2) returning supplier_id`, [`E2E Void ${tag}`, STORE])
  const newPhone = async (prix = 2000) => {
    const { rows: [p] } = await db.query(
      `insert into phones (store_id, source, condition, marque, serie, model, status, prix_achat, prix_vente_recommande, fournisseur_id, date_entree)
       values ($1, 'fournisseur', 'occasion', 'Apple', 'iPhone 13', $2, 'disponible', $3, $4, $5, '2026-01-01') returning phone_id`, [STORE, `E2E void ${tag}`, prix, prix + 400, sup.supplier_id])
    phones.push(p.phone_id); return p.phone_id
  }
  const status = async id => (await db.query(`select status, void_motif from phones where phone_id = $1`, [id])).rows[0]
  cleanups.push(async () => {
    await db.query(`delete from activity_log where user_id = any($1) or record_id = any($2)`, [userIds, [...phones, ...txns]])
    await db.query(`delete from transactions where device_id = any($1)`, [phones])
    await db.query(`delete from phones where phone_id = any($1)`, [phones])
    await db.query(`delete from suppliers where supplier_id = $1`, [sup.supplier_id])
    await db.query(`delete from user_profiles where id = any($1)`, [userIds])
  })
  const patch = (api, id, s) => api('/api/phones', { method: 'PATCH', body: { phone_id: id, status: s } })

  // ── Statuses typed by hand ────────────────────────────────────────
  const A = await newPhone()
  check('"Vendu" by hand refused, even for a manager', (await patch(manager, A, 'vendu')).status === 400 && (await status(A)).status === 'disponible')
  check('"Réservé" by hand refused', (await patch(manager, A, 'reserve')).status === 400)
  check('"The Void" by hand refused (it has its own action)', (await patch(manager, A, 'void')).status === 400)
  check('"En réparation" by hand still allowed', (await patch(manager, A, 'en_reparation')).status === 200 && (await status(A)).status === 'en_reparation')
  await patch(manager, A, 'disponible')
  const add = await manager('/api/phones', { method: 'POST', body: { store_id: STORE, source: 'fournisseur', condition: 'occasion', marque: 'Apple', model: `E2E void ${tag}`, status: 'vendu', prix_achat: 1 } })
  if (add.data?.data?.phone_id) phones.push(add.data.data.phone_id)
  check('a phone cannot be added already "vendu"', add.status === 400, add)

  // ── A sold phone comes back only through the sale ─────────────────
  const sale = await manager('/api/transactions', { method: 'POST', body: { store_id: STORE, device_type: 'telephone', device_id: A, type_operation: 'vente', prix_vente: 2400, payment_method: 'especes' } })
  if (sale.data?.data?.txn_id) txns.push(sale.data.data.txn_id)
  const back = await patch(manager, A, 'disponible')
  check('sold at the POS: cannot be set back to "disponible" by hand', sale.status === 201 && back.status === 400 && /Retour|annulez/.test(back.data?.error ?? '') && (await status(A)).status === 'vendu', back)
  const voidSold = await manager(`/api/phones/${A}/void`, { method: 'POST', body: { motif: 'test test' } })
  check('a phone with a sale cannot go to The Void', voidSold.status === 400, voidSold)
  const pastSold = await manager(`/api/phones/${A}/past-sale`, { method: 'POST', body: { date_vente: today, prix_vente: 2400, payment_method: 'especes' } })
  check('…nor get a second sale', pastSold.status === 400, pastSold)

  // ── The Void ──────────────────────────────────────────────────────
  const B = await newPhone(3000)
  check('staff cannot send a phone to The Void (403)', (await staff(`/api/phones/${B}/void`, { method: 'POST', body: { motif: 'test test' } })).status === 403)
  check('The Void needs a reason', (await manager(`/api/phones/${B}/void`, { method: 'POST', body: { motif: '' } })).status === 400)
  const v = await manager(`/api/phones/${B}/void`, { method: 'POST', body: { motif: 'Démonté pour pièces' } })
  const sB = await status(B)
  check('into The Void, with its reason', v.status === 200 && sB.status === 'void' && sB.void_motif === 'Démonté pour pièces', sB)
  const pos = await manager(`/api/phones?status=disponible&store_id=${STORE}&limit=5000`)
  check('…no longer offered at the POS', !(pos.data?.data ?? []).some(p => p.phone_id === B))
  const { rows: [owed] } = await db.query(`select cash_recu from phones_unsettled_a where phone_id = $1`, [B])
  const { rows: [sum] } = await db.query(`select solde_du::float du from suppliers_summary where supplier_id = $1`, [sup.supplier_id])
  check('…still owed to its supplier (3000 + the 2000 sold phone)', n(owed?.cash_recu) === 3000 && sum.du === 5000, { owed, sum })
  const fin = await manager(`/api/analytics?store_id=${STORE}&from=${today}&to=${today}`)
  const t = fin.data?.data?.totals
  check('…and its purchase price is a loss in the figures', fin.status === 200 && t && n(t.losses) >= 3000, t && { losses: t.losses })
  check('a phone in The Void cannot be edited back by hand', (await patch(manager, B, 'disponible')).status === 400)
  const out = await manager(`/api/phones/${B}/void`, { method: 'DELETE' })
  check('"Sortir du Void": back to disponible', out.status === 200 && (await status(B)).status === 'disponible', out)

  // ── A sale remembered later, at its true date ─────────────────────
  await manager(`/api/phones/${B}/void`, { method: 'POST', body: { motif: 'Vendu, sans trace' } })
  check('staff cannot record a past sale (403)', (await staff(`/api/phones/${B}/past-sale`, { method: 'POST', body: { date_vente: '2026-08-15', prix_vente: 3300, payment_method: 'especes' } })).status === 403)
  check('a date in the future is refused', (await manager(`/api/phones/${B}/past-sale`, { method: 'POST', body: { date_vente: '2099-01-01', prix_vente: 3300, payment_method: 'especes' } })).status === 400)
  const past = await manager(`/api/phones/${B}/past-sale`, { method: 'POST', body: { date_vente: '2026-08-15', prix_vente: 3300, payment_method: 'especes', notes: 'client du quartier' } })
  if (past.data?.data?.txn_id) txns.push(past.data.data.txn_id)
  const { rows: [tx] } = await db.query(`select date_vente::text d, prix_vente, warranty_start::text ws, notes from transactions where txn_id = $1`, [past.data?.data?.txn_id])
  check('past sale recorded on 2026-08-15, phone out of The Void → vendu', past.status === 201 && tx?.d === '2026-08-15' && n(tx.prix_vente) === 3300 && tx.ws === '2026-08-15' && (await status(B)).status === 'vendu' && (await status(B)).void_motif === null, { s: past.status, tx })
  const aug = await manager(`/api/analytics?store_id=${STORE}&from=2026-08-15&to=2026-08-15`)
  check('…and it counts in the figures of that day', (aug.data?.data?.sales ?? aug.data?.data?.lines ?? []).length >= 0 && n(aug.data?.data?.totals?.salesRevenue) >= 3300, aug.data?.data?.totals && { rev: aug.data.data.totals.salesRevenue })
  const hist = await manager(`/api/phones/${B}/history`)
  const titles = (hist.data?.data?.events ?? []).map(e => `${e.title} ${e.detail ?? ''}`).join(' | ')
  check('history tells the whole story (Void, reason, sale)', /The Void/.test(titles) && /Vendu/.test(titles), titles.slice(0, 200))
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
