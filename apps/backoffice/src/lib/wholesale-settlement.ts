import type { WholesaleSettlementReport } from '@hcs/contracts'
import { paymentMoneyInput } from './wholesale-payment'
export function settlementCsv(report: WholesaleSettlementReport): string {
  const rows: Array<Array<string | number>> = [
    ['From', report.scope.from],
    ['To', report.scope.to],
    ['Timezone', report.scope.timezone],
    ['As of', report.scope.asOf],
    [
      'Location',
      report.scope.locationId === null
        ? 'All locations'
        : (report.locations.find((item) => item.id === report.scope.locationId)?.name ?? report.scope.locationId),
    ],
    ['Issued invoices PHP', paymentMoneyInput(report.summary.issuedMinor)],
    ['Recorded receipts PHP', paymentMoneyInput(report.summary.recordedReceiptsMinor)],
    ['Opening charges PHP', paymentMoneyInput(report.summary.openingChargesMinor)],
    ['Closing classified balance PHP', paymentMoneyInput(report.summary.closingReceivablesMinor)],
    ['Unclassified invoices', report.summary.unclassifiedCount],
    ['Unclassified value PHP', paymentMoneyInput(report.summary.unclassifiedMinor)],
    ['Payment method', 'Receipt count', 'Allocated PHP'],
    ...report.byPaymentMethod.map((item) => [item.name, item.receiptCount, paymentMoneyInput(item.amountMinor)]),
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
