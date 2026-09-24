// Phone-size (390×844) screenshots of ERP screens, for UI checks — TEST branch only.
// Needs a dev server on :3100 pointed at the test branch (see memory: test branches).
//   MSYS_NO_PATHCONV=1 DIRECT_URL=<test> SHOTS=<dir> PAGES=/ez/pos,/ez/stock/phones node scripts/ui-shots.mjs
// Options: WAIT=ms (default 2500), FULL=1, CLICK=<css selector> (extra shot -2), SCROLL=px (extra shot -3).
// Creates a temporary owner account and deletes it at the end.
import 'dotenv/config'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { chromium } from 'playwright'

const BASE = 'http://localhost:3100'
const OUT = process.env.SHOTS
const url = process.env.DIRECT_URL
if (!url || /ep-royal-cloud|ep-still-tree/.test(url)) { console.error('test branch only'); process.exit(1) }
const pages = (process.env.PAGES ?? '/ez/dashboard').split(',')

const db = new pg.Client({ connectionString: url }); await db.connect()
const email = 'zz-ui-audit@migration.local'
const password = crypto.randomBytes(12).toString('base64url')
const cleanup = async () => {
  const { rows } = await db.query(`select id from user_profiles where email = $1`, [email])
  for (const r of rows) {
    await db.query(`delete from activity_log where user_id = $1`, [r.id])
    await db.query(`delete from staff_attendance where user_id = $1`, [r.id]).catch(() => {})
    await db.query(`delete from user_profiles where id = $1`, [r.id])
  }
}
await cleanup()
await db.query(`insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
                values ($1, $2, 'Audit UI', 'proprietaire', 'EZ-001', true, true)`, [email, await bcrypt.hash(password, 10)])

const jar = new Map()
const absorb = res => { for (const c of res.headers.getSetCookie()) { const [p] = c.split(';'); const i = p.indexOf('='); jar.set(p.slice(0, i), p.slice(i + 1)) } }
const csrf = await fetch(BASE + '/api/auth/csrf'); absorb(csrf)
const { csrfToken } = await csrf.json()
absorb(await fetch(BASE + '/api/auth/callback/credentials', {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
  body: new URLSearchParams({ csrfToken, email, password }),
}))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'fr-FR' })
await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })))
const page = await ctx.newPage()
page.on('console', m => { if (m.type() === 'error') console.log('  console.error:', m.text().slice(0, 300)) })
page.on('pageerror', e => console.log('  pageerror:', String(e).slice(0, 300)))
try {
  for (const p of pages) {
    await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {})
    await page.waitForTimeout(Number(process.env.WAIT ?? 2500))
    const name = p.replace(/\//g, '_').replace(/^_/, '')
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: process.env.FULL === '1' })
    if (process.env.CLICK) {
      await page.locator(process.env.CLICK).first().click().catch(e => console.log('  click failed', String(e).slice(0, 120)))
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/${name}-2.png` })
    }
    if (process.env.SCROLL) {
      await page.evaluate(y => { for (const el of document.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY.match(/auto|scroll/)) el.scrollTop = Number(y) }, process.env.SCROLL)
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${OUT}/${name}-3.png` })
    }
    console.log('shot', p, page.url().replace(BASE, ''))
  }
} finally {
  await browser.close()
  await cleanup()
  await db.end()
}
