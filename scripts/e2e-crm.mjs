// End-to-end checks of the CRM (social-media leads) and of sales to deliver,
// against a running ERP dev server (default http://localhost:3100) whose env
// points at a TEST branch (DIRECT_URL).
//
// Owner's rules (2026-10-18):
//   • CRM: managers and owner only; a lead is won by what really happened (a
//     sale, a delivery, a phone bought), lost with a reason; numbers per channel
//   • orders to deliver are taken at the POS: items set aside, a phone needs a
//     300 DH advance (bank transfer) before it ships, accessories alone don't;
//     delivered → the sale is recorded that day, paid by bank (never the
//     drawer); refused → back to stock, no sale, the advance kept or refunded
//
//   node scripts/e2e-crm.mjs
import 'dotenv/config'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100'
const STORE = 'EZ-001'
const url = process.env.DIRECT_URL
if (!url) { console.error('DIRECT_URL is not set'); process.exit(1) }
if (/ep-royal-cloud-b130i960|ep-still-tree-b1u5yng9/.test(url)) { console.error('DIRECT_URL points at PRODUCTION — use a Neon test branch'); process.exit(1) }

const db = new pg.Client({ connectionString: url }); await db.connect()
const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 300) })
const n = v => (v == null ? null : Number(v))
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
  const email = `zz-e2e-crm-${role}@migration.local`
  await db.query(`delete from user_profiles where email = $1`, [email]).catch(() => {})
  const { rows: [u] } = await db.query(
    `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
     values ($1, $2, $3, $4, $5, true, true) returning id`, [email, await bcrypt.hash(password, 10), `E2E CRM ${role}`, role, STORE])
  userIds.push(u.id)
  return await login(email, password)
}

// What the test touches, to put back at the end
const phonesTaken = [], accTaken = [], leadIds = [], deliveryIds = []
const TEL = '0699' + String(Date.now()).slice(-6)

try {
  const manager = await makeUser('gerant')
  const staff   = await makeUser('employe')
  const { rows: phones } = await db.query(`select phone_id, status::text, prix_vente_recommande from phones where store_id = $1 and not is_deleted and status = 'disponible' and prix_vente_recommande > 500 order by created_at desc limit 3`, [STORE])
  const { rows: [acc] } = await db.query(`select acc_id, quantite, prix_vente_recommande from accessories where store_id = $1 and not is_deleted and quantite > 5 and categorie <> 'service' limit 1`, [STORE])
  if (phones.length < 3 || !acc) throw new Error('not enough stock on the test branch')
  phonesTaken.push(...phones); accTaken.push(acc)
  const [P1, P2, P3] = phones
  // An open caisse today, to check the drawer is never touched by deliveries
  const { rows: [cai] } = await db.query(`select caisse_id from caisse where store_id = $1 and date = $2`, [STORE, today])
  if (!cai) await db.query(`insert into caisse (date, store_id, ouverture, status, created_by) values ($1, $2, 0, 'ouverte', $3)`, [today, STORE, userIds[0]])

  // ── CRM: who ────────────────────────────────────────────────────────
  check('staff cannot read the CRM (403)', (await staff(`/api/leads?store_id=${STORE}`)).status === 403)
  check('staff cannot add a lead (403)', (await staff('/api/leads', { method: 'POST', body: { canal: 'instagram', nom: 'x' } })).status === 403)

  // ── CRM: a conversation ─────────────────────────────────────────────
  check('a lead needs a name, @ or number (400)', (await manager('/api/leads', { method: 'POST', body: { canal: 'instagram' } })).status === 400)
  check('an unknown channel is refused (400)', (await manager('/api/leads', { method: 'POST', body: { canal: 'snapchat', nom: 'x' } })).status === 400)
  const c1 = await manager('/api/leads', { method: 'POST', body: { store_id: STORE, canal: 'instagram', nom: 'E2E Karim', pseudo: '@E2E.Karim', telephone: TEL, type_demande: 'achat', cherche: 'telephone', budget_max: 99999, note: 'Cherche un téléphone' } })
  const L1 = c1.data?.data?.lead_id; if (L1) leadIds.push(L1)
  check('a manager adds an Instagram conversation', c1.status === 201 && /^LEAD-/.test(L1 ?? '') && c1.data.data.pseudo === 'E2E.Karim', c1.data)
  const byPseudo = await manager(`/api/leads?store_id=${STORE}&contact=${encodeURIComponent('@e2e.karim')}`)
  const byPhone  = await manager(`/api/leads?store_id=${STORE}&contact=${encodeURIComponent('+212 ' + TEL.slice(1))}`)
  check('the same person is found again by @ and by number', byPseudo.data?.data?.some(l => l.lead_id === L1) && byPhone.data?.data?.some(l => l.lead_id === L1))
  const detail = await manager(`/api/leads/${L1}`)
  check('the first note is in the journal', detail.data?.data?.lead_notes?.[0]?.texte === 'Cherche un téléphone', detail.data?.data?.lead_notes)

  check('lost needs a reason (400)', (await manager(`/api/leads/${L1}`, { method: 'PATCH', body: { etape: 'perdu' } })).status === 400)
  const lost = await manager(`/api/leads/${L1}`, { method: 'PATCH', body: { etape: 'perdu', motif_perte: 'prix', note: 'Trop cher' } })
  check('a lead is lost with its reason', lost.status === 200 && lost.data?.data?.etape === 'perdu' && lost.data.data.motif_perte === 'prix', lost.data)
  const back = await manager(`/api/leads/${L1}`, { method: 'PATCH', body: { etape: 'en_discussion' } })
  check('…and reopened', back.status === 200 && back.data?.data?.etape === 'en_discussion' && back.data.data.motif_perte === null)
  check('won needs what happened (400)', (await manager(`/api/leads/${L1}`, { method: 'PATCH', body: { etape: 'gagne' } })).status === 400)
  check('won with an unknown sale is refused (400)', (await manager(`/api/leads/${L1}`, { method: 'PATCH', body: { etape: 'gagne', txn_id: 'TXN-999999' } })).status === 400)

  const c2 = await manager('/api/leads', { method: 'POST', body: { store_id: STORE, canal: 'whatsapp', nom: 'E2E Vendeur', telephone: TEL, type_demande: 'vente', leur_marque: 'Apple', leur_model: '11', prix_demande: 1500 } })
  const L2 = c2.data?.data?.lead_id; if (L2) leadIds.push(L2)
  const bought = await manager(`/api/leads/${L2}`, { method: 'PATCH', body: { etape: 'gagne', phone_id: P1.phone_id } })
  check('a "nous vendre" lead is won by the phone bought from them', bought.status === 200 && bought.data?.data?.etape === 'gagne' && bought.data.data.phone_id === P1.phone_id, bought.data)

  // ── Order to deliver: a phone, no advance yet ───────────────────────
  check('staff cannot take an order to deliver (403)', (await staff('/api/deliveries/order', { method: 'POST', body: {} })).status === 403)
  const order = body => manager('/api/deliveries/order', { method: 'POST', body: { store_id: STORE, client: { nom: 'E2E Karim', telephone: TEL }, adresse: '12 rue Test', ville: 'Fès', transporteur: 'E2E Express', ...body } })
  const o1 = await order({ frais_livraison: 30, frais_charge: 'client', lead_id: L1,
    items: [{ device_type: 'telephone', device_id: P2.phone_id, qty: 1, prix_vente: 3000 }, { device_type: 'accessoire', device_id: acc.acc_id, qty: 2, prix_vente: 100 }] })
  const D1 = o1.data?.data?.delivery_id; if (D1) deliveryIds.push(D1)
  check('an order with a phone and no advance waits for it', o1.status === 201 && o1.data?.data?.statut === 'attente_avance' && n(o1.data.data.montant_total) === 3100, o1.data)
  const st = async id => (await db.query(`select status::text from phones where phone_id = $1`, [id])).rows[0].status
  const qty = async () => (await db.query(`select quantite from accessories where acc_id = $1`, [acc.acc_id])).rows[0].quantite
  check('the phone is set aside (en livraison)', (await st(P2.phone_id)) === 'en_livraison')
  check('the accessories leave the stock', (await qty()) === acc.quantite - 2, { now: await qty(), was: acc.quantite })
  const { rows: [l1] } = await db.query(`select etape::text, delivery_id, client_id from leads where lead_id = $1`, [L1])
  check('the lead follows the order', l1.etape === 'proposition' && l1.delivery_id === D1 && !!l1.client_id, l1)
  check('the same phone cannot go in a second order (409)', (await order({ items: [{ device_type: 'telephone', device_id: P2.phone_id, qty: 1, prix_vente: 3000 }] })).status === 409)
  check('no sale exists before delivery', (await db.query(`select count(*)::int c from transactions where payment_ref = $1`, [D1])).rows[0].c === 0)

  const ship = await manager('/api/deliveries', { method: 'PATCH', body: { delivery_id: D1, statut: 'en_transit' } })
  check('a phone does not ship before its advance (400)', ship.status === 400 && /300/.test(ship.data?.error ?? ''), ship.data)
  const av = await manager('/api/deliveries', { method: 'PATCH', body: { delivery_id: D1, action: 'avance', montant: 300, ref: 'VIR-E2E' } })
  check('the advance arrives (300 by transfer): ready to ship', av.status === 200 && av.data?.data?.statut === 'prepare' && n(av.data.data.montant_avance) === 300, av.data)
  check('…and it goes on its way', (await manager('/api/deliveries', { method: 'PATCH', body: { delivery_id: D1, statut: 'en_transit' } })).status === 200)
  const list = await manager(`/api/deliveries?store_id=${STORE}`)
  const card = list.data?.data?.find(d => d.delivery_id === D1)
  check('the card says what the agent collects (rest + fee) and what the company pays', card?.money?.aEncaisser === 2830 && card.money.verse === 2800 && card.delivery_items.every(i => i.label), card?.money)

  const cashBefore = (await manager(`/api/caisse?store_id=${STORE}&date=${today}`)).data?.data?.payment_breakdown ?? null
  const done = await manager('/api/deliveries', { method: 'PATCH', body: { delivery_id: D1, statut: 'livre' } })
  check('delivered', done.status === 200 && done.data?.data?.statut === 'livre' && String(done.data.data.date_livraison).slice(0, 10) === today, done.data)
  const { rows: sales } = await db.query(`select txn_id, device_type::text, payment_method::text, prix_vente, date_vente::text, client_id, warranty_start::text from transactions where payment_ref = $1 order by txn_id`, [D1])
  check('two sales recorded on the delivery day, paid by bank', sales.length === 2 && sales.every(s => s.payment_method === 'virement' && s.date_vente === today && s.client_id) && sales.reduce((a, s) => a + Number(s.prix_vente), 0) === 3100, sales)
  check('warranty starts on the delivery day', sales.every(s => s.warranty_start === today))
  check('the phone is sold', (await st(P2.phone_id)) === 'vendu')
  check('the accessories are not taken out a second time', (await qty()) === acc.quantite - 2)
  const { rows: [l1b] } = await db.query(`select etape::text, montant, txn_id from leads where lead_id = $1`, [L1])
  check('the lead is won with the order total', l1b.etape === 'gagne' && n(l1b.montant) === 3100 && !!l1b.txn_id, l1b)
  const cashAfter = (await manager(`/api/caisse?store_id=${STORE}&date=${today}`)).data?.data?.payment_breakdown ?? null
  if (cashBefore && cashAfter) {
    check('the drawer is not touched (bank only)', cashAfter.cash === cashBefore.cash && cashAfter.transfer === cashBefore.transfer + 3100, { cashBefore, cashAfter })
  } else console.log('SKIP  no open caisse today on the test branch: drawer check skipped')
  check('a delivered order cannot be refused afterwards (400)', (await manager('/api/deliveries', { method: 'PATCH', body: { delivery_id: D1, statut: 'retour', motif: 'test' } })).status === 400)
  const paid = await manager('/api/deliveries', { method: 'PATCH', body: { delivery_id: D1, action: 'versement', recu: true } })
  check('the company\'s payment is marked received', paid.status === 200 && !!paid.data?.data?.versement_recu_at)

  // ── Accessories alone: no advance, then cancelled ───────────────────
  const qBefore = await qty()
  const o2 = await order({ items: [{ device_type: 'accessoire', device_id: acc.acc_id, qty: 1, prix_vente: 120 }] })
  const D2 = o2.data?.data?.delivery_id; if (D2) deliveryIds.push(D2)
  check('accessories alone ship without an advance', o2.status === 201 && o2.data?.data?.statut === 'prepare', o2.data)
  check('cancelling needs a reason (400)', (await manager('/api/deliveries', { method: 'PATCH', body: { delivery_id: D2, statut: 'annule' } })).status === 400)
  const cancel = await manager('/api/deliveries', { method: 'PATCH', body: { delivery_id: D2, statut: 'annule', motif: 'Le client a annulé' } })
  check('cancelled: the accessory is back in stock, no sale', cancel.status === 200 && (await qty()) === qBefore
    && (await db.query(`select count(*)::int c from transactions where payment_ref = $1`, [D2])).rows[0].c === 0, { now: await qty(), qBefore })

  // ── A phone refused at the door, advance kept, fee on the shop ──────
  const c3 = await manager('/api/leads', { method: 'POST', body: { store_id: STORE, canal: 'tiktok', pseudo: 'e2e_refus', telephone: TEL, type_demande: 'achat' } })
  const L3 = c3.data?.data?.lead_id; if (L3) leadIds.push(L3)
  const o3 = await order({ avance: 300, avance_ref: 'VIR-E2E-2', frais_livraison: 35, frais_charge: 'boutique', lead_id: L3, items: [{ device_type: 'telephone', device_id: P3.phone_id, qty: 1, prix_vente: 2500 }] })
  const D3 = o3.data?.data?.delivery_id; if (D3) deliveryIds.push(D3)
  check('an order with its advance is ready at once', o3.status === 201 && o3.data?.data?.statut === 'prepare', o3.data)
  await manager('/api/deliveries', { method: 'PATCH', body: { delivery_id: D3, statut: 'en_transit' } })
  check('refused: the advance must be decided (400)', (await manager('/api/deliveries', { method: 'PATCH', body: { delivery_id: D3, statut: 'retour', motif: 'Client injoignable' } })).status === 400)
  const ref = await manager('/api/deliveries', { method: 'PATCH', body: { delivery_id: D3, statut: 'retour', motif: 'Client injoignable', avance_decision: 'gardee' } })
  check('refused: the phone is back for sale', ref.status === 200 && (await st(P3.phone_id)) === 'disponible', ref.data)
  const { rows: [l3] } = await db.query(`select etape::text, motif_perte::text from leads where lead_id = $1`, [L3])
  check('…and its lead is lost (refused at delivery)', l3.etape === 'perdu' && l3.motif_perte === 'refus_livraison', l3)
  const fin = await manager(`/api/analytics?store_id=${STORE}&from=${today}&to=${today}`)
  check('the kept advance counts as income', n(fin.data?.data?.totals?.keptAdvances) >= 300, fin.data?.data?.totals)

  // ── Numbers ─────────────────────────────────────────────────────────
  const stats = await manager(`/api/leads/stats?store_id=${STORE}&from=${today}&to=${today}`)
  const s = stats.data?.data
  const insta = s?.canaux?.find(r => r.key === 'instagram')
  check('numbers per channel: Instagram won with its amount', insta?.gagne >= 1 && insta.montant >= 3100, insta)
  check('numbers: why leads are lost', s?.motifs?.some(m => m.key === 'refus_livraison'), s?.motifs)
  check('staff cannot see the numbers (403)', (await staff(`/api/leads/stats?store_id=${STORE}`)).status === 403)
} catch (err) {
  check('script ran to the end', false, String(err?.stack ?? err))
} finally {
  // Put everything back as it was
  try {
    const txns = (await db.query(`select txn_id from transactions where payment_ref = any($1)`, [deliveryIds])).rows.map(r => r.txn_id)
    await db.query(`update leads set txn_id = null where lead_id = any($1)`, [leadIds])
    await db.query(`delete from delivery_items where delivery_id = any($1)`, [deliveryIds])
    await db.query(`delete from transactions where txn_id = any($1)`, [txns])
    await db.query(`delete from deliveries where delivery_id = any($1)`, [deliveryIds])
    await db.query(`delete from leads where lead_id = any($1)`, [leadIds])
    for (const p of phonesTaken) await db.query(`update phones set status = $2, updated_by = null where phone_id = $1`, [p.phone_id, p.status])
    for (const a of accTaken) await db.query(`update accessories set quantite = $2, updated_by = null where acc_id = $1`, [a.acc_id, a.quantite])
    await db.query(`delete from caisse where store_id = $1 and date = $2 and created_by = any($3)`, [STORE, today, userIds])
    await db.query(`delete from clients where telephone = $1 and created_by = any($2)`, [TEL, userIds])
    await db.query(`delete from activity_log where user_id = any($1)`, [userIds])
    await db.query(`delete from user_profiles where id = any($1)`, [userIds])
  } catch (e) { console.error('cleanup:', e.message) }
  await db.end()
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  → ${r.detail}`}`)
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
