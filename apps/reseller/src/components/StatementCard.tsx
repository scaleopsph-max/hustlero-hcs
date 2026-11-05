'use client'

import type { ResellerStatement } from '@hcs/contracts'
import { Button, Chip, Glass, formatPeso } from '@hcs/ui'
import { ChevronDown, ReceiptText } from 'lucide-react'
import { useEffect, useState } from 'react'

import { formatDateTime } from '@/lib/labels'

import { SettleInvoice } from './SettleInvoice'

/** What the reseller owes this business: open invoices, orders not shipped yet, payments, and returns. */
export function StatementCard({
  load,
  onOpenOrder,
  onApplyCredit,
  onRedeemPoints,
}: {
  load: () => Promise<ResellerStatement>
  onOpenOrder: (salesOrderId: string) => void
  onApplyCredit: (invoiceId: string, amountMinor: number, key: string) => Promise<unknown>
  onRedeemPoints: (invoiceId: string, points: number, key: string) => Promise<unknown>
}) {
  const [statement, setStatement] = useState<ResellerStatement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showActivity, setShowActivity] = useState(false)
  const [settling, setSettling] = useState<{ invoiceId: string; mode: 'credit' | 'points' } | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    load()
      .then(setStatement)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'The statement could not load.'))
  }, [load, version])

  if (error)
    return (
      <Glass className="rounded-glass p-4 text-small text-signal-dark-critical-fg" role="alert">
        {error}
      </Glass>
    )
  if (!statement)
    return (
      <Glass className="rounded-glass p-4 text-small text-ink-300" role="status">
        Loading your statement…
      </Glass>
    )

  const { summary } = statement
  const totalDue = summary.outstandingMinor + summary.notInvoicedMinor
  const open = statement.invoices.filter((invoice) => invoice.status !== 'paid')
  const points = statement.points ?? null
  const canUsePoints = points !== null && points.redeemValueMinor !== null && points.balance >= points.minimumPoints
  return (
    <Glass className="flex flex-col gap-4 rounded-glass p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-small font-semibold">
            <ReceiptText size={16} /> Statement of account
          </p>
          <p className="text-caption text-ink-400">As of {statement.asOf}</p>
        </div>
        {summary.overdueMinor > 0 ? <Chip tone="critical">{formatPeso(summary.overdueMinor)} overdue</Chip> : null}
      </div>

      <div>
        <p className="text-caption text-ink-400">Total to pay</p>
        <p className="text-h2 text-gold-300">{formatPeso(totalDue)}</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-small">
          <dt className="text-ink-300">Invoiced, unpaid</dt>
          <dd className="text-right">{formatPeso(summary.outstandingMinor)}</dd>
          <dt className="text-ink-300">Confirmed, not shipped yet</dt>
          <dd className="text-right">{formatPeso(summary.notInvoicedMinor)}</dd>
          {summary.pendingProofsMinor > 0 ? (
            <>
              <dt className="text-ink-300">Payments being checked</dt>
              <dd className="text-right">{formatPeso(summary.pendingProofsMinor)}</dd>
            </>
          ) : null}
          {summary.creditAvailableMinor > 0 ? (
            <>
              <dt className="text-ink-300">Credit from returns</dt>
              <dd className="text-right text-signal-dark-success-fg">{formatPeso(summary.creditAvailableMinor)}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {open.length > 0 || statement.notInvoiced.length > 0 ? (
        <ul className="flex flex-col divide-y divide-white/10 border-y border-white/10">
          {open.map((invoice) => (
            <li key={invoice.invoiceId} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {invoice.invoiceNumber}
                    {invoice.orderNumber ? <span className="text-ink-400"> · {invoice.orderNumber}</span> : null}
                  </p>
                  <p
                    className={
                      invoice.status === 'overdue'
                        ? 'text-caption text-signal-dark-critical-fg'
                        : 'text-caption text-ink-400'
                    }
                  >
                    {invoice.status === 'overdue'
                      ? `${invoice.daysOverdue} ${invoice.daysOverdue === 1 ? 'day' : 'days'} overdue`
                      : invoice.dueDate
                        ? `Due ${invoice.dueDate}`
                        : 'Open'}
                    {' · '}
                    {formatPeso(invoice.balanceMinor)} of {formatPeso(invoice.totalMinor)}
                  </p>
                </div>
                {invoice.salesOrderId ? (
                  <Button size="sm" variant="primary" onClick={() => onOpenOrder(invoice.salesOrderId!)}>
                    Pay
                  </Button>
                ) : null}
              </div>
              {summary.creditAvailableMinor > 0 || canUsePoints ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {summary.creditAvailableMinor > 0 ? (
                    <Button
                      size="sm"
                      aria-pressed={settling?.invoiceId === invoice.invoiceId && settling.mode === 'credit'}
                      onClick={() => setSettling({ invoiceId: invoice.invoiceId, mode: 'credit' })}
                    >
                      Use credit
                    </Button>
                  ) : null}
                  {canUsePoints ? (
                    <Button
                      size="sm"
                      aria-pressed={settling?.invoiceId === invoice.invoiceId && settling.mode === 'points'}
                      onClick={() => setSettling({ invoiceId: invoice.invoiceId, mode: 'points' })}
                    >
                      Use points
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {settling?.invoiceId === invoice.invoiceId && points ? (
                <SettleInvoice
                  key={settling.mode}
                  invoice={invoice}
                  mode={settling.mode}
                  creditAvailableMinor={summary.creditAvailableMinor}
                  points={points}
                  onApplyCredit={onApplyCredit}
                  onRedeemPoints={onRedeemPoints}
                  onDone={() => {
                    setSettling(null)
                    setVersion((value) => value + 1)
                  }}
                />
              ) : null}
            </li>
          ))}
          {statement.notInvoiced.map((order) => (
            <li key={order.salesOrderId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-semibold">{order.orderNumber}</p>
                <p className="text-caption text-ink-400">Confirmed · {formatPeso(order.amountMinor)} left to pay</p>
              </div>
              <Button size="sm" onClick={() => onOpenOrder(order.salesOrderId)}>
                Pay
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-signal-dark-success-fg">You are all paid up. Thank you!</p>
      )}

      {statement.activity.length > 0 ? (
        <div>
          <button
            type="button"
            className="flex w-full items-center justify-between text-small font-semibold"
            aria-expanded={showActivity}
            onClick={() => setShowActivity((value) => !value)}
          >
            Recent activity (90 days)
            <ChevronDown size={16} className={showActivity ? 'rotate-180 transition' : 'transition'} />
          </button>
          {showActivity ? (
            <ul className="mt-2 flex flex-col gap-2 text-small">
              {statement.activity.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate">{entry.label}</p>
                    <p className="text-caption text-ink-400">{formatDateTime(entry.at)}</p>
                  </div>
                  <p
                    className={
                      entry.creditMinor > 0
                        ? 'whitespace-nowrap font-semibold text-signal-dark-success-fg'
                        : 'whitespace-nowrap font-semibold'
                    }
                  >
                    {entry.creditMinor > 0 ? `−${formatPeso(entry.creditMinor)}` : formatPeso(entry.debitMinor)}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Glass>
  )
}
