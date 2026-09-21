import { Chip, Glass, formatPeso } from '@hcs/ui'
import { kpis } from '@/mock/dashboard'

/** Business Pulse (spec section 28): net sales, gross profit, est. net profit, transactions, COGS, expenses. */
export function KpiRow() {
  return (
    <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-6">
      {kpis.map((k) => (
        <Glass key={k.label} variant="light" className="flex min-w-0 flex-col gap-2 rounded-[20px] p-4">
          <span className="text-[13px] font-medium text-ink-500">{k.label}</span>
          <span className="font-display text-2xl font-bold leading-[30px] text-ink-900">
            {k.kind === 'money' ? formatPeso(k.value) : k.value.toLocaleString('en-PH')}
          </span>
          <div className="flex items-center gap-2">
            <Chip surface="light" tone={k.tone} className="h-[22px] px-2 text-xs">
              {k.delta}
            </Chip>
            <span className="text-xs text-ink-500">vs yesterday</span>
          </div>
        </Glass>
      ))}
    </div>
  )
}
