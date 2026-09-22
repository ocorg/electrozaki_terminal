// End-to-end check of login + middleware rules against a running server (default
// http://localhost:3100). Creates throwaway users in Neon and removes them.
import 'dotenv/config'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100'
const db = new pg.Client({ connectionString: process.env.DIRECT_URL })
await db.connect()

const password = crypto.randomBytes(12).toString('base64url')
const hash = await bcrypt.hash(password, 10)
const users = {
  staff:    { email: 'zz-e2e-staff@migration.local',    role: 'employe', store_id: 'EZ-001', store_locked: true,  is_active: true },
  manager:  { email: 'zz-e2e-manager@migration.local',  role: 'gerant',  store_id: null,     store_locked: false, is_active: true },
  inactive: { email: 'zz-e2e-inactive@migration.local', role: 'employe', store_id: 'EZ-001', store_locked: true,  is_active: false },
}

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

function cookieJar() {
  const jar = new Map()
  return {
    absorb(res) {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';'); const i = pair.indexOf('=')
        const k = pair.slice(0, i), v = pair.slice(i + 1)
        if (v) jar.set(k, v); else jar.delete(k)
      }
    },
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    has: (k) => jar.has(k),
  }
}

async function get(path, jar) {
  const res = await fetch(BASE + path, { redirect: 'manual', headers: jar ? { cookie: jar.header() } : {} })
  jar?.absorb(res)
  return { status: res.status, location: res.headers.get('location') ?? '' }
}

async function login(email, pw) {
  const jar = cookieJar()
  const csrfRes = await fetch(BASE + '/api/auth/csrf'); jar.absorb(csrfRes)
  const { csrfToken } = await csrfRes.json()
  const res = await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1', cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, email, password: pw, callbackUrl: BASE + '/select-store' }),
  })
  jar.absorb(res)
  const body = await res.json().catch(() => ({}))
  return { jar, url: body.url ?? '' }
}

try {
  for (const u of Object.values(users)) {
    await db.query(
      `insert into user_profiles (email, password_hash, display_name, role, store_id, store_locked, is_active)
       values ($1,$2,'E2E test',$3,$4,$5,$6)`,
      [u.email, hash, u.role, u.store_id, u.store_locked, u.is_active])
  }

  // Signed-out behaviour
  let r = await get('/ez/dashboard')
  check('signed out: /ez/dashboard → /login', r.status === 307 && r.location.endsWith('/login'), `${r.status} ${r.location}`)
  r = await get('/api/auth/session')
  check('signed out: /api/auth/session reachable', r.status === 200, String(r.status))
  const vo = await fetch(BASE + '/api/auth/verify-override', { method: 'POST', redirect: 'manual', body: '{}' })
  check('signed out: verify-override stays protected', vo.status === 307, String(vo.status))

  // Bad credentials / inactive
  let l = await login(users.staff.email, 'wrong-password')
  check('wrong password rejected', /error=CredentialsSignin/.test(l.url) && !l.jar.has('authjs.session-token'), l.url)
  l = await login(users.inactive.email, password)
  check('inactive account → code=inactive', /code=inactive/.test(l.url) && !l.jar.has('authjs.session-token'), l.url)

  // Store-locked staff
  l = await login(users.staff.email.toUpperCase(), password)
  check('staff login (email case-insensitive) sets session', l.jar.has('authjs.session-token'), l.url)
  const sessRes = await fetch(BASE + '/api/auth/session', { headers: { cookie: l.jar.header() } })
  const sess = await sessRes.json()
  const su = sess?.user ?? {}
  check('session carries claims', su.role === 'employe' && su.store_id === 'EZ-001' && su.store_locked === true && !('password_hash' in su), JSON.stringify(sess))
  r = await get('/ez/dashboard', l.jar)
  check('staff: /ez/dashboard allowed', r.status === 200, `${r.status} ${r.location}`)
  r = await get('/bzg/dashboard', l.jar)
  check('staff: /bzg → /ez/dashboard (store lock)', r.status === 307 && r.location.endsWith('/ez/dashboard'), `${r.status} ${r.location}`)
  r = await get('/login', l.jar)
  check('staff: /login → /select-store', r.status === 307 && r.location.endsWith('/select-store'), `${r.status} ${r.location}`)

  // Manager
  l = await login(users.manager.email, password)
  r = await get('/bzg/dashboard', l.jar)
  check('manager: /bzg/dashboard allowed', r.status === 200, `${r.status} ${r.location}`)
  r = await get('/ez/dashboard', l.jar)
  check('manager: /ez/dashboard allowed', r.status === 200, `${r.status} ${r.location}`)

  // Deactivation after login is picked up by getActiveUser()-style checks; the
  // JWT itself refreshes within 5 min — not asserted here.
} finally {
  await db.query(`delete from user_profiles where email like 'zz-e2e-%@migration.local'`)
  await db.end()
}

for (const t of results) console.log(`${t.ok ? 'PASS' : 'FAIL'}  ${t.name}${t.ok ? '' : `  [${t.detail}]`}`)
const failed = results.filter(t => !t.ok).length
console.log(failed ? `\n${failed} failed` : `\nAll ${results.length} checks passed`)
process.exitCode = failed ? 1 : 0
