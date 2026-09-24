// End-to-end checks of repairs v2 (kinds, quote, cancel, cash-only caisse,
// website tracking, website requests) against a running ERP dev server
// (default http://localhost:3100, override with E2E_BASE) whose env points at
// TEST database branches: DIRECT_URL (ERP) and STOREFRONT_DIRECT_URL (website).
//
//   node scripts/e2e-repairs.mjs
//
// Refuses to run against production. Everything it creates is removed at the end.
import 'dotenv/config'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100'
const STORE = 'EZ-001'
const PRODUCTION_HOSTS = ['ep-royal-cloud-b130i960', 'ep-still-tree-b1u5yng9']
for (const [name, url] of [['DIRECT_URL', process.env.DIRECT_URL], ['STOREFRONT_DIRECT_URL', process.env.STOREFRONT_DIRECT_URL]]) {
  if (!url) { console.error(`${name} is not set`); process.exit(1) }
  if (PRODUCTION_HOSTS.some(h => url.includes(h))) { console.error(`${name} points at PRODUCTION — use a Neon test branch`); process.exit(1) }
}
const SECRET = process.env.STOREFRONT_REVALIDATE_SECRET
if (!SECRET) { console.error('STOREFRONT_REVALIDATE_SECRET is not set'); process.exit(1) }

const erp = new pg.Client({ connectionString: process.env.DIRECT_URL })
const web = new pg.Client({ connectionString: process.env.STOREFRONT_DIRECT_URL })
await erp.connect(); await web.connect()

const phoneHash = phone => crypto.createHmac('sha256', SECRET).update(`track:${phone.replace(/\D/g, '').slice(-9)}`).digest('base64url')
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms
  for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(500) }
}

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 300) })
const cleanups = []

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

const createdReps = []
async function makeUser(role) {
  const password = crypto.randomBytes(12).toString('base64url')
  const email = `zz-e2e-rep-${role}@migration.local`
  const forget = async id => {
    await erp.query(`update phones set updated_by = null where updated_by = $1`, [id])
    await erp.query(`update clients set created_by = null, updated_by = null where created_by = $1 or updated_by = $1`, [id])
    await erp.query(`delete from activity_log where user_id = $1`, [id])
  }
  const { rows: old } = await erp.query(`select id from user_profiles where email = $1`, [email])
  for (const o of old) { await forget(o.id); await erp.query(`delete from user_profiles where id = $1`, [o.id]) }
  const { rows: [u] } = await erp.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, null, false, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E rep ${role}`, role])
  cleanups.push(async () => { await forget(u.id); await erp.query(`delete from user_profiles where id = $1`, [u.id]) })
  return { id: u.id, api: await login(email, password) }
}

// Test-only client and dates far from real business days.
const PHONE = '0600' + String(Math.floor(100000 + Math.random() * 899999))
const OPEN_DAY = '2031-03-11', CLOSED_DAY = '2031-03-12'

try {
  const manager  = await makeUser('gerant')
  const employee = await makeUser('employe')

  const { rows: [client] } = await erp.query(
    `insert into clients (nom, telephone, store_id) values ('E2E Client Réparation', $1, $2) returning client_id`, [PHONE, STORE])
  cleanups.push(() => erp.query(`delete from clients where client_id = $1`, [client.client_id]))
  cleanups.push(async () => {
    if (!createdReps.length) return
    await erp.query(`delete from activity_log where record_id = any($1)`, [createdReps])
    await erp.query(`delete from reparations where rep_id = any($1)`, [createdReps])
    await web.query(`delete from "RepairTracking" where ref = any($1)`, [createdReps])
    // a client the website-request conversion may have created
    await erp.query(`delete from clients where nom = 'E2E Client Réparation' and client_id <> $1 and not exists (select 1 from reparations r where r.client_id = clients.client_id)`, [client.client_id])
  })
  const newTicket = async (body, who = manager) => {
    const r = await who.api('/api/repairs', { method: 'POST', body: { store_id: STORE, client_id: client.client_id, statut: 'en_attente', ...body } })
    if (r.data?.data?.rep_id) createdReps.push(r.data.data.rep_id)
    return r
  }

  // ── 1. Kinds, problems, payment, photos ────────────────────────────────
  const badKind = await newTicket({ model: 'X', probleme: 'x', type_reparation: 'magie' })
  check('ticket: unknown kind refused (400)', badKind.status === 400, badKind)
  const badProblem = await newTicket({ model: 'X', probleme: 'x', type_reparation: 'logiciel', problemes: ['ecran'] })
  check('ticket: hardware problem on a software ticket refused (400)', badProblem.status === 400, badProblem)
  const badPay = await newTicket({ model: 'X', probleme: 'x', mode_paiement: 'credit' })
  check('ticket: payment other than espèces/virement refused (400)', badPay.status === 400, badPay)
  const badPhoto = await newTicket({ model: 'X', probleme: 'x', photos_depot: ['https://evil.example/x.jpg'] })
  check('ticket: foreign photo URL refused (400)', badPhoto.status === 400, badPhoto)

  const soft = await newTicket({ model: 'iPhone 12', marque: 'Apple', probleme: 'Données — test', type_reparation: 'logiciel', problemes: ['donnees'], mode_paiement: 'virement' }, employee)
  const softRow = soft.data?.data
  check('ticket: software ticket created by an employee', soft.status === 201 && softRow?.type_reparation === 'logiciel' && softRow?.problemes?.[0] === 'donnees' && softRow?.mode_paiement === 'virement', soft)
  const consult = await newTicket({ model: 'Consultation', probleme: 'Conseil achat', type_reparation: 'consultation', problemes: ['consultation'] })
  check('ticket: consultation created', consult.status === 201 && consult.data?.data?.type_reparation === 'consultation', consult)

  // ── 2. Quote step ─────────────────────────────────────────────────────
  const hw = await newTicket({ model: 'Galaxy A54', marque: 'Samsung', probleme: 'Écran', type_reparation: 'materiel', problemes: ['ecran'] })
  const hwId = hw.data?.data?.rep_id
  const noPrice = await manager.api('/api/repairs', { method: 'PATCH', body: { rep_id: hwId, statut: 'devis_envoye' } })
  check('quote: cannot send without a price (400)', noPrice.status === 400, noPrice)
  const sent = await manager.api('/api/repairs', { method: 'PATCH', body: { rep_id: hwId, statut: 'devis_envoye', cout_reparation: 450 } })
  check('quote: sent with a price, date stamped', sent.status === 200 && sent.data?.data?.statut === 'devis_envoye' && !!sent.data?.data?.devis_envoye_le, sent)
  const skip = await manager.api('/api/repairs', { method: 'PATCH', body: { rep_id: hwId, statut: 'en_cours' } })
  check('quote: can’t jump past a pending quote (409)', skip.status === 409, skip)

  // ── 3. Website tracking + online answer ───────────────────────────────
  const tracked = await waitFor(async () => (await web.query(`select * from "RepairTracking" where ref = $1`, [hwId])).rows[0]?.status === 'devis_envoye'
    ? (await web.query(`select * from "RepairTracking" where ref = $1`, [hwId])).rows[0] : null)
  check('tracking: ticket pushed to the website with its quote', tracked && Number(tracked.quoteAmount) === 450 && tracked.kind === 'HARDWARE', tracked)
  check('tracking: phone stored only as the shared HMAC', tracked?.phoneHash === phoneHash(PHONE) && !JSON.stringify(tracked).includes(PHONE.slice(-6)), tracked?.phoneHash?.slice(0, 6))
  const { rows: leak } = await web.query(`select 1 from "RepairTracking" where ref = $1 and (device ilike '%E2E Client%')`, [hwId])
  check('tracking: no customer name on the website', leak.length === 0)

  await web.query(`update "RepairTracking" set "quoteDecision" = 'ACCEPTED', "quoteDecidedAt" = now(), "decisionApplied" = false where ref = $1`, [hwId])
  await employee.api('/api/site/counts')
  const { rows: [afterOnline] } = await erp.query(`select statut, devis_accepte_le from reparations where rep_id = $1`, [hwId])
  const { rows: [applied] } = await web.query(`select "decisionApplied" from "RepairTracking" where ref = $1`, [hwId])
  check('online answer: accepted quote moves the ticket to en cours', afterOnline.statut === 'en_cours' && afterOnline.devis_accepte_le && applied.decisionApplied === true, { afterOnline, applied })

  // Staff record a refusal
  const hw2 = await newTicket({ model: 'Redmi Note 12', marque: 'Xiaomi', probleme: 'Batterie', problemes: ['batterie'] })
  const hw2Id = hw2.data?.data?.rep_id
  await manager.api('/api/repairs', { method: 'PATCH', body: { rep_id: hw2Id, statut: 'devis_envoye', cout_reparation: 300 } })
  const refused = await employee.api('/api/repairs/quote', { method: 'POST', body: { rep_id: hw2Id, decision: 'refuse' } })
  check('quote: refusal recorded by staff → prêt (to hand back)', refused.status === 200 && refused.data?.data?.statut === 'pret' && !!refused.data?.data?.devis_refuse_le, refused)

  // ── 4. Cash-only caisse ────────────────────────────────────────────────
  await erp.query(`delete from caisse where date in ($1, $2)`, [OPEN_DAY, CLOSED_DAY])
  await erp.query(`insert into caisse (date, ouverture, store_id, status) values ($1, 0, $2, 'ouverte'), ($3, 0, $2, 'cloturee')`, [OPEN_DAY, STORE, CLOSED_DAY])
  cleanups.push(() => erp.query(`delete from caisse where date in ($1, $2)`, [OPEN_DAY, CLOSED_DAY]))
  const cash = await newTicket({ model: 'Cash', probleme: 'x', avance_rep: 100, mode_paiement: 'especes', date_depot: OPEN_DAY })
  await newTicket({ model: 'Transfer', probleme: 'x', avance_rep: 200, mode_paiement: 'virement', date_depot: OPEN_DAY })
  const caisse1 = await manager.api(`/api/caisse?store_id=${STORE}&date=${OPEN_DAY}`)
  check('caisse: counts the 100 DH cash deposit, not the 200 DH transfer', caisse1.data?.data?.total_reparations === 100, caisse1.data?.data?.total_reparations)

  // ── 5. Cancel with reason ──────────────────────────────────────────────
  const cashId = cash.data?.data?.rep_id
  const empCancel = await employee.api('/api/repairs/cancel', { method: 'POST', body: { rep_id: cashId, motif: 'erreur de saisie' } })
  check('cancel: employee refused (403)', empCancel.status === 403, empCancel)
  const noReason = await manager.api('/api/repairs/cancel', { method: 'POST', body: { rep_id: cashId, motif: 'x' } })
  check('cancel: reason required (400)', noReason.status === 400, noReason)
  const ok = await manager.api('/api/repairs/cancel', { method: 'POST', body: { rep_id: cashId, motif: 'Erreur de saisie (test)' } })
  const { rows: [cancelled] } = await erp.query(`select is_deleted, annule_le, annule_par, motif_annulation from reparations where rep_id = $1`, [cashId])
  check('cancel: manager with reason → hidden, who/when/why kept', ok.status === 200 && cancelled.is_deleted && cancelled.annule_le && cancelled.annule_par === manager.id && cancelled.motif_annulation === 'Erreur de saisie (test)', cancelled)
  const list = await manager.api(`/api/repairs?store_id=${STORE}`)
  check('cancel: gone from the repairs list', list.status === 200 && !list.data.data.some(r => r.rep_id === cashId), list.status)
  const caisse2 = await manager.api(`/api/caisse?store_id=${STORE}&date=${OPEN_DAY}`)
  check('cancel: its cash leaves the open caisse', caisse2.data?.data?.total_reparations === 0, caisse2.data?.data?.total_reparations)
  const { rows: [logRow] } = await erp.query(`select action_type from activity_log where record_id = $1 and action_type = 'annulation'`, [cashId])
  check('cancel: recorded in the activity log', !!logRow)
  const trackCancel = await waitFor(async () => (await web.query(`select cancelled from "RepairTracking" where ref = $1`, [cashId])).rows[0]?.cancelled === true)
  check('cancel: tracking page shows it as cancelled', trackCancel)
  const editCancelled = await manager.api('/api/repairs', { method: 'PATCH', body: { rep_id: cashId, notes: 'x' } })
  check('cancel: a cancelled ticket can’t be edited (409)', editCancelled.status === 409, editCancelled)

  const locked = await newTicket({ model: 'Locked', probleme: 'x', avance_rep: 50, mode_paiement: 'especes', date_depot: CLOSED_DAY })
  const lockedTry = await manager.api('/api/repairs/cancel', { method: 'POST', body: { rep_id: locked.data?.data?.rep_id, motif: 'Test caisse clôturée' } })
  check('cancel: refused when its money is in a closed caisse (409)', lockedTry.status === 409, lockedTry)

  // ── 6. Website requests → tickets, cancel with reason ─────────────────
  const reqId = `e2e${crypto.randomBytes(8).toString('hex')}`
  await web.query(`insert into "RepairRequest" (id, ref, kind, "customerName", "customerPhone", "deviceBrand", "deviceModel", "problemAreas", "preferredSlot", "updatedAt")
                   values ($1, 'DEM-' || upper(substr(md5($1), 1, 6)), 'SOFTWARE', 'E2E Client Réparation', $2, 'Apple', 'iPhone 11', '{donnees,compte_config}', 'après 18h', now())`, [reqId, PHONE.replace(/^0/, '+212 ')])
  cleanups.push(() => web.query(`delete from "RepairRequest" where id = $1`, [reqId]))
  const conv = await employee.api(`/api/site/requests/${reqId}/convert`, { method: 'POST' })
  if (conv.data?.rep_id) createdReps.push(conv.data.rep_id)
  const { rows: [convRow] } = conv.data?.rep_id
    ? await erp.query(`select type_reparation, problemes, client_id from reparations where rep_id = $1`, [conv.data.rep_id]) : { rows: [] }
  check('website request → software ticket with its problems', conv.status === 201 && convRow?.type_reparation === 'logiciel' && convRow?.problemes?.join() === 'donnees,compte_config', { conv, convRow })
  check('website request → reuses the client despite +212 formatting', convRow?.client_id === client.client_id, convRow)
  const again = await employee.api(`/api/site/requests/${reqId}/convert`, { method: 'POST' })
  check('website request → second click gives the same ticket', again.data?.existing === true && again.data?.rep_id === conv.data?.rep_id, again.data)

  const req2 = `e2e${crypto.randomBytes(8).toString('hex')}`
  await web.query(`insert into "RepairRequest" (id, ref, "customerName", "customerPhone", "deviceBrand", "deviceModel", "problemAreas", "updatedAt")
                   values ($1, 'DEM-' || upper(substr(md5($1), 1, 6)), 'E2E Spam', '0600000000', 'Autre', 'X', '{ecran}', now())`, [req2])
  cleanups.push(() => web.query(`delete from "RepairRequest" where id = $1`, [req2]))
  const empReq = await employee.api('/api/site/requests', { method: 'PATCH', body: { id: req2, status: 'CANCELLED', reason: 'spam évident' } })
  check('website request cancel: employee refused (403)', empReq.status === 403, empReq)
  const noR = await manager.api('/api/site/requests', { method: 'PATCH', body: { id: req2, status: 'CANCELLED' } })
  check('website request cancel: reason required (400)', noR.status === 400, noR)
  const okR = await manager.api('/api/site/requests', { method: 'PATCH', body: { id: req2, status: 'CANCELLED', reason: 'Spam évident (test)' } })
  const { rows: [r2] } = await web.query(`select status, "cancelReason" from "RepairRequest" where id = $1`, [req2])
  check('website request cancel: manager with reason', okR.status === 200 && r2.status === 'CANCELLED' && r2.cancelReason === 'Spam évident (test)', r2)
  const convCancelled = await employee.api(`/api/site/requests/${req2}/convert`, { method: 'POST' })
  check('website request: a cancelled request can’t become a ticket (409)', convCancelled.status === 409, convCancelled)
} catch (err) {
  check('script ran to the end', false, String(err?.stack ?? err))
} finally {
  for (const fn of cleanups.reverse()) { try { await fn() } catch (e) { console.error('cleanup:', e.message) } }
  await erp.end(); await web.end()
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  → ${r.detail}`}`)
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
