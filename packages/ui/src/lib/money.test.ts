import { describe, expect, it } from 'vitest'
import { formatPeso, formatPesoSigned } from './money'

describe('shared exact peso display', () => {
  it.each([
    [0, '₱0.00'],
    [-0, '₱0.00'],
    [1, '₱0.01'],
    [9, '₱0.09'],
    [10, '₱0.10'],
    [99, '₱0.99'],
    [100, '₱1.00'],
    [101, '₱1.01'],
    [198632, '₱1,986.32'],
    [-4500, '−₱45.00'],
    [-1, '−₱0.01'],
    [Number.MAX_SAFE_INTEGER, '₱90,071,992,547,409.91'],
    [Number.MAX_SAFE_INTEGER - 1, '₱90,071,992,547,409.90'],
    [Number.MAX_SAFE_INTEGER - 2, '₱90,071,992,547,409.89'],
    [-Number.MAX_SAFE_INTEGER, '−₱90,071,992,547,409.91'],
  ])('preserves exact centavos, currency grouping and sign for %s', (minor, expected) => {
    expect(formatPeso(minor)).toBe(expected)
  })

  it.each([
    [0, '₱0.00'],
    [-0, '₱0.00'],
    [1, '+₱0.01'],
    [-1, '−₱0.01'],
    [1824000, '+₱18,240.00'],
    [-31000, '−₱310.00'],
    [Number.MAX_SAFE_INTEGER, '+₱90,071,992,547,409.91'],
    [-Number.MAX_SAFE_INTEGER, '−₱90,071,992,547,409.91'],
  ])('preserves ledger-style signs for %s', (minor, expected) => {
    expect(formatPesoSigned(minor)).toBe(expected)
  })

  it('preserves each cent and sign in a 2,000-value safe-integer boundary window', () => {
    for (let offset = 0; offset < 1000; offset++) {
      const minor = Number.MAX_SAFE_INTEGER - offset
      for (const signed of [minor, -minor]) {
        const displayed = formatPeso(signed)
        expect(BigInt(displayed.replace(/\D/g, ''))).toBe(BigInt(minor))
        expect(displayed.startsWith('−')).toBe(signed < 0)
      }
    }
  })

  it('retains ordinary display output across every cent remainder', () => {
    const original = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
    for (const whole of [0, 1, 999, 1000, 123456]) {
      for (let fraction = 0; fraction < 100; fraction++) {
        const minor = whole * 100 + fraction
        expect(formatPeso(minor)).toBe(original.format(minor / 100))
      }
    }
  })

  it.each([
    0.5,
    -0.5,
    1.25,
    -1.25,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('preserves legacy non-safe-integer display without introducing command validation: %s', (value) => {
    const original = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
    expect(formatPeso(value)).toBe((value < 0 ? '−' : '') + original.format(Math.abs(value) / 100))
  })
})
