'use client'
import { usePrefetch } from '@/lib/data/api'
import { getBusinessDate } from '@/lib/utils'
import { useUser } from '@/lib/hooks/useUser'

// Loads the busiest screens' data in the background after the portal opens,
// so the first visit to the POS, stock, clients or caisse is already instant.
// Each URL must match the one its screen reads.
export default function PortalPrefetch({ storeId }: { storeId: string }) {
  const { user } = useUser()
  const manager = user?.role === 'gerant' || user?.role === 'proprietaire'
  // Staff only prefetch what they may read (suppliers / prospects are managers' data)
  usePrefetch(!user ? [] : [
    '/api/categories',
    `/api/phones?status=disponible&store_id=${storeId}&limit=500`,
    `/api/accessories?store_id=${storeId}`,
    `/api/clients?store_id=${storeId}`,
    `/api/caisse?store_id=${storeId}&date=${getBusinessDate()}`,
    ...(manager ? ['/api/suppliers?mode=dropdown', `/api/prospects?store_id=${storeId}&open=1`] : []),
    '/api/phones/catalog',
    `/api/phones?store_id=${storeId}&limit=5000`,
  ])
  return null
}
