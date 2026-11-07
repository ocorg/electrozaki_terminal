import { redirect }       from 'next/navigation'
import type { Metadata }  from 'next'
import { auth }           from '@/auth'
import InventoryTabs      from '@/components/inventory/InventoryTabs'

export const metadata: Metadata = { title: 'Inventaire' }

export default async function InventoryPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const { role } = session.user
  if (role !== 'gerant' && role !== 'proprietaire') redirect('/ez/dashboard')

  return <InventoryTabs role={role} />
}
