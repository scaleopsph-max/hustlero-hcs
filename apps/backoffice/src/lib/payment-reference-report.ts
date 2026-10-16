import type { PosPaymentReferenceReport } from '@hcs/contracts'

export function paymentReferenceDecimal(value: bigint): string {
  const magnitude = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`
}

export function paymentReferenceTotals(rows: PosPaymentReferenceReport['rows']) {
  const totals = new Map<string, { name: string; amount: bigint; reversed: bigint; count: number }>()
  for (const row of rows) {
    const item = totals.get(row.paymentMethodId) ?? { name: row.methodName, amount: 0n, reversed: 0n, count: 0 }
    item.amount += BigInt(row.amountMinor)
    item.reversed += BigInt(row.reversedMinor)
    item.count++
    totals.set(row.paymentMethodId, item)
  }
  return totals
}

export function paymentReferenceCsv(report: PosPaymentReferenceReport): string {
  const rows: Array<Array<string | number>> = [
    ['Timezone', report.timezone],
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
    ]),
  ]
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value)
          const safe = /^[=+\-@]/.test(text.trimStart()) || /^[\t\r\n]/.test(text) ? `'${text}` : text
          return `"${safe.replaceAll('"', '""')}"`
        })
        .join(','),
    )
    .join('\r\n')
}
