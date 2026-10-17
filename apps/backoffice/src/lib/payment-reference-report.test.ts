import { expect, it } from 'vitest'
import { paymentReferenceCsv, paymentReferenceDecimal, paymentReferenceScopeMatches } from './payment-reference-report'

it('hides loaded results and prevents export when any requested filter changes', () => {
  const loaded = { from: '2026-10-15', to: '2026-10-16', locationId: 'branch-a' }
  expect(paymentReferenceScopeMatches(loaded, { ...loaded })).toBe(true)
  expect(paymentReferenceScopeMatches(null, loaded)).toBe(false)
  for (const changed of [{ from: '2026-10-14' }, { to: '2026-10-17' }, { locationId: '' }]) {
    expect(paymentReferenceScopeMatches(loaded, { ...loaded, ...changed })).toBe(false)
  }
})

it('formats aggregate minor units exactly beyond JavaScript safe integer range', () => {
  expect(paymentReferenceDecimal(18014398509481982n)).toBe('180143985094819.82')
  expect(paymentReferenceDecimal(-101n)).toBe('-1.01')
  expect(paymentReferenceDecimal(1n)).toBe('0.01')
})

it('keeps zero-prefixed references as text, escapes CSV and never claims settlement', () => {
  const csv = paymentReferenceCsv(
    {
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
    },
    { from: '2026-10-15', to: '2026-10-16', locationId: 'l', branchName: 'Store', methodName: 'Bank "A"' },
  )
  expect(csv).toContain('Ref 0047')
  expect(csv).toContain('123.45')
  expect(csv).toContain('Bank ""A""')
  expect(csv).toContain("'=DANGEROUS()")
  expect(csv).toContain('Unverified')
  expect(csv).toContain('"From (inclusive)","2026-10-15"')
  expect(csv).toContain('"To (inclusive)","2026-10-16"')
  expect(csv).toContain('"Branch","Store","l"')
  expect(csv).toContain('"Payment method","Bank ""A"""')
})
