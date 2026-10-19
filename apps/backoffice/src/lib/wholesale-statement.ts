import type { WholesaleStatement } from '@hcs/contracts'
import { paymentMoneyInput } from './wholesale-payment'
export function statementCsv(report: WholesaleStatement): string {
  const rows: (string | number)[][] = [
    ['As of date', report.scope.asOfDate],
    ['As of', report.scope.asOf],
    ['Reporting timezone', report.scope.timezone],
    ['Customer filter', report.scope.customerId ?? 'All customers'],
    ['Location filter', report.scope.locationId ?? 'All locations'],
    ['Classified balance PHP', paymentMoneyInput(report.summary.balanceMinor)],
    ['Unclassified invoice count', report.summary.unclassifiedCount],
    ['Unclassified invoice value PHP', paymentMoneyInput(report.summary.unclassifiedMinor)],
    [
      'Invoice',
      'Customer',
      'Location',
      'Classification',
      'Branch business date',
      'Due date',
      'Days overdue',
      'Aging band',
      'Charge PHP',
      'Paid PHP',
      'Credit notes PHP',
      'Customer credit issued PHP',
      'Applied credit PHP',
      'Balance PHP',
    ],
    ...report.invoices.map((row) => [
      row.invoiceNumber,
      row.customerName,
      row.locationName,
      row.classification,
      row.businessDate,
      row.dueDate ?? '',
      row.daysOverdue ?? '',
      row.band,
      row.chargedMinor === null ? 'Unknown' : paymentMoneyInput(row.chargedMinor),
      paymentMoneyInput(row.paidMinor),
      paymentMoneyInput(row.creditedMinor),
      paymentMoneyInput(row.creditIssuedMinor),
      paymentMoneyInput(row.appliedCreditMinor),
      row.balanceMinor === null ? 'Unknown' : paymentMoneyInput(row.balanceMinor),
    ]),
    [],
    ['Recorded at', 'Invoice', 'Customer', 'Entry', 'Reference', 'Debit PHP', 'Credit PHP'],
    ...report.entries.map((row) => [
      row.recordedAt,
      row.invoiceNumber,
      row.customerName,
      row.kind,
      row.reference,
      paymentMoneyInput(row.debitMinor),
      paymentMoneyInput(row.creditMinor),
    ]),
  ]
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value),
            safe = /^[=+\-@]/.test(text.trimStart()) || /^[\t\r\n]/.test(text) ? `'${text}` : text
          return `"${safe.replaceAll('"', '""')}"`
        })
        .join(','),
    )
    .join('\r\n')
}
