import { expect, it, vi } from 'vitest'
import {
  fundAllocationDefinitivelyRejected,
  refreshConfirmedFundAllocation,
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
const receipt = {
  paymentId: command.payload.paymentId,
  reference: 'Synthetic receipt',
  amountMinor: 80000,
  allocation: response,
}
const posted = {
  canManage: true,
  funds: [
    { fundType: 'capital_cogs', name: 'Capital', balanceMinor: 50000 },
    { fundType: 'operating', name: 'Operating', balanceMinor: 30000 },
  ],
  payments: [receipt],
}

it('requires refreshed receipt history before completing a fund command', async () => {
  const refresh = vi.fn().mockResolvedValue(posted)
  await expect(refreshConfirmedFundAllocation(command, response, refresh)).resolves.toEqual(posted)
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('keeps the original saved key and split available after a failed history refresh', async () => {
  const saved = JSON.stringify(command)
  const refresh = vi.fn().mockRejectedValue(new Error('Synthetic connection lost'))
  await expect(refreshConfirmedFundAllocation(command, response, refresh)).rejects.toThrow('connection lost')
  const restored = restoreFundAllocation(saved)!
  expect(restored).toEqual(command)
  await expect(refreshConfirmedFundAllocation(restored, response, async () => posted)).resolves.toEqual(posted)
})
it('does not refresh or report completion for a mismatched POST response', async () => {
  const refresh = vi.fn().mockResolvedValue(posted)
  await expect(refreshConfirmedFundAllocation(command, { ...response, capitalMinor: 50001 }, refresh)).rejects.toThrow(
    'does not match',
  )
  expect(refresh).not.toHaveBeenCalled()
})
it.each([
  { payments: [] },
  { payments: [{ ...receipt, allocation: null }] },
  { payments: [receipt, receipt] },
  { payments: [{ ...receipt, amountMinor: 79999 }] },
  { payments: [{ ...receipt, paymentId: '20000000-0000-4000-8000-000000000002' }] },
  {
    payments: [{ ...receipt, allocation: { ...response, paymentId: '20000000-0000-4000-8000-000000000002' } }],
  },
  { payments: [{ ...receipt, allocation: { ...response, capitalMinor: 50001, operatingMinor: 29999 } }] },
  { payments: [{ ...receipt, allocation: { ...response, recordedAt: '2026-10-14T04:00:01Z' } }] },
])('rejects incomplete or inconsistent refreshed fund history %j', async (change) => {
  await expect(
    refreshConfirmedFundAllocation(command, response, async () => ({ ...posted, ...change })),
  ).rejects.toThrow('does not match')
})
it('accepts equivalent timezone representations of the original allocation event', async () => {
  const next = {
    ...posted,
    payments: [{ ...receipt, allocation: { ...response, recordedAt: '2026-10-14T12:00:00+08:00' } }],
  }
  await expect(refreshConfirmedFundAllocation(command, response, async () => next)).resolves.toEqual(next)
})
it('rejects malformed refreshed context rather than completing recovery', async () => {
  await expect(refreshConfirmedFundAllocation(command, response, async () => ({ payments: [] }))).rejects.toThrow()
})

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
