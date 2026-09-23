// Live-refresh checks against a running server (default http://localhost:3100):
// a change event refreshes only the affected data on open screens, and an idle
// screen refreshes itself. Sends events directly to Pusher; no data is modified.
//   node --env-file=.env scripts/e2e-live.mjs [--idle]
import { chromium } from 'playwright'
import Pusher from 'pusher'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100'
const pusher = new Pusher({ appId: process.env.PUSHER_APP_ID, key: process.env.PUSHER_KEY, secret: process.env.PUSHER_SECRET, cluster: process.env.PUSHER_CLUSTER, useTLS: true })
const db = new pg.Client({ connectionString: process.env.DIRECT_URL })
await db.connect()
const email = 'zz-e2e-live@migration.local'
const password = crypto.randomBytes(12).toString('base64url')
await db.query('delete from user_profiles where email = $1', [email])
await db.query(`insert into user_profiles (email, password_hash, display_name, role, is_active) values ($1, $2, 'E2E live', 'gerant', true)`, [email, await bcrypt.hash(password, 10)])

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })
const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  const login = await context.newPage()
  await login.goto(BASE + '/login')
  await login.fill('input[type=email]', email)
  await login.fill('input[type=password]', password)
  await login.click('button[type=submit]')
  await login.waitForURL(/select-store|dashboard/)
  await login.close()

  // Two "devices": the phones screen and the POS
  const open = async route => {
    const page = await context.newPage()
    const calls = []
    page.on('request', r => { if (r.url().includes('/api/') && !r.url().includes('/api/auth/')) calls.push(new URL(r.url()).pathname + new URL(r.url()).search) })
    await page.goto(BASE + route)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(4000) // background prefetch settles
    return { page, calls }
  }
  const phones = await open('/ez/stock/phones')
  const pos    = await open('/ez/pos')

  // Nothing refetches on its own while nothing changes
  phones.calls.length = 0; pos.calls.length = 0
  await pos.page.waitForTimeout(3000)
  check('quiet: no requests while nothing changes', phones.calls.length + pos.calls.length === 0, [...phones.calls, ...pos.calls])

  // A phone changed somewhere: both screens refresh their phone lists only
  await pusher.trigger('erp', 'changed', { store_id: 'EZ-001', entities: ['phones'] })
  await pos.page.waitForTimeout(2500)
  check('phones event: phones screen refetches its list', phones.calls.some(c => c.startsWith('/api/phones?store_id=')), phones.calls)
  check('phones event: POS refetches available stock', pos.calls.some(c => c.startsWith('/api/phones?status=disponible')), pos.calls)
  check('phones event: unrelated data untouched', ![...phones.calls, ...pos.calls].some(c => c.startsWith('/api/clients') || c.startsWith('/api/accessories')), [...phones.calls, ...pos.calls])

  // A client changed: POS refreshes clients, the phones screen does nothing
  phones.calls.length = 0; pos.calls.length = 0
  await pusher.trigger('erp', 'changed', { store_id: 'EZ-001', entities: ['clients'] })
  await pos.page.waitForTimeout(2500)
  check('clients event: POS refetches clients', pos.calls.some(c => c.startsWith('/api/clients')), pos.calls)
  check('clients event: phones screen stays quiet', phones.calls.length === 0, phones.calls)

  // Revisit after a change while the screen was closed: cached data at once, refreshed behind it
  await pos.page.goto(BASE + '/ez/clients')
  await pos.page.waitForTimeout(1500)
  pos.calls.length = 0
  await pusher.trigger('erp', 'changed', { store_id: 'EZ-001', entities: ['accessories'] })
  await pos.page.waitForTimeout(1500)
  const t0 = Date.now()
  await pos.page.locator('a[href="/ez/pos"]').first().click()
  await pos.page.waitForURL('**/ez/pos')
  await pos.page.waitForTimeout(2000)
  check('stale revisit: accessories refetched in the background', pos.calls.some(c => c.startsWith('/api/accessories')), pos.calls)
  check('stale revisit: screen shown without waiting', Date.now() - t0 < 5000)

  if (process.argv.includes('--idle')) {
    // No activity for over 2 minutes: the visible screen refreshes itself
    phones.calls.length = 0
    await phones.page.bringToFront()
    await phones.page.waitForTimeout(165_000)
    check('idle: screen refreshes after 2 min without activity', phones.calls.some(c => c.startsWith('/api/phones')), phones.calls)
  }
} finally {
  await browser.close()
  await db.query('delete from user_profiles where email = $1', [email])
  await db.end()
}
for (const r of results) console.log(r.ok ? 'PASS ' : 'FAIL ', r.name, r.ok ? '' : JSON.stringify(r.detail).slice(0, 300))
const failed = results.filter(r => !r.ok).length
console.log(failed ? `${failed} of ${results.length} checks failed` : `All ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
