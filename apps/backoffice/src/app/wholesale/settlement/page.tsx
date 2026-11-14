import { Topbar } from '@/components/Topbar'
import { WholesaleSettlementWorkspace } from '@/components/WholesaleSettlementWorkspace'
import { WholesaleTabs } from '@/components/WholesaleTabs'

export default function WholesaleSettlementPage() {
  return (
    <>
      <Topbar title="Advanced wholesale" subtitle="Settlement: invoices, recorded receipts, and classified balances." />
      <WholesaleTabs />
      <WholesaleSettlementWorkspace />
    </>
  )
}
