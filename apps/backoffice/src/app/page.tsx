import { Topbar } from '@/components/Topbar'
import { ReportingWorkspace } from '@/components/ReportingWorkspace'

/**
 * Command Center (spec section 28). Answers: how is the business doing, what is wrong, what needs attention.
 * Not a report page. Content adapts to enabled modules, business size, role and permission.
 * Filters (date, location, channel) should live in the URL search params so views are shareable.
 */
export default function DashboardPage() {
  return (
    <>
      <Topbar title="Dashboard" subtitle="Live business pulse from sales, refunds, stock, and registers." />
      <ReportingWorkspace mode="dashboard" />
    </>
  )
}
