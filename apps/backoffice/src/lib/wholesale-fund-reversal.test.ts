import { expect, it } from 'vitest'
import { wholesaleFundsContextSchema } from '@hcs/contracts'
import { restoreFundReversal, reconcileFundReversal } from './wholesale-fund-reversal'
const id = '20000000-0000-4000-8000-000000000001'
const command = { key: id, payload: { paymentId: id, reason: 'Original allocation reversed', reversalConfirmed: true } }
const result = {
  reversalId: id,
  paymentId: id,
  capitalMinor: 50000,
  operatingMinor: 30000,
  recordedAt: '2026-10-21T03:00:00Z',
}
const history = wholesaleFundsContextSchema.parse({
  canManage: true,
  canReverse: true,
  funds: [],
  payments: [
    {
      paymentId: id,
      reference: 'Synthetic',
      amountMinor: 80000,
      allocation: { paymentId: id, capitalMinor: 50000, operatingMinor: 30000, recordedAt: '2026-10-20T03:00:00Z' },
      reversal: result,
    },
  ],
})
it('restores the exact original command and reconciles the original split and history', () => {
  const saved = restoreFundReversal(JSON.stringify(command))!
  expect(reconcileFundReversal(saved, result, history)).toEqual(result)
  expect(restoreFundReversal(null)).toBeNull()
})
it.each([
  { capitalMinor: 49999 },
  { operatingMinor: 30001 },
  { reversalId: '20000000-0000-4000-8000-000000000002' },
  { recordedAt: '2026-10-21T04:00:00Z' },
])('keeps uncertain result pending: %j', (change) => {
  expect(() =>
    reconcileFundReversal(restoreFundReversal(JSON.stringify(command))!, { ...result, ...change }, history),
  ).toThrow(/reconciled/)
})
it('rejects injected scope, partial amounts and an unconfirmed reversal', () => {
  for (const patch of [{ tenantId: id }, { capitalMinor: 1 }, { reversalConfirmed: false }]) {
    expect(() =>
      restoreFundReversal(JSON.stringify({ ...command, payload: { ...command.payload, ...patch } })),
    ).toThrow()
  }
})
