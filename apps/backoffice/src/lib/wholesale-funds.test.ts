import { expect, it } from 'vitest'
import { fundAllocationDefinitivelyRejected } from './wholesale-funds'
it.each(['WHOLESALE_FUNDS_HCFD2', 'WHOLESALE_FUNDS_HCFD3', 'WHOLESALE_FUNDS_HCFD4', 'WHOLESALE_FUNDS_HCFD5'])(
  'releases rejected allocation %s',
  (code) => {
    expect(fundAllocationDefinitivelyRejected(code)).toBe(true)
  },
)
it.each(['WHOLESALE_FUNDS_HCFD1', 'WHOLESALE_FUNDS_ACCESS_DENIED', undefined])(
  'preserves uncertain request %s',
  (code) => {
    expect(fundAllocationDefinitivelyRejected(code)).toBe(false)
  },
)
