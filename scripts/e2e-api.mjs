// End-to-end API checks against a running server (default http://localhost:3100, override
// with E2E_BASE) and the Neon database in DIRECT_URL. Creates throwaway users/stores and
// removes everything it created. Modules: smoke roles expenses caisse writes
//   node scripts/e2e-api.mjs smoke roles expenses caisse writes
import 'dotenv/config'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100'
const STORE = 'EZ-001'
const db = new pg.Client({ connectionString: process.env.DIRECT_URL })
await db.connect()

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300) })
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

const password = crypto.randomBytes(12).toString('base64url')
const email = 'zz-e2e-api@migration.local'
const { rows: [me] } = await db.query(
  `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
   values ($1, $2, 'E2E API', 'gerant', null, false, true) returning id`, [email, await bcrypt.hash(password, 10)])
cleanups.push(async () => {
  await db.query(`delete from activity_log where user_id = $1`, [me.id])
  await db.query(`delete from user_profiles where id = $1`, [me.id])
})

const api = await login(email, password)
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

const MODULES = {
  async expenses() {
    const cats = await api('/api/categories')
    check('categories: grouped with codes', cats.status === 200 && cats.data.expenses?.some(c => c.code === 'nourriture' && c.ar === 'أكل'), cats.data?.expenses?.slice(0, 2))

    const bad = await api('/api/expenses', { method: 'POST', body: { montant: 10, categorie: 'n_existe_pas', store_id: STORE } })
    check('expenses: unknown category rejected (409)', bad.status === 409, bad)

    const created = await api('/api/expenses', { method: 'POST', body: { montant: '12.50', categorie: 'nourriture', date: '2026-09-20', notes: 'e2e', store_id: STORE } })
    const exp = created.data?.data
    if (exp) cleanups.push(() => db.query(`delete from expenses where exp_id = $1`, [exp.exp_id]))
    check('expenses: create → 201, montant is a number, date is YYYY-MM-DD', created.status === 201 && exp?.montant === 12.5 && exp?.date === '2026-09-20' && exp?.created_by === me.id, created)

    const list = await api(`/api/expenses?store_id=${STORE}&date_from=2026-09-20&date_to=2026-09-20&categorie=nourriture`)
    const row = list.data?.data?.find(e => e.exp_id === exp?.exp_id)
    check('expenses: list filters by date + category', list.status === 200 && !!row && list.data.data.every(e => e.categorie === 'nourriture' && e.date === '2026-09-20'), list.data?.data?.length)
    check('expenses: list values typed like Supabase', typeof row?.montant === 'number' && isDate(row?.date) && typeof row?.created_at === 'string', row)

    const { rows: [log] } = await db.query(`select notes, action_type, module from activity_log where record_id = $1 and action_type = 'creation'`, [exp?.exp_id])
    check('expenses: activity log in French codes', log?.notes === 'Nourriture — 12.5 MAD' && log?.module === 'depenses', log)

    const del = await api(`/api/expenses?exp_id=${exp?.exp_id}`, { method: 'DELETE' })
    const { rows: [after] } = await db.query(`select is_deleted from expenses where exp_id = $1`, [exp?.exp_id])
    check('expenses: delete is a soft delete', del.status === 200 && after?.is_deleted === true, del)

    const unauth = await fetch(BASE + `/api/expenses?store_id=${STORE}`, { redirect: 'manual' })
    check('expenses: signed-out request refused', unauth.status === 307 || unauth.status === 401, String(unauth.status))
  },

  // Every read endpoint answers 200 with real data (as a manager)
  async smoke() {
    const one = async (sql) => (await db.query(sql)).rows[0] ?? {}
    const sup   = await one(`select supplier_id from suppliers limit 1`)
    const cred  = await one(`select phone_id from phone_credit_sales limit 1`)
    const sess  = await one(`select session_id from inventory_sessions order by started_at desc limit 1`)
    const imei  = await one(`select imei from phones where status = 'disponible' and imei is not null and store_id = 'EZ-001' limit 1`)
    const doc   = await one(`select doc_ref from ez_documents limit 1`)
    const txn   = await one(`select txn_id from transactions where device_type = 'telephone' and not voided order by created_at desc limit 1`)
    const today = new Date().toISOString().slice(0, 10)
    const S = STORE
    const urls = [
      '/api/categories', `/api/expenses?store_id=${S}`, `/api/caisse?store_id=${S}`, '/api/bzg/caisse',
      `/api/cash-drops?store_id=${S}`, '/api/stores', `/api/transactions?store_id=${S}&limit=20&with_device=1`,
      `/api/phones?store_id=${S}&limit=20`, `/api/phones?store_id=${S}&status=disponible&search=iphone`, '/api/phones/catalog',
      `/api/laptops?store_id=${S}`, `/api/accessories?store_id=${S}`, `/api/accessories?store_id=${S}&low_stock=true&search=ch`,
      '/api/accessories/generate-barcode', `/api/movements?store_id=${S}`, `/api/repairs?store_id=${S}`,
      `/api/clients?store_id=${S}`, '/api/clients?search=06', `/api/suppliers?store_id=${S}`, '/api/suppliers?mode=dropdown',
      `/api/supplier-payments?store_id=${S}`, `/api/supplier-payments?mode=unsettled_phones&supplier_id=${sup.supplier_id}`,
      `/api/credits?store_id=${S}`, `/api/credit-imports?store_id=${S}`, `/api/phone-credits?store_id=${S}`,
      `/api/phone-credits?phone_id=${cred.phone_id}`, `/api/phone-credits?store_id=${S}&statut=en_cours`, `/api/attendance?store_id=${S}`,
      '/api/bzg/dashboard', `/api/dashboard?store_id=${S}&start=${today.slice(0, 7)}-01&end=${today}`,
      `/api/prospects?store_id=${S}`, `/api/prospects?store_id=${S}&open=1&source=whatsapp`, `/api/inventory?store_id=${S}`,
      `/api/inventory/${sess.session_id}`, `/api/deliveries?store_id=${S}`, '/api/documents?limit=10',
      `/api/documents?lookup_imei=${imei.imei}`, `/api/documents/${doc.doc_ref}`, `/api/warranty?txn_id=${txn.txn_id}`,
      '/api/log?limit=20&module=transactions', '/api/changelog', '/api/users', '/api/settings',
    ]
    const results = await Promise.all(urls.map(async (u) => [u, await api(u)]))
    const bad = results.filter(([, r]) => r.status !== 200)
    check(`smoke: ${urls.length} GET endpoints answer 200`, bad.length === 0, bad.map(([u, r]) => `${u} → ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`).join(' | '))

    const get = (prefix) => results.find(([u]) => u.startsWith(prefix))[1].data
    check('smoke: users list never exposes password hashes', !JSON.stringify(get('/api/users')).includes('password_hash'))
    check('smoke: client summary view reachable, balances are numbers', (get('/api/clients?store_id').data ?? []).every(c => Object.values(c).every(v => typeof v !== 'object' || v === null)), get('/api/clients?store_id').data?.[0])
    const dash = get('/api/dashboard')
    check('smoke: dashboard returns costs for managers + numeric amounts', Object.keys(dash.costMap ?? {}).length > 0 && dash.periodTxns.every(t => typeof t.prix_vente === 'number'), Object.keys(dash))
    const phones = get(`/api/phones?store_id=${S}&limit`).data ?? []
    check('smoke: phone values are French codes', phones.length > 0 && phones.every(p => /^[a-z_]+$/.test(p.status) && /^[a-z_]+$/.test(p.condition)), phones.slice(0, 2).map(p => [p.status, p.condition]))
    const acc = get(`/api/accessories?store_id=${S}&low`).data ?? []
    check('smoke: low-stock filter compares two columns correctly', acc.every(a => a.quantite <= a.seuil_alerte && a.is_low_stock), acc.slice(0, 2))
    const w = get('/api/warranty').data
    check('smoke: warranty uses the SQL function', w && 'warranty_expiry_effective' in w && ['active', 'expired', 'no_warranty'].includes(w.warranty_status), w)
  },

  // Every module's write workflow, in an isolated store
  async writes() {
    const S = 'E2E-W01'
    const today = new Date().toISOString().slice(0, 10)
    const rnd = () => String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1e6)).padStart(6, '0')
    const created = { docs: [], phones: [], users: [] }
    await db.query(`insert into stores (store_id, name) values ($1, 'E2E writes')`, [S])
    cleanups.push(async () => {
      const q = (sql, p = [S]) => db.query(sql, p).catch(e => console.error('cleanup:', sql.slice(0, 60), e.message))
      await q(`delete from activity_log where store_id = $1`)
      await q(`delete from inventory_session_items where session_id in (select session_id from inventory_sessions where store_id = $1)`)
      await q(`delete from inventory_sessions where store_id = $1`)
      await q(`delete from delivery_items where delivery_id in (select delivery_id from deliveries where store_id = $1)`)
      await q(`delete from deliveries where store_id = $1`)
      await q(`delete from phone_credit_payments where credit_id in (select credit_id from phone_credit_sales where store_id = $1)`)
      await q(`delete from phone_credit_sales where store_id = $1`)
      await q(`delete from credit_import_payments where import_id in (select import_id from credit_imports where store_id = $1)`)
      await q(`delete from credit_imports where store_id = $1`)
      await q(`delete from supplier_payments where store_id = $1`)
      await q(`delete from reparations_parts where rep_id in (select rep_id from reparations where store_id = $1)`)
      await q(`delete from reparations where store_id = $1`)
      await q(`delete from stock_movements where store_id = $1`)
      const phoneIds = (await db.query(`select phone_id from phones where store_id = $1`, [S])).rows.map(r => r.phone_id)
      await q(`delete from warranty_events where txn_id in (select txn_id from transactions where device_id = any($1))`, [phoneIds])
      for (const d of created.docs) await q(`delete from ez_documents where doc_id = $1`, [d])
      await q(`delete from transactions where device_id = any($1) or store_id = $2`, [phoneIds, S])
      await q(`delete from phones where store_id = $1`)
      await q(`delete from accessories where store_id = $1`)
      await q(`delete from clients where store_id = $1`)
      await q(`delete from suppliers where store_id = $1`)
      await q(`delete from prospects where store_id = $1`)
      await q(`delete from staff_attendance where store_id = $1`)
      await q(`delete from cash_drops where store_id = $1`)
      await q(`delete from settings where store_id = $1`)
      for (const u of created.users) { await q(`delete from activity_log where user_id = $1`, [u]); await q(`delete from user_profiles where id = $1`, [u]) }
      await q(`delete from stores where store_id = $1`)
    })

    const phone = async (extra = {}) => {
      const r = await api('/api/phones', { method: 'POST', body: {
        marque: 'Apple', model: 'iPhone E2E', status: 'disponible', condition: 'occasion', source: 'fournisseur',
        location: 'magasin_principal', imei: rnd(), prix_achat: '1500', battery_level: '90', date_entree: '2026-09-20', store_id: S, ...extra } })
      return r
    }

    // ── phones: text numbers/dates are coerced like Supabase did
    const p1 = await phone()
    check('phones: create with text numbers → 201, typed values', p1.status === 201 && p1.data.data.battery_level === 90 && p1.data.data.prix_achat === 1500 && p1.data.data.date_entree === '2026-09-20', p1)
    const p1id = p1.data?.data?.phone_id
    const upd = await api('/api/phones', { method: 'PATCH', body: { phone_id: p1id, prix_vente_recommande: '2000' } })
    check('phones: partial update', upd.status === 200 && upd.data.data.prix_vente_recommande === 2000 && upd.data.data.imei === p1.data.data.imei, upd.status)

    // ── movements: partial accessory move creates a row with its own barcode, then merges
    const acc = await api('/api/accessories', { method: 'POST', body: { nom: 'E2E cable', categorie: 'cable', quantite: '10', store_id: S } })
    check('accessories: create → barcode assigned by the database', acc.status === 201 && acc.data.data.barcode === acc.data.data.acc_id, acc)
    const accId = acc.data?.data?.acc_id
    const mv = (body) => api('/api/movements', { method: 'POST', body: { store_id: S, from_location: 'magasin_principal', ...body } })
    const m1 = await mv({ device_type: 'accessoire', device_id: accId, quantity: 4, to_location: 'magasin_secondaire' })
    const rows1 = (await db.query(`select acc_id, quantite, barcode, location from accessories where store_id = $1 order by created_at`, [S])).rows
    check('movements: partial move 4/10 → source 6, new row 4 with its own barcode', m1.status === 201 && rows1.length === 2 && rows1[0].quantite === 6 && rows1[1].quantite === 4 && rows1[1].barcode !== rows1[0].barcode && rows1[1].location === 'magasin_secondaire', rows1)
    await mv({ device_type: 'accessoire', device_id: accId, quantity: 2, to_location: 'magasin_secondaire' })
    const rows2 = (await db.query(`select quantite from accessories where store_id = $1 order by created_at`, [S])).rows.map(r => r.quantite)
    check('movements: second move merges into destination (4 + 2)', JSON.stringify(rows2) === '[4,6]', rows2)
    const tooMuch = await mv({ device_type: 'accessoire', device_id: accId, quantity: 99, to_location: 'externe' })
    check('movements: moving more than in stock → 400, nothing written', tooMuch.status === 400, tooMuch)
    await mv({ device_type: 'telephone', device_id: p1id, to_location: 'externe', reason: 'reparation_externe' })
    let ph = (await db.query(`select status, location from phones where phone_id = $1`, [p1id])).rows[0]
    check('movements: phone out for external repair → en_reparation / externe', ph.status === 'en_reparation' && ph.location === 'externe', ph)
    await mv({ device_type: 'telephone', device_id: p1id, from_location: 'externe', to_location: 'magasin_principal', reason: 'retour' })
    ph = (await db.query(`select status, location from phones where phone_id = $1`, [p1id])).rows[0]
    check('movements: phone back → disponible / magasin_principal', ph.status === 'disponible' && ph.location === 'magasin_principal', ph)

    // ── repairs + parts
    const rep = await api('/api/repairs', { method: 'POST', body: { model: 'Galaxy E2E', probleme: 'Écran cassé', cout_reparation: '300', avance_rep: '100', statut: 'en_attente', date_depot: today, store_id: S } })
    const repId = rep.data?.data?.rep_id
    const part = await api('/api/repairs/parts', { method: 'POST', body: { rep_id: repId, nom_piece: 'Écran OLED', cout: 150 } })
    const reps = await api(`/api/repairs?store_id=${S}`)
    const r0 = reps.data?.data?.[0]
    check('repairs: create + part (was always failing before) + balance', rep.status === 201 && part.status === 201 && r0?.fariq_rep === 200 && r0?.parts_cost === 150 && r0?.reparations_parts?.[0]?.description === 'Écran OLED', { rep: rep.status, part: part.status, r0: r0 && [r0.fariq_rep, r0.parts_cost] })
    await api('/api/repairs', { method: 'PATCH', body: { rep_id: repId, statut: 'recupere', date_livraison: today } })
    const { rows: [rlog] } = await db.query(`select notes from activity_log where record_id = $1 and action_type = 'modification'`, [repId])
    check('repairs: status change logged in French', rlog?.notes === 'Statut → Récupéré', rlog)

    // ── clients
    const tel = '06' + rnd().slice(-8)
    const c1 = await api('/api/clients', { method: 'POST', body: { nom: 'Client E2E', telephone: tel, store_id: S } })
    const c2 = await api('/api/clients', { method: 'POST', body: { nom: 'Doublon', telephone: tel, store_id: S } })
    check('clients: create, then same phone returns the existing client', c1.status === 201 && c2.data?.existing === true && c2.data.data.client_id === c1.data.data.client_id, [c1.status, c2.data?.existing])
    const clientId = c1.data?.data?.client_id

    // ── suppliers + settlement
    const sp = await api('/api/suppliers', { method: 'POST', body: { nom: 'Fournisseur E2E', categorie: '', store_id: S } })
    check('suppliers: empty category stored as null', sp.status === 201 && sp.data.data.categorie === null, sp)
    const spu = await api('/api/suppliers', { method: 'PATCH', body: { supplier_id: sp.data?.data?.supplier_id, categorie: 'telephones' } })
    check('suppliers: category by code', spu.status === 200 && spu.data.data.categorie === 'telephones', spu.status)
    const pay = await api('/api/supplier-payments', { method: 'POST', body: { supplier_id: sp.data?.data?.supplier_id, payment_type: 'reglement_a', montant: 1000, phone_ids: [p1id], store_id: S } })
    const settled = (await db.query(`select settled_at from phones where phone_id = $1`, [p1id])).rows[0]
    check('supplier payment: reglement_a settles its phones in the same transaction', pay.status === 201 && settled.settled_at !== null, pay.status)

    // ── imported credits (trigger keeps the balance)
    const ci = await api('/api/credit-imports', { method: 'POST', body: { client_id: clientId, montant_du: 500, date_origine: today, store_id: S } })
    const ciId = ci.data?.data?.import_id
    const cp1 = await api('/api/credit-imports/payments', { method: 'POST', body: { import_id: ciId, montant: 200, store_id: S } })
    const cpBad = await api('/api/credit-imports/payments', { method: 'POST', body: { import_id: ciId, montant: 400, store_id: S } })
    const cp2 = await api('/api/credit-imports/payments', { method: 'POST', body: { import_id: ciId, montant: 300, store_id: S } })
    const ciRow = (await db.query(`select montant_paye::float8 p, statut::text s from credit_imports where import_id = $1`, [ciId])).rows[0]
    check('credit import: overpayment refused, balance reaches "solde"', cp1.status === 201 && cpBad.status === 400 && cp2.status === 201 && ciRow.p === 500 && ciRow.s === 'solde', [cp1.status, cpBad.status, cp2.status, ciRow])

    // ── phone credit: reserve → pay → discharge
    const p2 = (await phone()).data.data.phone_id
    const pc = await api('/api/phone-credits', { method: 'POST', body: { phone_id: p2, client_name: 'Client E2E', montant_total: 3000, avance_initiale: 1000, payment_method: 'especes', phone_remis: false, store_id: S } })
    let st = (await db.query(`select status from phones where phone_id = $1`, [p2])).rows[0].status
    check('phone credit: created, phone reserved', pc.status === 201 && st === 'reserve', [pc.status, st])
    const pcId = pc.data?.data?.credit?.credit_id
    const pp = await api(`/api/phone-credits/${pcId}/payments`, { method: 'POST', body: { montant: 2000, payment_method: 'especes' } })
    check('phone credit: payment completes it', pp.status === 201 && pp.data.data.credit_updated.statut === 'solde', pp)
    const dis = await api(`/api/phone-credits/${pcId}/discharge`, { method: 'POST', body: { store_id: S } })
    st = (await db.query(`select status from phones where phone_id = $1`, [p2])).rows[0].status
    const dis2 = await api(`/api/phone-credits/${pcId}/discharge`, { method: 'POST', body: { store_id: S } })
    check('phone credit: discharge sells the phone, second discharge refused', dis.status === 200 && st === 'vendu' && dis2.status === 400, [dis.status, st, dis2.status])

    // ── phone credit with trade-in: discharge adds the trade-in phone to stock
    const p3 = (await phone()).data.data.phone_id
    const pcr = await api('/api/phone-credits', { method: 'POST', body: { phone_id: p3, client_name: 'Reprise E2E', montant_total: 3000, avance_initiale: 2500, payment_method: 'especes', phone_remis: true, has_reprise: true, reprise_marque: 'Samsung', reprise_model: 'A50', reprise_valeur: 500, reprise_etat: 'mauvais', store_id: S } })
    const disr = await api(`/api/phone-credits/${pcr.data?.data?.credit?.credit_id}/discharge`, { method: 'POST', body: { store_id: S } })
    const trade = disr.data?.data?.reprise_phone_id && (await db.query(`select source::text, status::text, condition::text, prix_achat::float8 from phones where phone_id = $1`, [disr.data.data.reprise_phone_id])).rows[0]
    check('phone credit: trade-in enters stock as reprise / disponible / defectueux', pcr.data?.data?.credit?.statut === 'solde' && trade?.source === 'reprise' && trade?.status === 'disponible' && trade?.condition === 'defectueux' && trade?.prix_achat === 500, { credit: pcr.data?.data?.credit?.statut, trade })

    // ── deliveries
    const p4 = (await phone()).data.data.phone_id
    const dl = await api('/api/deliveries', { method: 'POST', body: { client_name: 'Livraison E2E', client_phone: tel, client_address: 'Casablanca', statut: 'prepare', payment_scenario: 'avance_partielle', montant_total: 2000, montant_avance: 500, store_id: S, items: [{ device_type: 'telephone', device_id: p4 }] } })
    st = (await db.query(`select status from phones where phone_id = $1`, [p4])).rows[0].status
    check('deliveries: create → phone en_livraison, advance flagged', dl.status === 201 && st === 'en_livraison' && dl.data.data.caisse_entry_created === true, [dl.status, st, dl.data?.error])
    const dl2 = await api('/api/deliveries', { method: 'PATCH', body: { delivery_id: dl.data?.data?.delivery_id, statut: 'livre' } })
    st = (await db.query(`select status from phones where phone_id = $1`, [p4])).rows[0].status
    const dl3 = await api('/api/deliveries', { method: 'PATCH', body: { delivery_id: dl.data?.data?.delivery_id, statut: 'annule' } })
    check('deliveries: delivered → vendu, then terminal (400)', dl2.status === 200 && st === 'vendu' && dl3.status === 400, [dl2.status, st, dl3.status])

    // ── inventory
    const inv = await api('/api/inventory', { method: 'POST', body: { store_id: S } })
    const sid = inv.data?.session?.session_id
    const imei1 = (await db.query(`select imei from phones where phone_id = $1`, [p1id])).rows[0].imei
    const s1 = await api(`/api/inventory/${sid}/scan`, { method: 'POST', body: { imei: imei1 } })
    const s2 = await api(`/api/inventory/${sid}/scan`, { method: 'POST', body: { imei: imei1 } })
    const s3 = await api(`/api/inventory/${sid}/scan`, { method: 'POST', body: { imei: '999' + rnd() } })
    const again = await api('/api/inventory', { method: 'POST', body: { store_id: S } })
    const cl = await api(`/api/inventory/${sid}/close`, { method: 'PATCH' })
    check('inventory: trouve → deja_scanne → non_enregistre, one session at a time, close counts',
      inv.status === 200 && s1.data?.type === 'trouve' && s2.data?.type === 'deja_scanne' && s3.data?.type === 'non_enregistre' && again.status === 409 && cl.data?.session?.statut === 'terminee' && cl.data?.counts?.trouve === 1,
      { snap: inv.data?.session?.snapshot_count, types: [s1.data?.type, s2.data?.type, s3.data?.type], again: again.status, counts: cl.data?.counts })

    // ── prospects
    const pr = await api('/api/prospects', { method: 'POST', body: { nom: 'Prospect E2E', source: 'whatsapp', demand_type: 'modele', statut: 'nouveau', store_id: S } })
    await api('/api/prospects', { method: 'PATCH', body: { prospect_id: pr.data?.data?.prospect_id, statut: 'contacte' } })
    const open = await api(`/api/prospects?store_id=${S}&open=1`)
    check('prospects: create, move to contacte, still in open list', pr.status === 201 && open.data?.data?.[0]?.statut === 'contacte', [pr.status, open.data?.data?.[0]?.statut])

    // ── document → confirm-sale (SQL function) → warranty + SAV
    const p5 = (await phone({ warranty_months: 6 })).data.data.phone_id
    const doc = await api('/api/documents', { method: 'POST', body: { doc_type: 'FAC', phone_id: p5, client_name: 'Client E2E', montant: 2500 } })
    if (doc.data?.data?.doc_id) created.docs.push(doc.data.data.doc_id)
    check('documents: invoice number from the database sequence', doc.status === 200 && /^EZ-\d{4}-\d{6}$/.test(doc.data?.data?.doc_ref ?? ''), doc)
    const conf = await api('/api/documents/confirm-sale', { method: 'POST', body: { doc_id: doc.data?.data?.doc_id, phone_id: p5, facture_ref: doc.data?.data?.doc_ref, prix_vente: 2500, payment_method: 'especes', warranty_start: today, warranty_expiry: '2027-03-22' } })
    const saleRow = conf.data?.data?.txn_id && (await db.query(`select device_type::text, type_operation::text from transactions where txn_id = $1`, [conf.data.data.txn_id])).rows[0]
    st = (await db.query(`select status from phones where phone_id = $1`, [p5])).rows[0].status
    check('confirm-sale: works now (telephone / vente), phone vendu', conf.status === 200 && saleRow?.device_type === 'telephone' && saleRow?.type_operation === 'vente' && st === 'vendu', { conf: conf.data, saleRow, st })
    const txnId = conf.data?.data?.txn_id
    const w1 = await api(`/api/warranty?txn_id=${txnId}`)
    const ev1 = await api('/api/warranty/events', { method: 'POST', body: { txn_id: txnId, facture_ref: doc.data?.data?.doc_ref, event_type: 'ouverture_sav' } })
    st = (await db.query(`select status from phones where phone_id = $1`, [p5])).rows[0].status
    const w2 = await api(`/api/warranty?txn_id=${txnId}`)
    const ev2 = await api('/api/warranty/events', { method: 'POST', body: { txn_id: txnId, facture_ref: doc.data?.data?.doc_ref, event_type: 'cloture_sav' } })
    const ev3 = await api('/api/warranty/events', { method: 'POST', body: { txn_id: txnId, facture_ref: doc.data?.data?.doc_ref, event_type: 'cloture_sav' } })
    check('warranty: active, SAV opens (en_reparation), closes, can\'t close twice',
      w1.data?.data?.warranty_status === 'active' && ev1.status === 200 && st === 'en_reparation' && w2.data?.data?.sav_currently_open === true && ev2.status === 200 && ev3.status === 400,
      { w1: w1.data?.data?.warranty_status, st, open: w2.data?.data?.sav_currently_open, ev: [ev1.status, ev2.status, ev3.status] })

    // ── users: new account can log in; deactivated can't
    const upw = crypto.randomBytes(10).toString('base64url')
    const uemail = `zz-e2e-new${rnd().slice(-6)}@migration.local`
    const nu = await api('/api/users', { method: 'POST', body: { email: uemail, password: upw, full_name: 'Nouveau E2E', role: 'employe', store_id: S, store_locked: true, is_active: true } })
    if (nu.data?.data?.id) created.users.push(nu.data.data.id)
    const asNew = await login(uemail, upw)
    const who = await asNew('/api/auth/session')
    await api('/api/users', { method: 'PATCH', body: { id: nu.data?.data?.id, is_active: false } })
    const denied = await login(uemail, upw)
    const deniedSession = await denied('/api/auth/session')
    check('users: created account logs in; deactivated account cannot', nu.status === 201 && who.data?.user?.email === uemail && !deniedSession.data?.user, { create: nu.status, who: who.data?.user?.email, after: deniedSession.data })

    // ── attendance, cash drop, settings
    const at = await api('/api/attendance', { method: 'POST', body: { punch_type: 'entree', store_id: S } })
    check('attendance: punch in', at.status === 201 && at.data.data.punch_type === 'entree', at)
    const cd = await api('/api/cash-drops', { method: 'POST', body: { amount: 50, reason: 'E2E', store_id: S } })
    check('cash drop: recorded', cd.status === 200 && cd.data.data.amount === 50, cd)
    await api('/api/settings', { method: 'PUT', body: { key: 'e2e_setting', store_id: S, value: 'a' } })
    const set2 = await api('/api/settings', { method: 'PUT', body: { key: 'e2e_setting', store_id: S, value: 'b' } })
    const nSet = (await db.query(`select count(*)::int n from settings where key = 'e2e_setting' and store_id = $1`, [S])).rows[0].n
    check('settings: upsert keeps one row', set2.status === 200 && set2.data.data.value === 'b' && nSet === 1, [set2.status, nSet])

    // ── categories: add, refuse deleting one in use, restore
    const cats = (await api('/api/categories')).data.accessories
    const added = await api('/api/categories', { method: 'POST', body: { type: 'accessories', categories: [...cats, { fr: 'Catégorie E2E', ar: 'تجربة' }] } })
    const inUse = await api('/api/categories', { method: 'POST', body: { type: 'accessories', categories: added.data.categories.filter(c => c.code !== 'cable') } })
    const restored = await api('/api/categories', { method: 'POST', body: { type: 'accessories', categories: cats } })
    check('categories: new code from French name, in-use delete refused, list restored',
      added.data?.categories?.some(c => c.code === 'categorie_e2e') && inUse.status === 409 && restored.status === 200 && restored.data.categories.length === cats.length,
      { added: added.status, inUse: [inUse.status, inUse.data?.error], restored: restored.status })
  },

  // Staff account: manager-only reads and writes are refused
  async roles() {
    const pw = crypto.randomBytes(12).toString('base64url')
    const { rows: [staff] } = await db.query(
      `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
       values ('zz-e2e-staffapi@migration.local', $1, 'E2E staff', 'employe', 'EZ-001', true, true) returning id`, [await bcrypt.hash(pw, 10)])
    cleanups.push(() => db.query(`delete from user_profiles where id = $1`, [staff.id]))
    const as = await login('zz-e2e-staffapi@migration.local', pw)
    const phones = await as(`/api/phones?store_id=${STORE}&limit=5`)
    check('roles: staff phone list hides purchase price + iCloud password', phones.status === 200 && phones.data.data.every(p => !('prix_achat' in p) && !('icloud_mdp' in p)), phones.data?.data?.[0])
    for (const [u, m] of [['/api/users', 'GET'], ['/api/log', 'GET'], ['/api/stores', 'GET'], ['/api/settings', 'GET'], ['/api/bzg/caisse', 'GET']]) {
      const r = await as(u, { method: m })
      check(`roles: staff refused on ${m} ${u}`, r.status === 403, r.status)
    }
    const esc = await as('/api/users', { method: 'PATCH', body: { id: staff.id, role: 'proprietaire' } })
    const { rows: [after] } = await db.query(`select role from user_profiles where id = $1`, [staff.id])
    check('roles: staff cannot promote themselves', esc.status === 403 && after.role === 'employe', esc.status)
    const dash = await as(`/api/dashboard?store_id=${STORE}&start=2026-09-01&end=2026-09-22`)
    check('roles: dashboard gives staff no purchase costs', dash.status === 200 && Object.keys(dash.data.costMap).length === 0, Object.keys(dash.data?.costMap ?? {}).length)
  },

  // A full day: open caisse, sell, expense, void, sell again, close, approve.
  async caisse() {
    // Own store so real sales of the day don't skew totals. caisse.date is unique across
    // stores, so today's real caisse (copied data) is parked on another date and restored.
    const STORE = 'E2E-001'
    const today = new Date().toISOString().slice(0, 10)
    await db.query(`insert into stores (store_id, name) values ($1, 'E2E test store')`, [STORE])
    const { rows: parked } = await db.query(`update caisse set date = '1999-01-01' where date = $1 returning caisse_id`, [today])
    cleanups.push(async () => {
      // restore the real caisse first: nothing below may prevent it
      for (const p of parked) await db.query(`update caisse set date = $1 where caisse_id = $2`, [today, p.caisse_id])
      await db.query(`delete from activity_log where store_id = $1`, [STORE])
      await db.query(`delete from stores where store_id = $1`, [STORE])
    })

    const { rows: [acc] } = await db.query(
      `insert into accessories (nom, categorie, quantite, prix_vente_recommande, store_id) values ('E2E chargeur', 'chargeurs', 5, 100, $1) returning acc_id`, [STORE])
    cleanups.push(async () => {
      await db.query(`delete from transactions where device_id = $1`, [acc.acc_id])
      await db.query(`delete from accessories where acc_id = $1`, [acc.acc_id])
      await db.query(`delete from expenses where notes = 'e2e-caisse'`)
      await db.query(`delete from caisse where date = $1 and store_id = $2`, [today, STORE])
    })
    const qty = async () => (await db.query(`select quantite from accessories where acc_id = $1`, [acc.acc_id])).rows[0].quantite

    const open = await api('/api/caisse', { method: 'POST', body: { store_id: STORE, ouverture: 100 } })
    check('caisse: open → 201, status ouverte', open.status === 201 && open.data?.data?.status === 'ouverte', open)
    const again = await api('/api/caisse', { method: 'POST', body: { store_id: STORE, ouverture: 100 } })
    check('caisse: second open refused (409)', again.status === 409, again.status)

    const sale = { store_id: STORE, device_type: 'accessoire', device_id: acc.acc_id, type_operation: 'vente', qty: 2, prix_vente: 200, payment_method: 'especes', montant_especes: 200 }
    const s1 = await api('/api/transactions', { method: 'POST', body: sale })
    check('sale: 201, prix_vente number, codes stored', s1.status === 201 && s1.data?.data?.prix_vente === 200 && s1.data?.data?.payment_method === 'especes', s1)
    check('sale: accessory stock 5 → 3', (await qty()) === 3, await qty())
    const { rows: [slog] } = await db.query(`select notes from activity_log where record_id = $1 and action_type = 'creation'`, [s1.data?.data?.txn_id])
    check('sale: log note in French', slog?.notes === `Vente — Accessoire ${acc.acc_id}`, slog)

    const bad = await api('/api/transactions', { method: 'POST', body: { ...sale, payment_method: 'نقد' } })
    check('sale: old Arabic value rejected (400)', bad.status === 400, bad)

    await api('/api/expenses', { method: 'POST', body: { montant: 12.5, categorie: 'nourriture', notes: 'e2e-caisse', store_id: STORE } })

    const live = await api(`/api/caisse?store_id=${STORE}&date=${today}`)
    const c = live.data?.data
    check('caisse live: 287.50 = 100 + 200 cash − 12.50', c?.solde_theorique === 287.5 && c?.payment_breakdown?.cash === 200 && c?.total_depenses === 12.5 && c?.nb_transactions === 1, c && { solde: c.solde_theorique, pb: c.payment_breakdown, dep: c.total_depenses, nb: c.nb_transactions })

    const list = await api(`/api/transactions?store_id=${STORE}&limit=5&with_device=1`)
    const row = list.data?.data?.find(t => t.txn_id === s1.data?.data?.txn_id)
    check('transactions list: device label + payment status code', row?.device_label === 'E2E chargeur' && row?.statut_paiement === 'solde' && row?.date_vente === today, row && { l: row.device_label, s: row.statut_paiement, d: row.date_vente })

    const v1 = await api('/api/transactions/void', { method: 'PATCH', body: { txn_id: s1.data?.data?.txn_id, voided_reason: 'e2e retour test' } })
    check('void: ok, stock back to 5', v1.status === 200 && (await qty()) === 5, v1.status)
    const v2 = await api('/api/transactions/void', { method: 'PATCH', body: { txn_id: s1.data?.data?.txn_id, voided_reason: 'e2e retour test' } })
    check('void twice: 404 and stock unchanged', v2.status === 404 && (await qty()) === 5, v2.status)

    await api('/api/transactions', { method: 'POST', body: sale })
    const eod = await api('/api/caisse', { method: 'PATCH', body: { caisse_id: open.data?.data?.caisse_id, solde_reel: 280 } })
    check('EOD submit: écart −7.50, en_attente_cloture', eod.status === 200 && eod.data?.data?.ecart === -7.5 && eod.data?.data?.status === 'en_attente_cloture', eod.data?.data && { e: eod.data.data.ecart, s: eod.data.data.status })

    const hist = await api(`/api/bzg/caisse?status=en_attente_cloture&date=${today}`)
    check('BZG history lists the pending caisse', hist.data?.data?.some(r => r.caisse_id === open.data?.data?.caisse_id), hist.status)

    const appr = await api('/api/bzg/caisse/eod', { method: 'PATCH', body: { caisse_id: open.data?.data?.caisse_id, action: 'approve' } })
    const after = await api(`/api/caisse?store_id=${STORE}&date=${today}`)
    check('approve → cloturee, frozen totals returned', appr.status === 200 && after.data?.data?.status === 'cloturee' && after.data?.data?.solde_theorique === 287.5, after.data?.data && { s: after.data.data.status, t: after.data.data.solde_theorique })
  },
}

try {
  for (const m of process.argv.slice(2)) {
    if (!MODULES[m]) throw new Error(`unknown module ${m}`)
    await MODULES[m]()
  }
} catch (err) {
  check('harness', false, err.stack)
} finally {
  for (const c of cleanups.reverse()) await c().catch(e => console.error('cleanup:', e.message))
  await db.end()
}

for (const t of results) console.log(`${t.ok ? 'PASS' : 'FAIL'}  ${t.name}${t.ok ? '' : `\n      ${t.detail}`}`)
const failed = results.filter(t => !t.ok).length
console.log(failed ? `\n${failed} failed` : `\nAll ${results.length} checks passed`)
process.exitCode = failed ? 1 : 0
