import { describe, expect, it } from 'vitest'
import { wholesaleReturnsContextSchema } from '@hcs/contracts'
import { pendingWholesaleReturnSchema, reconcileWholesaleReturn, restoreWholesaleReturn } from './wholesale-returns'
const id = '10000000-0000-4000-8000-000000000001',
  key = '20000000-0000-4000-8000-000000000001'
const response = {
  creditNoteId: id,
  invoiceId: id,
  refundId: id,
  amountMinor: 45000,
  debtReductionMinor: 45000,
  newCustomerCreditMinor: 0,
  openDebtMinor: 0,
  cashPayoutMinor: 0,
}
const command = pendingWholesaleReturnSchema.parse({
  operation: 'return',
  key,
  payload: {
    invoiceId: id,
    reason: 'Synthetic return',
    lines: [{ invoiceLineId: id, quantityMilli: 1000, returnToStock: true }],
  },
})
const history = wholesaleReturnsContextSchema.parse({
  canPost: true,
  canApply: true,
  canRefund: true,
  invoices: [],
  notes: [
    {
      creditNoteId: id,
      invoiceId: id,
      refundId: id,
      customerId: id,
      locationId: id,
      reason: 'Synthetic return',
      amountMinor: 45000,
      debtReductionMinor: 45000,
      issuedCreditMinor: 0,
      availableCreditMinor: 0,
      commandKey: key,
      payoutBlocked: false,
      recordedAt: '2026-10-18T00:00:00Z',
      lines: [
        { invoiceLineId: id, name: 'Synthetic shoes', quantityMilli: 1000, amountMinor: 45000, returnToStock: true },
      ],
    },
  ],
  applications: [],
  payouts: [],
  methods: [],
  sessions: [],
})
describe('AW4 pending-command recovery', () => {
  it('reconciles credit application only against its exact persisted command and target invoice', () => {
    const pending = pendingWholesaleReturnSchema.parse({
      operation: 'apply',
      key,
      payload: { creditNoteId: id, invoiceId: id, amountMinor: 30000, reason: 'Apply existing credit' },
    })
    const result = { applicationId: id, creditNoteId: id, invoiceId: id, amountMinor: 30000 }
    const current = { ...history, applications: [{ ...result, commandKey: key }] }
    expect(restoreWholesaleReturn(JSON.stringify(pending))).toEqual(pending)
    expect(() => reconcileWholesaleReturn(pending, result, current)).not.toThrow()
    expect(() => reconcileWholesaleReturn(pending, result, { ...current, applications: [] })).toThrow()
    for (const changes of [{ commandKey: id }, { invoiceId: key }, { amountMinor: 30001 }]) {
      expect(() =>
        reconcileWholesaleReturn(pending, result, {
          ...current,
          applications: [{ ...current.applications[0]!, ...changes }],
        }),
      ).toThrow()
    }
  })
  it.each([null, '0047'])(
    'preserves exact cash/session or external-reference payout recovery (%s)',
    (referenceLastFour) => {
      const registerSessionId = referenceLastFour === null ? id : null
      const pending = pendingWholesaleReturnSchema.parse({
        operation: 'refund',
        key,
        payload: {
          creditNoteId: id,
          paymentMethodId: id,
          registerSessionId,
          referenceLastFour,
          payoutConfirmed: true,
          amountMinor: 60000,
          reason: 'Verified separate payout',
        },
      })
      const result = {
        payoutId: id,
        creditNoteId: id,
        paymentMethodId: id,
        registerSessionId,
        referenceLastFour,
        amountMinor: 60000,
      }
      const current = { ...history, payouts: [{ ...result, commandKey: key }] }
      expect(restoreWholesaleReturn(JSON.stringify(pending))).toEqual(pending)
      expect(() => reconcileWholesaleReturn(pending, result, current)).not.toThrow()
      expect(() => reconcileWholesaleReturn(pending, result, { ...current, payouts: [] })).toThrow()
      for (const changes of [
        { commandKey: id },
        { paymentMethodId: key },
        { amountMinor: 60001 },
        { referenceLastFour: '9999' },
        { registerSessionId: key },
      ]) {
        expect(() =>
          reconcileWholesaleReturn(pending, result, {
            ...current,
            payouts: [{ ...current.payouts[0]!, ...changes }],
          }),
        ).toThrow()
      }
    },
  )
  it('restores exactly the original key/body without inventing a replacement', () => {
    expect(restoreWholesaleReturn(JSON.stringify(command))).toEqual(command)
  })
  it('accepts only a matching response and independently authorized command history', () => {
    expect(() => reconcileWholesaleReturn(command, response, history)).not.toThrow()
    expect(() => reconcileWholesaleReturn(command, response, { ...history, notes: [] })).toThrow()
  })
  it.each([
    { refundId: key },
    { debtReductionMinor: 44999, issuedCreditMinor: 1 },
    { debtReductionMinor: 0, issuedCreditMinor: 45000 },
  ])('retains a return whose immutable reversal or settlement split disagrees with the response %j', (changes) => {
    const changed = wholesaleReturnsContextSchema.parse({
      ...history,
      notes: history.notes.map((row) => ({ ...row, ...changes })),
    })
    expect(() => reconcileWholesaleReturn(command, response, changed)).toThrow()
  })
  it('rejects another command with the same invoice and amount', () => {
    expect(() =>
      reconcileWholesaleReturn(command, response, {
        ...history,
        notes: history.notes.map((row) => ({ ...row, commandKey: crypto.randomUUID() })),
      }),
    ).toThrow()
  })
  it.each(['not-json', '{}', '{"operation":"refund","key":"guess"}'])(
    'fails closed for corrupted storage %s',
    (stored) => {
      expect(() => restoreWholesaleReturn(stored)).toThrow()
    },
  )
})
