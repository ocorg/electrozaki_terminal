import LabelSheets from '@/components/accessories/LabelSheets'

// Grouped label printing on A4 (owner, 2026-11-07): under Stock → Accessoires,
// so the staff who receive stock can print too.
export default function Page() {
  return <LabelSheets storeId="EZ-001" />
}
