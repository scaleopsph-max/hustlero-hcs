import { expect, it } from 'vitest'
import Papa from 'papaparse'
import {
  paymentReferenceCsv,
  paymentReferenceDecimal,
  paymentReferenceScopeMatches,
  paymentReferenceTotals,
} from './payment-reference-report'

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

it('keeps renamed bank snapshots separate and sums repeated references as independent payments', () => {
  const base = {
    paymentId: 'p',
    saleId: null,
    channel: 'wholesale' as const,
    receiptNumber: 'p',
    completedAt: '2026-10-17T00:00:00Z',
    locationId: null,
    locationName: 'Multiple branches',
    cashierName: 'Owner',
    customerName: null,
    paymentMethodId: 'bank',
    methodName: 'Old bank',
    methodType: 'bank_transfer' as const,
    amountMinor: Number.MAX_SAFE_INTEGER,
    reversedMinor: 0,
    referenceLastFour: '0047',
  }
  const totals = paymentReferenceTotals([
    base,
    { ...base, paymentId: 'p2' },
    { ...base, paymentId: 'p3', methodName: 'New bank', amountMinor: 1 },
  ])
  expect(totals.size).toBe(2)
  expect(Array.from(totals.values()).find((row) => row.name === 'Old bank')).toMatchObject({
    amount: 18014398509481982n,
    count: 2,
  })
  expect(Array.from(totals.values()).find((row) => row.name === 'New bank')).toMatchObject({ amount: 1n, count: 1 })
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
          receiptNumber: String.fromCharCode(0) + '=DANGEROUS()',
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
  expect(csv).toContain("'" + String.fromCharCode(0) + '=DANGEROUS()')
  expect(csv).toContain('Unverified')
  const parsed = Papa.parse<string[]>(csv, { delimiter: ',' }).data
  expect(parsed).toContainEqual(['From (inclusive)', '2026-10-15'])
  expect(parsed).toContainEqual(['To (inclusive)', '2026-10-16'])
  expect(parsed).toContainEqual(['Branch', 'Store', 'l'])
  expect(parsed).toContainEqual(['Payment method', 'Bank "A"'])
})
