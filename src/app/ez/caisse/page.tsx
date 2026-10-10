import CaisseModule from '@/components/caisse/CaisseModule'
import { CatchUpEntry } from '@/components/layout/CatchUp'

export default function EZCaissePage() {
  return (
    <>
      <CatchUpEntry />
      <CaisseModule storeId="EZ-001" />
    </>
  )
}
