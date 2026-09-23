// Copies the storefront's Prisma schema (../electrozaki-storefront owns it and
// its migrations) into prisma-storefront/schema.prisma, swapping only the
// generator block, so the ERP gets a typed client for the website database.
//
//   node scripts/pull-storefront-schema.mjs          → copy
//   node scripts/pull-storefront-schema.mjs --check  → fail if the copy is stale
//
// Run it (then `npm run build` / `npx prisma generate --schema ...`) whenever
// the storefront schema changes. Never run `prisma migrate` on this copy.
import fs from 'node:fs'
import path from 'node:path'

const source = path.resolve('../electrozaki-storefront/prisma/schema.prisma')
// Deliberately NOT inside prisma/: Prisma's editor extension reads every
// .prisma file under prisma/ as one schema and would see two generators.
const target = path.resolve('prisma-storefront/schema.prisma')

const HEADER = `// ─────────────────────────────────────────────────────────────────────────
// GENERATED COPY — do not edit. Source: electrozaki-storefront/prisma/schema.prisma
// (that project owns this database and its migrations). Refresh with
// \`node scripts/pull-storefront-schema.mjs\`. Used only to generate the ERP's
// client for the website database (src/lib/storefront/db.ts).
// ─────────────────────────────────────────────────────────────────────────
`

const GENERATOR = `generator client {
  provider = "prisma-client"
  output   = "../src/generated/storefront"
}`

function build(text) {
  const body = text.replace(/generator client \{[^}]*\}/, GENERATOR)
  if (body === text) throw new Error('generator block not found in the storefront schema')
  return HEADER + body.replace(/\r\n/g, '\n')
}

const check = process.argv.includes('--check')
if (!fs.existsSync(source)) {
  if (check) { console.log('storefront repo not found next to this one — skipping check'); process.exit(0) }
  throw new Error(`not found: ${source}`)
}
const wanted = build(fs.readFileSync(source, 'utf8'))

if (check) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  if (current !== wanted) {
    console.error('prisma-storefront/schema.prisma is out of date — run node scripts/pull-storefront-schema.mjs')
    process.exit(1)
  }
  console.log('storefront schema copy is up to date')
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, wanted)
  console.log(`wrote ${path.relative(process.cwd(), target)}`)
}
