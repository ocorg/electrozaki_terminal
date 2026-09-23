// Copies every row from one Postgres database to another with the same schema
// (used to move production from Neon us-east-2 to Neon Frankfurt).
// Target tables are truncated first; runs in one transaction on the target, so
// any failure leaves it unchanged. Sequences are synced and every table is
// verified by row count and a checksum of all its values.
//
//   SOURCE_URL=<old direct url> TARGET_URL=<new direct url> node scripts/copy-neon-to-neon.mjs
import 'dotenv/config'
import pg from 'pg'

const { Client, types } = pg
// Raw text for dates/timestamps/json so values round-trip byte-for-byte
for (const oid of [1082, 1083, 1114, 1184, 1266, 1186, 114, 3802]) types.setTypeParser(oid, (v) => v)

const source = process.env.SOURCE_URL
const target = process.env.TARGET_URL
if (!source || !target) throw new Error('SOURCE_URL and TARGET_URL are required')
if (source === target) throw new Error('SOURCE_URL and TARGET_URL are the same database')

const src = new Client({ connectionString: source })
const dst = new Client({ connectionString: target })

async function tablesInFkOrder(c) {
  const { rows: tables } = await c.query(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'`)
  const { rows: fks } = await c.query(`
    select distinct c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
    from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.conrelid <> c.confrelid`)
  const pending = new Set(tables.map((t) => t.tablename))
  const ordered = []
  while (pending.size) {
    const ready = [...pending].filter((t) => !fks.some((f) => f.child === t && pending.has(f.parent)))
    if (!ready.length) throw new Error(`FK cycle among: ${[...pending].join(', ')}`)
    for (const t of ready.sort()) { ordered.push(t); pending.delete(t) }
  }
  return ordered
}

// Non-generated columns, in table order
async function columns(c, table) {
  const { rows } = await c.query(`select attname from pg_attribute
    where attrelid = $1::regclass and attnum > 0 and not attisdropped and attgenerated = '' order by attnum`, [`public."${table}"`])
  return rows.map((r) => r.attname)
}

const checksum = async (c, table, cols) => (await c.query(
  `select md5(coalesce(string_agg(concat_ws('|', ${cols.map((x) => `"${x}"::text`).join(',')}), E'\\n' order by ${cols.map((x) => `"${x}"::text`).join(',')}), '')) h from public."${table}"`)).rows[0].h

await src.connect()
await dst.connect()
try {
  const tables = await tablesInFkOrder(dst)
  const srcTables = await tablesInFkOrder(src)
  if (tables.slice().sort().join() !== srcTables.slice().sort().join()) throw new Error('source and target have different tables — run prisma migrate deploy on the target first')

  await dst.query('begin')
  await dst.query(`truncate ${tables.map((t) => `public."${t}"`).join(', ')} restart identity cascade`)
  for (const t of tables) await dst.query(`alter table public."${t}" disable trigger user`)

  const copied = {}
  for (const t of tables) {
    const cols = await columns(src, t)
    const { rows } = await src.query(`select ${cols.map((c) => `"${c}"`).join(', ')} from public."${t}"`)
    for (let i = 0; i < rows.length; i += 200) {
      const params = []
      const tuples = rows.slice(i, i + 200).map((row) => `(${cols.map((c) => { params.push(row[c]); return `$${params.length}` }).join(', ')})`)
      await dst.query(`insert into public."${t}" (${cols.map((c) => `"${c}"`).join(', ')}) values ${tuples.join(', ')}`, params)
    }
    copied[t] = rows.length
  }
  for (const t of tables) await dst.query(`alter table public."${t}" enable trigger user`)

  const { rows: seqs } = await src.query(`select sequencename, last_value from pg_sequences where schemaname = 'public'`)
  for (const s of seqs) {
    if (s.last_value !== null) await dst.query(`select setval($1, $2, true)`, [`public."${s.sequencename}"`, s.last_value])
  }

  const bad = []
  for (const t of tables) {
    const cols = await columns(src, t)
    const [a, b] = [await checksum(src, t, cols), await checksum(dst, t, cols)]
    if (a !== b) bad.push(t)
  }
  if (bad.length) throw new Error(`checksum mismatch → ${bad.join(', ')}`)

  await dst.query('commit')
  const total = Object.values(copied).reduce((a, b) => a + b, 0)
  console.log(`${total} rows across ${tables.length} tables, ${seqs.length} sequences synced. Every value verified.`)
} catch (err) {
  await dst.query('rollback').catch(() => {})
  console.error('Copy failed, target left unchanged:', err.message)
  process.exitCode = 1
} finally {
  await src.end()
  await dst.end()
}
