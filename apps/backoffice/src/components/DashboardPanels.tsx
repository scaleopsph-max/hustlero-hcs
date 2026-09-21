import { Download, ArrowLeftRight, CircleCheck, Package, Plus, Wallet, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { Button, Chip, Glass, formatPeso } from '@hcs/ui'
import {
  alerts,
  branches,
  funds,
  inventoryHealth,
  registerLabel,
  registerTone,
  registers,
  severityLabel,
  severityTone,
  suggestedAllocation,
} from '@/mock/dashboard'

const h2 = 'font-display text-lg font-bold leading-[22px]'

/** "What needs attention". Only high-priority, actionable alerts appear here (spec section 20.2). */
export function NeedsAttention() {
  return (
    <Glass variant="data" className="flex flex-col gap-1 rounded-panel p-5">
      <div className="flex items-center justify-between pb-2.5">
        <h2 className={h2}>Needs attention</h2>
        <Chip surface="light" tone="critical">
          {alerts.length} open
        </Chip>
      </div>
      {alerts.map((a) => (
        <div key={a.title} className="flex flex-col gap-2 border-t border-ink-900/10 py-3.5">
          <div className="flex items-center justify-between">
            <Chip surface="light" tone={severityTone[a.severity]} className="h-6 text-xs">
              {severityLabel[a.severity]}
            </Chip>
            <Link href={a.href} className="text-[13px] font-semibold text-gold-800">
              {a.action}
            </Link>
          </div>
          <span className="text-sm font-semibold leading-5">{a.title}</span>
          <span className="text-xs text-ink-500">{a.meta}</span>
        </div>
      ))}
    </Glass>
  )
}

const cols = 'grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_56px] gap-3'

export function BranchPerformance() {
  const t = branches.reduce(
    (a, b) => ({ sales: a.sales + b.sales, grossProfit: a.grossProfit + b.grossProfit, txns: a.txns + b.txns }),
    { sales: 0, grossProfit: 0, txns: 0 },
  )
  return (
    <Glass variant="data" className="flex flex-col gap-3 rounded-panel p-5">
      <div className="flex items-center justify-between">
        <h2 className={h2}>Branch performance</h2>
        <Link href="/reports" className="text-[13px] font-semibold text-gold-800">
          View report
        </Link>
      </div>
      <div className={`${cols} border-b border-ink-900/[0.14] py-2 text-xs font-semibold text-ink-500`}>
        <span>Branch</span>
        <span className="text-right">Net sales</span>
        <span className="text-right">Gross profit</span>
        <span className="text-right">Txns</span>
      </div>
      {branches.map((b) => (
        <div key={b.name} className={`${cols} min-h-11 items-center border-b border-ink-900/[0.08] text-sm`}>
          <span className="font-semibold">{b.name}</span>
          <span className="text-right">{formatPeso(b.sales)}</span>
          <span className="text-right">{formatPeso(b.grossProfit)}</span>
          <span className="text-right">{b.txns}</span>
        </div>
      ))}
      <div className={`${cols} min-h-11 items-center text-sm font-bold`}>
        <span>All locations</span>
        <span className="text-right">{formatPeso(t.sales)}</span>
        <span className="text-right">{formatPeso(t.grossProfit)}</span>
        <span className="text-right">{t.txns}</span>
      </div>
    </Glass>
  )
}

export function InventoryHealth() {
  const { total, segments } = inventoryHealth
  return (
    <Glass variant="light" className="flex flex-col gap-4 rounded-panel p-5">
      <h2 className={h2}>Inventory health</h2>
      <div className="flex flex-col gap-1">
        <span className="font-display text-[28px] font-bold leading-8">{total.toLocaleString('en-PH')}</span>
        <span className="text-[13px] text-ink-500">active SKUs across 3 locations</span>
      </div>
      <div
        className="flex h-4 overflow-hidden rounded-full bg-ink-900/[0.08]"
        role="img"
        aria-label="Stock health proportions"
      >
        {segments.map((s) => (
          <div key={s.label} className={s.bar} style={{ width: `${(s.count / total) * 100}%` }} />
        ))}
      </div>
      <ul className="flex flex-col gap-2.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2.5 text-sm">
            <span className={`size-3 flex-none rounded ${s.bar}`} />
            <span className="flex-1">{s.label}</span>
            <span className="font-semibold">{s.count.toLocaleString('en-PH')}</span>
          </li>
        ))}
      </ul>
    </Glass>
  )
}

export function RegisterStatus() {
  return (
    <Glass variant="light" className="flex flex-col gap-1 rounded-panel p-5">
      <h2 className={`${h2} mb-2`}>Register status</h2>
      {registers.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-2 border-t border-ink-900/10 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold">{r.name}</span>
            <span className="text-xs text-ink-500">{r.meta}</span>
          </div>
          <Chip surface="light" tone={registerTone[r.state]} className="h-6 flex-none text-xs">
            {registerLabel[r.state]}
          </Chip>
        </div>
      ))}
    </Glass>
  )
}

/** Fund balance is a summary. HCS recommends, the user confirms, and no bank transfer is made (spec section 18.4). */
export function FundSnapshot() {
  return (
    <Glass variant="light" className="flex flex-col gap-3.5 rounded-panel p-5">
      <div className="flex items-center justify-between">
        <h2 className={h2}>Fund snapshot</h2>
        <Chip surface="light" tone="success">
          Daily close is ready
        </Chip>
      </div>
      <div className="flex gap-4">
        {funds.map((f) => (
          <div key={f.name} className="flex flex-1 flex-col gap-0.5 rounded-[14px] bg-ink-900/[0.05] px-4 py-3.5">
            <span className="text-[13px] text-ink-500">{f.name}</span>
            <span className="font-display text-2xl font-bold leading-[30px]">{formatPeso(f.balance)}</span>
          </div>
        ))}
      </div>
      <Glass variant="gold" className="flex items-center justify-between gap-5 rounded-[16px] px-4 py-3.5">
        <p className="text-sm leading-[21px] text-gold-900">
          HCS suggests <strong>{formatPeso(suggestedAllocation.amount)}</strong> to the {suggestedAllocation.fund} to
          cover today&apos;s cost of goods. You confirm first. This updates your fund ledger only. No bank transfer is
          made.
        </p>
        <Button variant="primary" size="sm" className="flex-none">
          Review allocation
        </Button>
      </Glass>
    </Glass>
  )
}

const quick: { label: string; Icon: LucideIcon }[] = [
  { label: 'New product', Icon: Plus },
  { label: 'Receive stock', Icon: Package },
  { label: 'Start transfer', Icon: ArrowLeftRight },
  { label: 'Add expense', Icon: Wallet },
  { label: 'Approve requests', Icon: CircleCheck },
  { label: 'Export sales CSV', Icon: Download },
]

export function QuickActions() {
  return (
    <Glass variant="light" className="flex flex-col gap-3.5 rounded-panel p-5">
      <h2 className={h2}>Quick actions</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {quick.map(({ label, Icon }) => (
          <button
            key={label}
            type="button"
            className="flex h-12 items-center gap-2.5 rounded-control border border-ink-900/[0.12] bg-white/70 px-3.5 text-left text-sm font-semibold text-ink-900"
          >
            <Icon size={18} strokeWidth={1.9} className="flex-none text-gold-700" />
            {label}
          </button>
        ))}
      </div>
    </Glass>
  )
}
