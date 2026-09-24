import { Topbar } from '@/components/Topbar'
import { WorkforceWorkspace } from '@/components/WorkforceWorkspace'
export default function LocationsPage() {
  return (
    <>
      <Topbar title="Locations" subtitle="Stores, warehouses, offices, and virtual branches." />
      <WorkforceWorkspace focus="locations" />
    </>
  )
}
