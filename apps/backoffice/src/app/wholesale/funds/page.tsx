import { Topbar } from '@/components/Topbar'
import { WholesaleFundsWorkspace } from '@/components/WholesaleFundsWorkspace'
export default function WholesaleFundsPage() {
  return (
    <>
      <Topbar title="Wholesale funds" subtitle="Confirmed allocations and fund balances" />
      <WholesaleFundsWorkspace />
    </>
  )
}
