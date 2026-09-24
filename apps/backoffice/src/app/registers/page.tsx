import { Topbar } from '@/components/Topbar'
import { WorkforceWorkspace } from '@/components/WorkforceWorkspace'
export default function RegistersPage() {
  return (
    <>
      <Topbar title="Registers" subtitle="POS devices assigned to a specific branch." />
      <WorkforceWorkspace focus="registers" />
    </>
  )
}
