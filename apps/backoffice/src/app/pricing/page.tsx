import { PricingWorkspace } from '@/components/PricingWorkspace'
import { Topbar } from '@/components/Topbar'

export default function PricingPage() {
  return (
    <>
      <Topbar
        title="Wholesale pricing"
        subtitle="Set quantity thresholds and reseller price lists without splitting inventory."
      />
      <PricingWorkspace />
    </>
  )
}
