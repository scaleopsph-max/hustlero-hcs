import type { PosPaymentReferenceReport } from '@hcs/contracts'

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
      (row.amountMinor / 100).toFixed(2),
      (row.reversedMinor / 100).toFixed(2),
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
