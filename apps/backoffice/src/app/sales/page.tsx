import { SalesWorkspace } from '@/components/SalesWorkspace'
import { Topbar } from '@/components/Topbar'

export default function SalesPage() {
  return (
    <>
      <Topbar title="Sales" subtitle="Completed POS receipts and wholesale invoices across branches." />
      <SalesWorkspace />
    </>
  )
}
