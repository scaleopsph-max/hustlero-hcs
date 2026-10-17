import type { PosPaymentReferenceReport } from '@hcs/contracts'
import { reportCsv } from './report-csv'

export type PaymentReferenceScope = { from: string; to: string; locationId: string }

export function paymentReferenceScopeMatches(loaded: PaymentReferenceScope | null, selected: PaymentReferenceScope) {
  return (
    !!loaded && loaded.from === selected.from && loaded.to === selected.to && loaded.locationId === selected.locationId
  )
}

export function paymentReferenceDecimal(value: bigint): string {
  const magnitude = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`
}

export function paymentReferenceTotals(rows: PosPaymentReferenceReport['rows']) {
  const totals = new Map<string, { name: string; amount: bigint; reversed: bigint; count: number }>()
  for (const row of rows) {
    const key = JSON.stringify([row.paymentMethodId, row.methodType, row.methodName])
    const item = totals.get(key) ?? { name: row.methodName, amount: 0n, reversed: 0n, count: 0 }
    item.amount += BigInt(row.amountMinor)
    item.reversed += BigInt(row.reversedMinor)
    item.count++
    totals.set(key, item)
  }
  return totals
}

export function paymentReferenceCsv(
  report: PosPaymentReferenceReport,
  scope: PaymentReferenceScope & { branchName: string; methodName: string },
): string {
  const rows: Array<Array<string | number>> = [
    ['Timezone', report.timezone],
    ['From (inclusive)', scope.from],
    ['To (inclusive)', scope.to],
    ['Branch', scope.branchName, scope.locationId || 'All permitted branches'],
    ['Payment method', scope.methodName],
    [
      'Receipt',
      'Recorded at',
      'Branch',
      'Cashier',
      'Customer',
      'Payment method',
      'Amount PHP',
      'Reversed PHP',
      'Last four',
      'Settlement verification',
      'Channel',
    ],
    ...report.rows.map((row) => [
      row.receiptNumber,
      row.completedAt,
      row.locationName,
      row.cashierName,
      row.customerName ?? '',
      row.methodName,
      paymentReferenceDecimal(BigInt(row.amountMinor)),
      paymentReferenceDecimal(BigInt(row.reversedMinor)),
      row.referenceLastFour ? `Ref ${row.referenceLastFour}` : 'Not recorded',
      'Unverified',
      row.channel ?? 'pos',
    ]),
  ]
  return reportCsv(rows)
}
