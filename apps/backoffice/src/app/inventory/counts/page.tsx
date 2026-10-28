import { InventoryCountsWorkspace } from '@/components/InventoryCountsWorkspace'
import { Topbar } from '@/components/Topbar'
export default function InventoryCountsPage() {
  return (
    <>
      <Topbar
        title="Inventory counts"
        subtitle="Count stock by location, review variances and post approved adjustments."
      />
      <InventoryCountsWorkspace />
    </>
  )
}
