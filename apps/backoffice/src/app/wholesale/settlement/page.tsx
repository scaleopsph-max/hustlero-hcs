import { Topbar } from '@/components/Topbar'
import { WholesaleSettlementWorkspace } from '@/components/WholesaleSettlementWorkspace'
export default function WholesaleSettlementPage() {
  return (
    <>
      <Topbar title="Wholesale settlement" subtitle="Invoices, recorded receipts, and classified balances" />
      <WholesaleSettlementWorkspace />
    </>
  )
}
