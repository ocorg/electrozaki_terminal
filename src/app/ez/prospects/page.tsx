'use client'
import { useUser } from '@/lib/hooks/useUser'
import ProspectsModule from '@/components/prospects/ProspectsModule'

export default function EZProspectsPage() {
  const { user } = useUser()
  return <ProspectsModule storeId="EZ-001" role={user?.role} />
}