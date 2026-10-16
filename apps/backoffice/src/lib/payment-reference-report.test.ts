import { expect, it } from 'vitest'
import { paymentReferenceCsv, paymentReferenceDecimal } from './payment-reference-report'

it('formats aggregate minor units exactly beyond JavaScript safe integer range', () => {
  expect(paymentReferenceDecimal(18014398509481982n)).toBe('180143985094819.82')
  expect(paymentReferenceDecimal(-101n)).toBe('-1.01')
  expect(paymentReferenceDecimal(1n)).toBe('0.01')
})

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
