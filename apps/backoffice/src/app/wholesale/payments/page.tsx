import { Topbar } from '@/components/Topbar'
import { WholesalePaymentsWorkspace } from '@/components/WholesalePaymentsWorkspace'
import Link from 'next/link'
import { ReceiptText } from 'lucide-react'

export default function WholesalePaymentsPage() {
  return (
    <>
      <Topbar title="Wholesale payments" subtitle="Receipts and invoice balances" />
      <Link
        href="/wholesale/settlement"
        className="mx-6 mb-6 inline-flex items-center gap-2 border-b border-ink-900/20 py-3 font-semibold"
      >
        <ReceiptText size={18} />
        Settlement report
      </Link>
      <WholesalePaymentsWorkspace />
    </>
  )
}
