import { Topbar } from '@/components/Topbar'
import { WholesalePaymentsWorkspace } from '@/components/WholesalePaymentsWorkspace'

export default function WholesalePaymentsPage() {
  return (
    <>
      <Topbar title="Wholesale payments" subtitle="Receipts and invoice balances" />
      <WholesalePaymentsWorkspace />
    </>
  )
}
