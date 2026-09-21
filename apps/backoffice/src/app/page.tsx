import { Topbar } from '@/components/Topbar'
import { KpiRow } from '@/components/KpiRow'
import { SalesChart } from '@/components/SalesChart'
import {
  BranchPerformance,
  FundSnapshot,
  InventoryHealth,
  NeedsAttention,
  QuickActions,
  RegisterStatus,
} from '@/components/DashboardPanels'
import { Chip } from '@hcs/ui'

/**
 * Command Center (spec section 28). Answers: how is the business doing, what is wrong, what needs attention.
 * Not a report page. Content adapts to enabled modules, business size, role and permission.
 * Filters (date, location, channel) should live in the URL search params so views are shareable.
 */
export default function DashboardPage() {
  return (
    <>
      <Topbar title="Dashboard" subtitle="Sunday, 20 September 2026" showFilters />
      <div className="flex items-center justify-between px-1 pt-1">
        <h2 className="font-display text-xl font-bold leading-6">Business pulse</h2>
        <div className="flex items-center gap-3">
          <Chip surface="light" tone="info">
            Sample data
          </Chip>
          <span className="text-[13px] text-ink-500">Updated 2:16 PM</span>
        </div>
      </div>
      <KpiRow />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <SalesChart />
        <NeedsAttention />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <BranchPerformance />
        <InventoryHealth />
        <RegisterStatus />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <FundSnapshot />
        <QuickActions />
      </div>
    </>
  )
}
