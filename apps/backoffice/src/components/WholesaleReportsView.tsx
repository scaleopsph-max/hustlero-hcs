'use client'

import { Glass } from '@hcs/ui'
import { useState } from 'react'

import { PaymentReferenceReport } from './PaymentReferenceReport'
import { WholesaleSettlementWorkspace } from './WholesaleSettlementWorkspace'
import { WholesaleStatementsWorkspace } from './WholesaleStatementsWorkspace'

type WholesaleReport = 'settlement' | 'statements' | 'receipts'

const reports: Array<{ value: WholesaleReport; label: string; hint: string }> = [
  { value: 'settlement', label: 'Settlement', hint: 'Invoices, recorded receipts, and classified balances.' },
  { value: 'statements', label: 'Statements and aging', hint: 'What each wholesale customer owes, by age.' },
  { value: 'receipts', label: 'Bank and wallet receipts', hint: 'Wholesale payments by bank or wallet reference.' },
]

/** The wholesale reports, grouped under Reports. Each keeps its own filters. */
export function WholesaleReportsView() {
  const [report, setReport] = useState<WholesaleReport>('settlement')
  const active = reports.find((item) => item.value === report) ?? reports[0]!
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Wholesale reports">
        {reports.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setReport(item.value)}
            aria-pressed={report === item.value}
            className={`min-h-10 border px-3 text-sm font-semibold transition ${
              report === item.value
                ? 'border-ink-950 bg-ink-950 text-white'
                : 'border-ink-900/15 bg-white text-ink-600 hover:text-ink-950'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Glass variant="light" className="p-4 text-sm text-ink-600">
        {active.hint} This report has its own date filter below.
      </Glass>
      {report === 'settlement' ? <WholesaleSettlementWorkspace /> : null}
      {report === 'statements' ? <WholesaleStatementsWorkspace /> : null}
      {report === 'receipts' ? <PaymentReferenceReport key="wholesale" wholesale /> : null}
    </div>
  )
}
