import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from '@/generated/storefront/client'

// The website's database (electrozaki-storefront). Only the ERP holds this
// connection: the public website has no credential for the ERP database, so
// a compromised website can't reach IMEIs, costs or iCloud data.
// Server-only — never import this from a client component.
const globalForStorefront = globalThis as unknown as { storefrontDb?: PrismaClient }

function createClient() {
  const connectionString = process.env.STOREFRONT_DATABASE_URL
  if (!connectionString) throw new Error('STOREFRONT_DATABASE_URL is not set')
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) })
}

export function storefrontDb(): PrismaClient {
  globalForStorefront.storefrontDb ??= createClient()
  return globalForStorefront.storefrontDb
}

export function storefrontConfigured(): boolean {
  return Boolean(process.env.STOREFRONT_DATABASE_URL && process.env.STOREFRONT_REF_SECRET)
}
