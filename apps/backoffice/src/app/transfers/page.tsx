import { Topbar } from '@/components/Topbar'
import { TransferWorkspace } from '@/components/TransferWorkspace'
export default function TransfersPage() {
  return (
    <>
      <Topbar
        title="Transfers & Restock"
        subtitle="Move stock between branches with dispatch and receiving controls."
      />
      <TransferWorkspace />
    </>
  )
}
