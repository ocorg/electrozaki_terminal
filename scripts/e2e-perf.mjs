// Real-browser navigation timing: logs in through the UI, clicks through the
// store screens twice (first visit, then revisit) and reports, per screen, the
// time until it is ready (no spinners/skeletons, no pending API calls), the
// number of API calls made, and any JavaScript errors.
//   E2E_BASE=https://electrozakiterminal.vercel.app node scripts/e2e-perf.mjs
import 'dotenv/config'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100'
const ROUTES = [
  '/ez/dashboard', '/ez/pos', '/ez/stock/phones', '/ez/stock/accessories', '/ez/caisse',
  '/ez/clients', '/ez/repairs', '/ez/expenses', '/ez/credits', '/ez/suppliers', '/ez/prospects',
  '/ez/deliveries', '/ez/movements', '/ez/documents', '/ez/stock/laptops',
]

const db = new pg.Client({ connectionString: process.env.DIRECT_URL })
await db.connect()
const password = crypto.randomBytes(12).toString('base64url')
const email = 'zz-e2e-browser@migration.local'
const { rows: [me] } = await db.query(
  `insert into user_profiles (email, password_hash, display_name, role, is_active) values ($1, $2, 'E2E navigateur', 'gerant', true) returning id`,
  [email, await bcrypt.hash(password, 10)])

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const pending = new Set()
  let apiCalls = 0
  const errors = []
  page.on('request', r => { if (r.url().includes('/api/') && !r.url().includes('/api/auth/')) { pending.add(r); apiCalls++ } })
  // E2E_DEBUG=1: list every request of each screen with its duration
  const trace = []
  page.on('requestfinished', async r => {
    pending.delete(r)
    if (process.env.E2E_DEBUG && new URL(r.url()).origin === new URL(BASE).origin) {
      const t = r.timing()
      const size = (await r.sizes().catch(() => null))?.responseBodySize ?? 0
      trace.push(`    ${Math.round(t.responseEnd).toString().padStart(5)} ms ${(size / 1024).toFixed(0).padStart(5)} KB  ${r.url().replace(BASE, '').slice(0, 110)}`)
    }
  })
  page.on('requestfailed', r => pending.delete(r))
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  // Ready = no pending API calls and no loading indicators, stable for 300 ms
  async function waitReady(t0) {
    let stableSince = null
    while (performance.now() - t0 < 20000) {
      const busy = pending.size > 0 || await page.locator('.animate-spin:visible, .animate-pulse:visible').count() > 0
      if (!busy) { stableSince ??= performance.now(); if (performance.now() - stableSince >= 300) return stableSince - t0 }
      else stableSince = null
      await page.waitForTimeout(40)
    }
    return NaN
  }

  await page.goto(BASE + '/login')
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForURL(/select-store|dashboard/, { timeout: 20000 })
  await page.goto(BASE + '/ez/dashboard')
  await waitReady(performance.now())

  const results = {}
  for (const round of ['first', 'revisit']) {
    for (const route of ROUTES) {
      errors.length = 0
      apiCalls = 0
      trace.length = 0
      const t0 = performance.now()
      const link = page.locator(`a[href="${route}"]`)
      if (await link.count()) await link.first().click()
      else await page.goto(BASE + route)
      await page.waitForURL(`**${route}`, { timeout: 20000 })
      const ms = await waitReady(t0)
      results[route] ??= {}
      results[route][round] = { ms: Math.round(ms), calls: apiCalls, errors: [...new Set(errors)].slice(0, 2) }
      if (process.env.E2E_DEBUG) console.log(`${round} ${route} ${Math.round(ms)} ms
${trace.join('\n')}`)
    }
  }

  console.log('screen'.padEnd(24), 'first visit'.padStart(16), 'revisit'.padStart(16))
  let tf = 0, tr = 0
  for (const [route, r] of Object.entries(results)) {
    tf += r.first.ms; tr += r.revisit.ms
    const cell = x => `${x.ms} ms / ${x.calls} req`.padStart(16)
    console.log(route.padEnd(24), cell(r.first), cell(r.revisit), [...r.first.errors, ...r.revisit.errors].length ? '  ⚠ ' + [...r.first.errors, ...r.revisit.errors][0].slice(0, 90) : '')
  }
  console.log('TOTAL'.padEnd(24), `${tf} ms`.padStart(16), `${tr} ms`.padStart(16))
} finally {
  await browser.close()
  await db.query('delete from activity_log where user_id = $1', [me.id])
  await db.query('delete from user_profiles where id = $1', [me.id])
  await db.end()
}
