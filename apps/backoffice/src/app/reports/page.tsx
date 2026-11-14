import { ReportingWorkspace } from '@/components/ReportingWorkspace'
import { Topbar } from '@/components/Topbar'
import Link from 'next/link'
import { ReceiptText } from 'lucide-react'

export default function ReportsPage() {
  return (
    <>
      <Topbar title="Reports" subtitle="Sales, inventory, reseller portal, and wholesale reports with CSV exports." />
      <Link
        href="/reports/payments"
        className="mx-6 mb-6 inline-flex items-center gap-2 border-b border-ink-900/20 py-3 font-semibold"
      >
        <ReceiptText size={18} />
        Online payment records
      </Link>
      <ReportingWorkspace mode="reports" />
    </>
  )
}
