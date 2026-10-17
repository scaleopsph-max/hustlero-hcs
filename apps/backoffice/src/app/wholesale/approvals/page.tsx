import { Topbar } from '@/components/Topbar'
import { WholesaleApprovalHistoryWorkspace } from '@/components/WholesaleApprovalHistoryWorkspace'
export default function WholesaleApprovalHistoryPage() {
  return (
    <>
      <Topbar title="Wholesale approvals" subtitle="Credit approval history" />
      <WholesaleApprovalHistoryWorkspace />
    </>
  )
}
