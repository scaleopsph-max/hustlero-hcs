import { Topbar } from '@/components/Topbar'
import { WholesaleOrdersWorkspace } from '@/components/WholesaleOrdersWorkspace'

export default function WholesaleOrdersPage() {
  return (
    <>
      <Topbar
        title="Advanced wholesale"
        subtitle="Prepare reseller orders and reserve the same inventory used by retail when an order is confirmed."
      />
      <WholesaleOrdersWorkspace />
    </>
  )
}
