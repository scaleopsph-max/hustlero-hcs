import { expect, it } from 'vitest'
import { paymentReferenceCsv } from './payment-reference-report'

it('keeps zero-prefixed references as text, escapes CSV and never claims settlement', () => {
  const csv = paymentReferenceCsv({
    timezone: 'Asia/Manila',
    locations: [],
    rows: [
      {
        paymentId: 'p',
        saleId: 's',
        receiptNumber: '=DANGEROUS()',
        completedAt: '2026-10-16T00:00:00Z',
        locationId: 'l',
        locationName: 'Store',
        cashierName: 'Cashier',
        customerName: null,
        paymentMethodId: 'm',
        methodName: 'Bank "A"',
        methodType: 'bank_transfer',
        amountMinor: 12345,
        reversedMinor: 100,
        referenceLastFour: '0047',
      },
    ],
  })
  expect(csv).toContain('Ref 0047')
  expect(csv).toContain('123.45')
  expect(csv).toContain('Bank ""A""')
  expect(csv).toContain("'=DANGEROUS()")
  expect(csv).toContain('Unverified')
})
