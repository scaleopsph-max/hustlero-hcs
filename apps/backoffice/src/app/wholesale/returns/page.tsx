import { Topbar } from '@/components/Topbar'
import { WholesaleReturnsWorkspace } from '@/components/WholesaleReturnsWorkspace'
export default function WholesaleReturnsPage() {
  return (
    <>
      <Topbar title="Wholesale returns" subtitle="Credit notes, customer credit and payouts" />
      <WholesaleReturnsWorkspace />
    </>
  )
}
