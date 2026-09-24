import { ApprovalCenter } from '@/components/ApprovalCenter'
import { Topbar } from '@/components/Topbar'

export default function ApprovalsPage() {
  return (
    <>
      <Topbar title="Approvals" subtitle="Review controlled actions before they change business records." />
      <ApprovalCenter />
    </>
  )
}
