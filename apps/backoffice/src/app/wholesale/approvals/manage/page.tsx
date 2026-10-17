import { Topbar } from '@/components/Topbar'
import { WholesaleOverrideCommandsWorkspace } from '@/components/WholesaleOverrideCommandsWorkspace'
export default function WholesaleOverrideCommandsPage() {
  return (
    <>
      <Topbar title="Credit exceptions" subtitle="Scoped approvals and revocations" />
      <WholesaleOverrideCommandsWorkspace />
    </>
  )
}
