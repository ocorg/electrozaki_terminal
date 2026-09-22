// Copies all public-schema data from Supabase (SUPABASE_DB_URL) into Neon (DIRECT_URL).
// Re-runnable: target tables are truncated first, so run it again right before
// cut-over to pick up everything written since the last copy.
// Runs in one transaction on Neon — any failure leaves Neon unchanged.
//
//   node scripts/copy-supabase-to-neon.mjs
import 'dotenv/config'
import pg from 'pg'

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

async function copyTable(table) {
  const columns = await insertableColumns(table)
  const extra = EXTRA_SELECT[table]
  const selectList = columns.map((c) => `${extra?.columns[c] ?? `t."${c}"`} as "${c}"`).join(', ')
  const { rows } = await src.query(`select ${selectList} from ${extra?.from ?? `public."${table}" t`}`)

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
  return rows.length
}

await src.connect()
await dst.connect()
try {
  const tables = await tablesInFkOrder()
  await dst.query('begin')
  await dst.query(`truncate ${tables.map((t) => `public."${t}"`).join(', ')} restart identity cascade`)
  for (const t of tables) await dst.query(`alter table public."${t}" disable trigger user`)

  const copied = {}
  for (const t of tables) copied[t] = await copyTable(t)

  for (const t of tables) await dst.query(`alter table public."${t}" enable trigger user`)

  const { rows: seqs } = await src.query(`select sequencename, last_value from pg_sequences where schemaname = 'public'`)
  for (const s of seqs) {
    if (s.last_value === null) continue // never used: keep Neon's fresh sequence
    await dst.query(`select setval($1, $2, true)`, [`public."${s.sequencename}"`, s.last_value])
  }

  const mismatches = []
  for (const t of tables) {
    const { rows: [{ n }] } = await dst.query(`select count(*)::int n from public."${t}"`)
    const { rows: [{ n: expected }] } = await src.query(`select count(*)::int n from public."${t}"`)
    if (n !== expected) mismatches.push(`${t}: neon ${n} vs supabase ${expected}`)
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
