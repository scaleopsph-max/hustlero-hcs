import { expect, it } from 'vitest'
import {
  fundAllocationDefinitivelyRejected,
  restoreFundAllocation,
  validateFundAllocationResponse,
} from './wholesale-funds'

const command = {
  key: '10000000-0000-4000-8000-000000000001',
  payload: {
    paymentId: '20000000-0000-4000-8000-000000000001',
    capitalMinor: 50000,
    operatingMinor: 30000,
    settledConfirmed: true as const,
    settlementReference: 'Synthetic counted receipt',
    reason: 'Synthetic recovery regression',
  },
}
const response = {
  paymentId: command.payload.paymentId,
  capitalMinor: 50000,
  operatingMinor: 30000,
  recordedAt: '2026-10-14T04:00:00Z',
}

it('restores existing fund command key/body unchanged and treats only absent storage as empty', () => {
  expect(restoreFundAllocation(null)).toBeNull()
  expect(restoreFundAllocation(JSON.stringify(command))).toEqual(command)
  expect(validateFundAllocationResponse(command, response)).toEqual(response)
})
it.each([
  '',
  '{',
  'null',
  '[]',
  '{}',
  JSON.stringify({ ...command, key: 'bad' }),
  JSON.stringify({ ...command, unknown: true }),
  JSON.stringify({ ...command, payload: { ...command.payload, settledConfirmed: false } }),
])('rejects corrupt fund recovery instead of treating it as a new command: %s', (stored) => {
  expect(() => restoreFundAllocation(stored)).toThrow()
})
it.each([
  { paymentId: '20000000-0000-4000-8000-000000000002' },
  { capitalMinor: 50001 },
  { operatingMinor: 29999 },
  { capitalMinor: 30000, operatingMinor: 50000 },
])('retains recovery after schema-valid but mismatched allocation response %j', (change) => {
  expect(() => validateFundAllocationResponse(command, { ...response, ...change })).toThrow('does not match')
})
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
