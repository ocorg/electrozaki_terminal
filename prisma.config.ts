import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// The CLI (migrate/db pull/studio) always uses the direct (non-pooled)
// connection — pooled/pgbouncer connections don't support the session-level
// features Prisma Migrate needs (advisory locks, etc).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
})
