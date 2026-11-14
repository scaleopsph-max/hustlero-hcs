import { Topbar } from '@/components/Topbar'
import { WholesaleOverrideCommandsWorkspace } from '@/components/WholesaleOverrideCommandsWorkspace'
import { WholesaleTabs } from '@/components/WholesaleTabs'

export default function WholesaleOverrideCommandsPage() {
  return (
    <>
      <Topbar title="Advanced wholesale" subtitle="Credit approvals: approve or revoke a one-time credit exception." />
      <WholesaleTabs />
      <WholesaleOverrideCommandsWorkspace />
    </>
  )
}
