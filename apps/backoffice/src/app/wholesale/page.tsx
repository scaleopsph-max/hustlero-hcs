import { Topbar } from '@/components/Topbar'
import { WholesaleOrdersWorkspace } from '@/components/WholesaleOrdersWorkspace'
import { WholesaleTabs } from '@/components/WholesaleTabs'

export default function WholesaleOrdersPage() {
  return (
    <>
      <Topbar
        title="Advanced wholesale"
        subtitle="Orders: prepare reseller orders and reserve the same stock retail sells from."
      />
      <WholesaleTabs />
      <WholesaleOrdersWorkspace />
    </>
  )
}
