// Shared by server and client: what kind of data a write changes, and which
// API reads (by path prefix) must be refreshed as a consequence.

export type Entity =
  | 'transactions' | 'phones' | 'laptops' | 'accessories' | 'caisse' | 'expenses'
  | 'repairs' | 'clients' | 'suppliers' | 'credits' | 'deliveries' | 'movements'
  | 'inventory' | 'prospects' | 'documents' | 'attendance' | 'categories'
  | 'settings' | 'users' | 'stores' | 'catalog' | 'changelog' | 'site'

// Every write also adds an activity-log entry
const LOG = '/api/log'

export const AFFECTS: Record<Entity, string[]> = {
  transactions: ['/api/transactions', '/api/caisse', '/api/dashboard', '/api/bzg', '/api/phones', '/api/laptops', '/api/accessories', '/api/clients', '/api/warranty', '/api/credits', LOG],
  phones:       ['/api/phones', '/api/dashboard', '/api/suppliers', '/api/supplier-payments', '/api/documents', '/api/inventory', LOG],
  laptops:      ['/api/laptops', LOG],
  accessories:  ['/api/accessories', '/api/dashboard', LOG],
  caisse:       ['/api/caisse', '/api/cash-drops', '/api/bzg', LOG],
  expenses:     ['/api/expenses', '/api/caisse', '/api/dashboard', '/api/bzg', LOG],
  repairs:      ['/api/repairs', '/api/caisse', '/api/dashboard', '/api/bzg', '/api/clients', LOG],
  clients:      ['/api/clients', LOG],
  suppliers:    ['/api/suppliers', '/api/supplier-payments', '/api/phones', LOG],
  credits:      ['/api/credits', '/api/credit-imports', '/api/phone-credits', '/api/caisse', '/api/clients', '/api/phones', '/api/dashboard', LOG],
  deliveries:   ['/api/deliveries', '/api/phones', '/api/laptops', '/api/transactions', '/api/caisse', '/api/dashboard', LOG],
  movements:    ['/api/movements', '/api/phones', '/api/laptops', '/api/accessories', LOG],
  inventory:    ['/api/inventory', LOG],
  prospects:    ['/api/prospects', LOG],
  documents:    ['/api/documents', '/api/warranty', '/api/transactions', '/api/phones', '/api/caisse', '/api/dashboard', LOG],
  attendance:   ['/api/attendance', '/api/bzg', LOG],
  categories:   ['/api/categories'],
  settings:     ['/api/settings', LOG],
  users:        ['/api/users', LOG],
  stores:       ['/api/stores', LOG],
  catalog:      ['/api/phones/catalog'],
  changelog:    ['/api/changelog'],
  // Website (storefront) data managed from "Site web"; reserving a phone for
  // a web order also changes ERP stock.
  site:         ['/api/site', '/api/phones', '/api/dashboard', LOG],
}

// API path of a write → the entities it changes
const WRITE_ENTITIES: [prefix: string, entities: Entity[]][] = [
  ['/api/transactions',       ['transactions']],
  ['/api/phones/catalog',     ['catalog']],
  ['/api/phones',             ['phones']],
  ['/api/laptops',            ['laptops']],
  ['/api/accessories',        ['accessories']],
  ['/api/bzg/caisse',         ['caisse']],
  ['/api/caisse',             ['caisse']],
  ['/api/cash-drops',         ['caisse']],
  ['/api/expenses',           ['expenses']],
  ['/api/repairs',            ['repairs']],
  ['/api/clients',            ['clients']],
  ['/api/supplier-payments',  ['suppliers']],
  ['/api/suppliers',          ['suppliers']],
  ['/api/credit-imports',     ['credits']],
  ['/api/credits',            ['credits']],
  ['/api/phone-credits',      ['credits']],
  ['/api/deliveries',         ['deliveries']],
  ['/api/movements',          ['movements']],
  ['/api/inventory',          ['inventory']],
  ['/api/prospects',          ['prospects']],
  ['/api/documents',          ['documents']],
  ['/api/warranty',           ['documents']],
  ['/api/attendance',         ['attendance']],
  ['/api/categories',         ['categories']],
  ['/api/settings',           ['settings']],
  ['/api/users',              ['users']],
  ['/api/stores',             ['stores']],
  ['/api/changelog',          ['changelog']],
  ['/api/site',               ['site']],
]

export function entitiesForWrite(path: string): Entity[] {
  const hit = WRITE_ENTITIES.find(([prefix]) => path.startsWith(prefix))
  return hit ? hit[1] : []
}

export function prefixesFor(entities: Entity[]): string[] {
  return Array.from(new Set(entities.flatMap(e => AFFECTS[e] ?? [])))
}

export const REALTIME_CHANNEL = 'erp'
export const REALTIME_EVENT   = 'changed'
export interface ChangeEvent { store_id: string | null; entities: Entity[] }
