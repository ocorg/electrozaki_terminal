import CaisseModule from '@/components/caisse/CaisseModule'
import { CatchUpEntry } from '@/components/layout/CatchUp'
import { PastDaysEntry } from '@/components/caisse/PastDays'

export default function EZCaissePage() {
  return (
    <>
      <CatchUpEntry />
      <PastDaysEntry storeId="EZ-001" />
      <CaisseModule storeId="EZ-001" />
    </>
  )
}
