// Copies all public-schema data from Supabase (SUPABASE_DB_URL) into Neon (DIRECT_URL),
// translating stored values (Arabic / English / accented French) into the French
// codes used by the Neon schema, and category names into rows of `categories`.
// Re-runnable: target tables are truncated first, so run it again right before
// cut-over to pick up everything written since the last copy.
// Runs in one transaction on Neon — any failure leaves Neon unchanged. Any value
// without a translation aborts the copy and is listed.
//
//   node scripts/copy-supabase-to-neon.mjs
import 'dotenv/config'
import pg from 'pg'
import { LEGACY, COLUMN_DOMAINS, CATEGORY_COLUMNS, EXTRA_CATEGORIES, MODULE_TABLES, SNAPSHOT_FIELDS } from './legacy-codes.mjs'
import { CODES, toCode } from '../src/lib/codes.ts'

const { Client, types } = pg

// Keep dates/timestamps/json as raw text so values round-trip byte-for-byte
// (no JS Date timezone shifts, no JSON re-serialisation).
for (const oid of [1082, 1083, 1114, 1184, 1266, 1186, 114, 3802]) types.setTypeParser(oid, (v) => v)

const source = process.env.SUPABASE_DB_URL
const target = process.env.DIRECT_URL
if (!source?.includes('supabase')) throw new Error('SUPABASE_DB_URL must point at Supabase')
if (!target?.includes('neon.tech')) throw new Error('DIRECT_URL must point at Neon')

const src = new Client({
  connectionString: source.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false }, // Supabase pooler uses its own CA
})
const dst = new Client({ connectionString: target })

// Columns that exist only on the Neon side, filled from auth.users.
const EXTRA_SELECT = {
  user_profiles: {
    from: 'public.user_profiles t join auth.users u on u.id = t.id',
    columns: { email: 'u.email', password_hash: 'u.encrypted_password' },
  },
}
// Neon-only surrogate keys, left to their defaults.
const SKIP_COLUMNS = { settings: ['id'] }

// The category lists move out of `settings` into the `categories` table.
const CATEGORY_SETTINGS_KEYS = Object.values(CATEGORY_COLUMNS).map((c) => c.settingsKey)
const SOURCE_WHERE = { settings: `t.key not in (${CATEGORY_SETTINGS_KEYS.map((k) => `'${k}'`).join(', ')})` }

const unknown = new Map()
const noteUnknown = (what) => unknown.set(what, (unknown.get(what) ?? 0) + 1)

async function tablesInFkOrder() {
  const { rows: tables } = await dst.query(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'`,
  )
  const { rows: fks } = await dst.query(`
    select distinct c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
    from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and c.conrelid <> c.confrelid`)
  const pending = new Set(tables.map((t) => t.tablename))
  const ordered = []
  while (pending.size) {
    const ready = [...pending].filter((t) => !fks.some((f) => f.child === t && pending.has(f.parent)))
    if (!ready.length) throw new Error(`FK cycle among: ${[...pending].join(', ')}`)
    for (const t of ready.sort()) { ordered.push(t); pending.delete(t) }
  }
  return ordered
}

async function insertableColumns(table) {
  const { rows } = await dst.query(
    `select attname from pg_attribute
     where attrelid = $1::regclass and attnum > 0 and not attisdropped and attgenerated = ''
     order by attnum`,
    [`public."${table}"`],
  )
  return rows.map((r) => r.attname).filter((c) => !(SKIP_COLUMNS[table] ?? []).includes(c))
}

// ── categories ─────────────────────────────────────────
// Built from the Settings lists ({fr, ar}); code = slug of the French name.
async function buildCategories() {
  const { rows } = await src.query(
    `select key, value from public.settings where key = any($1) and store_id is null`, [CATEGORY_SETTINGS_KEYS])
  const categories = []
  for (const { type, settingsKey } of Object.values(CATEGORY_COLUMNS)) {
    let list = []
    try { list = JSON.parse(rows.find((r) => r.key === settingsKey)?.value ?? '[]') } catch {}
    list = list.map((it) => (typeof it === 'string' ? { fr: it, ar: it } : it))
    list.push(...EXTRA_CATEGORIES.filter((e) => e.type === type))
    list.forEach((it, i) => categories.push({ code: toCode(it.fr), type, label_fr: it.fr, label_ar: it.ar, sort_order: i }))
  }
  const dup = categories.map((c) => c.code).filter((c, i, all) => all.indexOf(c) !== i)
  if (dup.length) throw new Error(`duplicate category codes: ${dup.join(', ')}`)

  const lookup = {}
  for (const c of categories) {
    lookup[c.type] ??= new Map()
    for (const name of [c.label_ar, c.label_fr, c.code]) lookup[c.type].set(name, c.code)
  }
  return { categories, lookup }
}

function makeTranslator(categoryLookup, categories) {
  const allTables = [...new Set(Object.keys(COLUMN_DOMAINS).concat(Object.keys(CATEGORY_COLUMNS)).map((k) => k.split('.')[0]))]

  function translateValue(table, column, value, strict) {
    if (value === null || value === undefined) return value
    const domain = COLUMN_DOMAINS[`${table}.${column}`]
    if (domain) {
      const code = LEGACY[domain][value]
      if (code) return code
      if (strict) noteUnknown(`${table}.${column} = ${JSON.stringify(value)}`)
      return value
    }
    const cat = CATEGORY_COLUMNS[`${table}.${column}`]
    if (cat) {
      if (value === '') return null
      const code = categoryLookup[cat.type]?.get(value)
      if (code) return code
      if (strict) noteUnknown(`${table}.${column} = ${JSON.stringify(value)}`)
    }
    return value
  }

  // activity_log snapshots: translate fields whose name matches a coded column
  // of the tables the (legacy) module writes to, then fields that mean the
  // same thing everywhere. Nested objects/arrays are walked. Free text is left untouched.
  function translateSnapshot(json, legacyModule) {
    if (!json) return json
    const tables = MODULE_TABLES[legacyModule] ?? allTables
    const fix = (node) => {
      if (Array.isArray(node)) return node.map(fix)
      if (!node || typeof node !== 'object') return node
      for (const [key, val] of Object.entries(node)) {
        if (typeof val !== 'string') { node[key] = fix(val); continue }
        let out = val
        for (const t of tables) {
          out = translateValue(t, key, val, false)
          if (out !== val) break
        }
        if (out === val && SNAPSHOT_FIELDS[key]) out = LEGACY[SNAPSHOT_FIELDS[key]][val] ?? val
        node[key] = out
      }
      return node
    }
    return JSON.stringify(fix(JSON.parse(json)))
  }

  // Sentences the old app composed from Arabic values → same sentence in French.
  const categoryLabelFr = new Map(categories.map((c) => [c.code, c.label_fr]))
  const labelFr = (domain, legacy) => CODES[domain][LEGACY[domain][legacy]]?.fr
  function translateNote(note) {
    if (!note) return note
    let m = note.match(/^(\S+) — (\S+) (\S+)$/)
    if (m && labelFr('operation_type', m[1]) && labelFr('device_type', m[2])) {
      return `${labelFr('operation_type', m[1])} — ${labelFr('device_type', m[2])} ${m[3]}`
    }
    m = note.match(/^(.+) — ([\d.,]+ MAD)$/)
    const expenseCode = m && categoryLookup.depense?.get(m[1])
    if (expenseCode) return `${categoryLabelFr.get(expenseCode)} — ${m[2]}`
    return note
  }

  return (table, row, columns) => {
    if (table === 'activity_log') {
      row.before_state = translateSnapshot(row.before_state, row.module)
      row.after_state = translateSnapshot(row.after_state, row.module)
      row.notes = translateNote(row.notes)
    }
    for (const c of columns) row[c] = translateValue(table, c, row[c], true)
    return row
  }
}

async function insertRows(table, columns, rows) {
  const BATCH = 200
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const params = []
    const tuples = chunk.map((row) => {
      const ph = columns.map((c) => { params.push(row[c]); return `$${params.length}` })
      return `(${ph.join(', ')})`
    })
    await dst.query(`insert into public."${table}" (${columns.map((c) => `"${c}"`).join(', ')}) values ${tuples.join(', ')}`, params)
  }
}

async function copyTable(table, translate) {
  const columns = await insertableColumns(table)
  const extra = EXTRA_SELECT[table]
  const selectList = columns.map((c) => `${extra?.columns[c] ?? `t."${c}"`} as "${c}"`).join(', ')
  const where = SOURCE_WHERE[table] ? ` where ${SOURCE_WHERE[table]}` : ''
  const { rows } = await src.query(`select ${selectList} from ${extra?.from ?? `public."${table}" t`}${where}`)
  await insertRows(table, columns, rows.map((row) => translate(table, row, columns)))
  return rows.length
}

await src.connect()
await dst.connect()
try {
  const tables = await tablesInFkOrder()
  const { categories, lookup } = await buildCategories()
  const translate = makeTranslator(lookup, categories)

  await dst.query('begin')
  await dst.query(`truncate ${tables.map((t) => `public."${t}"`).join(', ')} restart identity cascade`)
  for (const t of tables) await dst.query(`alter table public."${t}" disable trigger user`)

  const copied = {}
  for (const t of tables) {
    if (t === 'categories') {
      await insertRows(t, ['code', 'type', 'label_fr', 'label_ar', 'sort_order'], categories)
      copied[t] = categories.length
    } else {
      copied[t] = await copyTable(t, translate)
    }
  }
  if (unknown.size) {
    throw new Error(`values with no code (add them to scripts/legacy-codes.mjs):\n  ${
      [...unknown].map(([v, n]) => `${v}  ×${n}`).join('\n  ')}`)
  }

  for (const t of tables) await dst.query(`alter table public."${t}" enable trigger user`)

  const { rows: seqs } = await src.query(`select sequencename, last_value from pg_sequences where schemaname = 'public'`)
  for (const s of seqs) {
    if (s.last_value === null) continue // never used: keep Neon's fresh sequence
    await dst.query(`select setval($1, $2, true)`, [`public."${s.sequencename}"`, s.last_value])
  }

  const mismatches = []
  for (const t of tables) {
    const { rows: [{ n }] } = await dst.query(`select count(*)::int n from public."${t}"`)
    let expected = copied[t]
    if (t !== 'categories') {
      const where = SOURCE_WHERE[t] ? ` t where ${SOURCE_WHERE[t]}` : ''
      expected = (await src.query(`select count(*)::int n from public."${t}"${where}`)).rows[0].n
    }
    if (n !== expected) mismatches.push(`${t}: neon ${n} vs expected ${expected}`)
  }
  if (mismatches.length) throw new Error(`row count mismatch → ${mismatches.join('; ')}`)

  await dst.query('commit')
  const total = Object.values(copied).reduce((a, b) => a + b, 0)
  for (const [t, n] of Object.entries(copied)) if (n) console.log(`${t.padEnd(26)} ${n}`)
  console.log(`\n${total} rows across ${tables.length} tables, ${seqs.length} sequences synced. Counts verified.`)
} catch (err) {
  await dst.query('rollback').catch(() => {})
  console.error('Copy failed, Neon left unchanged:', err.message)
  process.exitCode = 1
} finally {
  await src.end()
  await dst.end()
}
