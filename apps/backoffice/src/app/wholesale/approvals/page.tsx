import { Topbar } from '@/components/Topbar'
import { WholesaleApprovalHistoryWorkspace } from '@/components/WholesaleApprovalHistoryWorkspace'
import { WholesaleTabs } from '@/components/WholesaleTabs'

export default function WholesaleApprovalHistoryPage() {
  return (
    <>
      <Topbar title="Advanced wholesale" subtitle="Credit approvals: one-time credit exceptions and their history." />
      <WholesaleTabs />
      <WholesaleApprovalHistoryWorkspace />
    </>
  )
}
