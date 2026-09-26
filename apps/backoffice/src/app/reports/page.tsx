import { ReportingWorkspace } from '@/components/ReportingWorkspace'
import { Topbar } from '@/components/Topbar'

export default function ReportsPage() {
  return (
    <>
      <Topbar title="Reports" subtitle="Reconciled sales performance, profitability, inventory, and CSV exports." />
      <ReportingWorkspace mode="reports" />
    </>
  )
}
