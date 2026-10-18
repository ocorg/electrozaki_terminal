// End-to-end checks of the 40 × 30 mm labels (phone label, parcel label) in a
// real browser, against a running ERP dev server (default http://localhost:3100)
// whose env points at a TEST branch (DIRECT_URL). Saves the images in SHOTS.
//
// What a Phomemo printer needs (2026-10-13): 960 × 720 px = 3 px per printer
// dot, pure black and white, nothing on the edge, a QR that still reads once
// reduced to the printer's 320 × 240 dots.
//
//   SHOTS=<folder> node scripts/e2e-labels.mjs
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { chromium } from 'playwright'
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader'
import { createRequire } from 'node:module'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100', STORE = 'EZ-001'
const OUT = process.env.SHOTS ?? 'e2e-labels-out'
const url = process.env.DIRECT_URL
if (!url) { console.error('DIRECT_URL is not set'); process.exit(1) }
if (/ep-royal-cloud-b130i960|ep-still-tree-b1u5yng9/.test(url)) { console.error('DIRECT_URL points at PRODUCTION — use a Neon test branch'); process.exit(1) }
fs.mkdirSync(OUT, { recursive: true })
const require = createRequire(import.meta.url)
prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) } })
const decode = async buf => (await readBarcodes(new Uint8Array(buf), { formats: ['QRCode'], tryHarder: true }))[0]?.text ?? null

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 300) })
const db = new pg.Client({ connectionString: url }); await db.connect()
const email = 'zz-e2e-labels@migration.local', password = crypto.randomBytes(12).toString('base64url')
await db.query(`delete from user_profiles where email = $1`, [email])
const { rows: [u] } = await db.query(`insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active) values ($1,$2,'E2E labels','proprietaire',$3,true,true) returning id`, [email, await bcrypt.hash(password, 10), STORE])
const jar = new Map(); const absorb = r => { for (const c of r.headers.getSetCookie()) { const [p] = c.split(';'); const i = p.indexOf('='); jar.set(p.slice(0, i), p.slice(i + 1)) } }
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
const csrf = await fetch(BASE + '/api/auth/csrf'); absorb(csrf); const { csrfToken } = await csrf.json()
absorb(await fetch(BASE + '/api/auth/callback/credentials', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1', cookie: cookie() }, body: new URLSearchParams({ csrfToken, email, password }) }))
const api = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { cookie: cookie(), 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, data: (await r.json()).data } }

const { rows: [phone] } = await db.query(`select phone_id, status::text, prix_vente_recommande from phones where store_id = $1 and not is_deleted and status = 'disponible' and prix_vente_recommande > 500 limit 1`, [STORE])
const { rows: [acc] } = await db.query(`select acc_id, quantite from accessories where store_id = $1 and not is_deleted and quantite > 5 and categorie <> 'service' limit 1`, [STORE])
let deliveryId = null
const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  const goto = async p => { await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 180000 }).catch(() => {}); await page.waitForTimeout(2500) }
  const download = async label => {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.locator('[role=dialog] button', { hasText: new RegExp(`^${label}$`) }).click()])
    const file = path.join(OUT, d.suggestedFilename()); await d.saveAs(file); return file
  }
  // the printer's view: 320 × 240 dots, black or white; and the image's own facts
  const inspect = file => page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const x = c.getContext('2d'); x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, img.width, img.height).data
    let grey = 0, black = 0, edge = 0
    for (let y = 0; y < img.height; y++) for (let i = 0; i < img.width; i++) {
      const v = d[(y * img.width + i) * 4]
      if (v !== 0 && v !== 255) grey++
      if (v === 0) { black++; if (i < 4 || y < 4 || i >= img.width - 4 || y >= img.height - 4) edge++ }
    }
    const s = document.createElement('canvas'); s.width = 320; s.height = 240
    const sx = s.getContext('2d'); sx.drawImage(img, 0, 0, 320, 240)
    const im = sx.getImageData(0, 0, 320, 240)
    for (let i = 0; i < im.data.length; i += 4) { const v = im.data[i] < 128 ? 0 : 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v }
    sx.putImageData(im, 0, 0)
    return { w: img.width, h: img.height, grey, edge, black: black / (img.width * img.height), dots: s.toDataURL('image/png').split(',')[1] }
  }, fs.readFileSync(file).toString('base64'))
  const pdfSize = file => {
    const box = (fs.readFileSync(file, 'latin1').match(/\/MediaBox\s*\[([^\]]+)\]/) || [])[1]?.trim().split(/\s+/).map(Number) ?? []
    return [box[2] * 25.4 / 72, box[3] * 25.4 / 72].map(v => Math.round(v * 10) / 10)
  }

  // ── Phone label ──
  await goto('/ez/stock/phones')
  await page.waitForSelector('button[title="Générer étiquette"]:visible', { timeout: 180000 })
  await page.locator('button[title="Générer étiquette"]:visible').first().click()
  await page.waitForSelector('[role=dialog] canvas'); await page.waitForTimeout(1500)
  await page.locator('[role=dialog] canvas').screenshot({ path: path.join(OUT, 'phone-label-preview.png') })
  const png = await download('PNG')
  const info = await inspect(png)
  const phoneId = path.basename(png).replace(/^label-|\.png$/g, '')
  const { rows: [ph] } = await db.query(`select imei, phone_id from phones where phone_id = $1`, [phoneId])
  check('phone label: 960 × 720, black and white, nothing on the edge', info.w === 960 && info.h === 720 && info.grey === 0 && info.edge === 0, info)
  check('phone label: its QR reads at printer resolution', (await decode(Buffer.from(info.dots, 'base64'))) === (ph.imei || ph.phone_id))
  const pdf = await download('PDF')
  check('phone label: the PDF is 40 × 30 mm', pdfSize(pdf).join('×') === '40×30', pdfSize(pdf))
  await page.keyboard.press('Escape')

  // ── Parcel label ──
  const o = await api('/api/deliveries/order', { store_id: STORE, client: { nom: 'Karim Benali', telephone: '0661234567' }, adresse: '12 rue Atlas, quartier Narjiss, appartement 4', ville: 'Fès', transporteur: 'Amana', frais_livraison: 30, frais_charge: 'client', avance: 300, avance_ref: 'VIR-1',
    items: [{ device_type: 'telephone', device_id: phone.phone_id, qty: 1, prix_vente: Number(phone.prix_vente_recommande) }, { device_type: 'accessoire', device_id: acc.acc_id, qty: 1, prix_vente: 100 }] })
  deliveryId = o.data?.delivery_id
  check('an order to label', o.status === 201, o)
  await goto('/ez/deliveries')
  await page.waitForSelector(`text=${deliveryId}`, { timeout: 60000 })
  // the card itself: the innermost block holding both the order number and a label button
  await page.locator('div', { hasText: deliveryId }).filter({ has: page.getByRole('button', { name: 'Étiquette' }) }).last().getByRole('button', { name: 'Étiquette' }).click()
  await page.waitForSelector('[role=dialog] canvas'); await page.waitForTimeout(1500)
  await page.locator('[role=dialog] canvas').screenshot({ path: path.join(OUT, 'parcel-label-preview.png') })
  const ppng = await download('PNG')
  const pinfo = await inspect(ppng)
  fs.writeFileSync(path.join(OUT, 'parcel-label-320x240.png'), Buffer.from(pinfo.dots, 'base64'))
  check('parcel label: 960 × 720, black and white, nothing on the edge', pinfo.w === 960 && pinfo.h === 720 && pinfo.grey === 0 && pinfo.edge === 0, pinfo)
  check('parcel label: named after the order', path.basename(ppng) === `livraison-${deliveryId}.png`, path.basename(ppng))
  check('parcel label: not empty', pinfo.black > 0.08 && pinfo.black < 0.6, pinfo.black)
  const ppdf = await download('PDF')
  check('parcel label: the PDF is 40 × 30 mm', pdfSize(ppdf).join('×') === '40×30', pdfSize(ppdf))
  check('no browser errors', errors.length === 0, errors.join(' | '))
  if (errors.length) console.log(errors)
} catch (err) {
  check('script ran to the end', false, String(err?.stack ?? err))
} finally {
  await browser.close()
  if (deliveryId) {
    await db.query(`delete from delivery_items where delivery_id = $1`, [deliveryId])
    await db.query(`delete from deliveries where delivery_id = $1`, [deliveryId])
  }
  await db.query(`update phones set status = $2, updated_by = null where phone_id = $1`, [phone.phone_id, phone.status])
  await db.query(`update accessories set quantite = $2, updated_by = null where acc_id = $1`, [acc.acc_id, acc.quantite])
  await db.query(`delete from clients where created_by = $1`, [u.id])
  await db.query(`delete from activity_log where user_id = $1`, [u.id]); await db.query(`delete from user_profiles where id = $1`, [u.id])
  await db.end()
}
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  → ${r.detail}`}`)
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
