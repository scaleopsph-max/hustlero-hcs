import { describe, it, expect } from 'vitest'
import {
  pendingCreditCommandSchema,
  prepareCreditSettings,
  prepareOpeningReceivable,
  creditCommandDefinitivelyRejected,
  validateCreditCommandResponse,
} from './wholesale-credit-commands'
const id = '30000000-0000-4000-8000-000000000001',
  other = '30000000-0000-4000-8000-000000000002'
const credit = {
  canManage: true,
  customers: [{ customerId: id, customerName: 'Synthetic', customerNumber: 'SYN-001', settings: null }],
}
const opening = {
  canRecordOpening: true,
  invoices: [
    {
      invoiceId: id,
      invoiceNumber: 'SYN-INV',
      customerId: id,
      customerName: 'Synthetic',
      locationId: id,
      locationName: 'Main',
      totalMinor: 225000,
      classification: 'unclassified' as const,
      eligibleForOpening: true,
      openBalanceMinor: null,
      dueDate: null,
    },
  ],
}
const settingsPayload = {
  customerId: id,
  paymentTerm: 'net_7' as const,
  creditLimitMinor: 450000,
  reason: 'Owner confirmed credit',
}
const openingPayload = { invoiceId: id, dueDate: '2026-10-11', reason: 'Verified unpaid invoice' }
const settingsCommand = { kind: 'settings' as const, key: 'synthetic-credit-key-001', payload: settingsPayload }
const openingCommand = { kind: 'opening' as const, key: 'synthetic-opening-key-001', payload: openingPayload }
const settingsResponse = { settingsId: id, ...settingsPayload, revision: 1, recordedAt: '2026-10-11T04:00:00Z' }
const openingResponse = { chargeId: id, invoiceId: id, dueDate: '2026-10-11', amountMinor: 225000, status: 'unpaid' }
describe('wholesale credit command UI rules', () => {
  it.each(['prepaid', 'cod', 'net_7', 'net_15', 'net_30'])('accepts explicit %s terms and exact centavos', (term) => {
    expect(prepareCreditSettings(credit, id, term, '4500.01', 'Confirmed')).toEqual({
      customerId: id,
      paymentTerm: term,
      creditLimitMinor: 450001,
      reason: 'Confirmed',
    })
  })
  it('allows explicit zero credit, not unlimited credit', () =>
    expect(prepareCreditSettings(credit, id, 'cod', '0', 'Confirmed').creditLimitMinor).toBe(0))
  it.each(['-1', '1.001', 'NaN', '90071992547409.92'])('rejects invalid limit %s', (limit) =>
    expect(() => prepareCreditSettings(credit, id, 'net_7', limit, 'Confirmed')).toThrow(),
  )
  it('does not grant managers implicitly', () =>
    expect(() => prepareCreditSettings({ ...credit, canManage: false }, id, 'net_7', '1', 'Confirmed')).toThrow())
  it('denies an unlisted customer', () =>
    expect(() => prepareCreditSettings(credit, other, 'net_7', '1', 'Confirmed')).toThrow())
  it('requires explicit payment terms', () =>
    expect(() => prepareCreditSettings(credit, id, '', '1', 'Confirmed')).toThrow())
  it('prepares opening without client amount or tenant', () =>
    expect(prepareOpeningReceivable(opening, id, '2026-10-11', 'Verified unpaid invoice', true)).toEqual(
      openingPayload,
    ))
  it('requires unpaid confirmation', () =>
    expect(() => prepareOpeningReceivable(opening, id, '2026-10-11', 'Confirmed', false)).toThrow())
  it('denies reader opening command', () =>
    expect(() =>
      prepareOpeningReceivable({ ...opening, canRecordOpening: false }, id, '2026-10-11', 'Confirmed', true),
    ).toThrow())
  it('rejects already-classified invoices', () =>
    expect(() =>
      prepareOpeningReceivable(
        {
          ...opening,
          invoices: [
            {
              ...opening.invoices[0]!,
              classification: 'opening',
              eligibleForOpening: false,
              openBalanceMinor: 225000,
              dueDate: '2026-10-11',
            },
          ],
        },
        id,
        '2026-10-11',
        'Confirmed',
        true,
      ),
    ).toThrow())
  it('rejects unknown or ineligible invoices', () =>
    expect(() => prepareOpeningReceivable(opening, other, '2026-10-11', 'Confirmed', true)).toThrow())
  it('rejects zero opening', () =>
    expect(() =>
      prepareOpeningReceivable(
        { ...opening, invoices: [{ ...opening.invoices[0]!, totalMinor: 0 }] },
        id,
        '2026-10-11',
        'Confirmed',
        true,
      ),
    ).toThrow())
  it('requires valid due date and reason', () =>
    expect(() => prepareOpeningReceivable(opening, id, '2026-02-30', 'x', true)).toThrow())
  it.each([settingsCommand, openingCommand])('restores exact pending identity', (command) =>
    expect(pendingCreditCommandSchema.parse(command)).toEqual(command),
  )
  it('rejects corrupted pending identity', () =>
    expect(pendingCreditCommandSchema.safeParse({ ...settingsCommand, key: 'bad' }).success).toBe(false))
  it('rejects tampered tenant/amount in opening payload', () =>
    expect(
      pendingCreditCommandSchema.safeParse({
        ...openingCommand,
        payload: { ...openingPayload, tenantId: id, amountMinor: 1 },
      }).success,
    ).toBe(false))
  it.each([
    'WHOLESALE_CREDIT_HCCS1',
    'WHOLESALE_CREDIT_HCCS3',
    'WHOLESALE_CREDIT_HCAR1',
    'WHOLESALE_IDEMPOTENCY_CONFLICT',
    undefined,
  ])('retains settings replay for %s', (code) =>
    expect(creditCommandDefinitivelyRejected('settings', code)).toBe(false),
  )
  it('releases settings only after definite validation rejection', () =>
    expect(creditCommandDefinitivelyRejected('settings', 'WHOLESALE_CREDIT_HCCS2')).toBe(true))
  it.each(['WHOLESALE_RECEIVABLE_HCAR1', 'WHOLESALE_RECEIVABLE_HCAR3', 'WHOLESALE_IDEMPOTENCY_CONFLICT', undefined])(
    'retains opening replay for %s',
    (code) => expect(creditCommandDefinitivelyRejected('opening', code)).toBe(false),
  )
  it.each(['WHOLESALE_RECEIVABLE_HCAR2', 'WHOLESALE_RECEIVABLE_HCAR4'])(
    'releases definitely rejected opening for %s',
    (code) => expect(creditCommandDefinitivelyRejected('opening', code)).toBe(true),
  )
  it('accepts matching settings response', () =>
    expect(validateCreditCommandResponse(settingsCommand, settingsResponse)).toMatchObject({
      revision: 1,
      creditLimitMinor: 450000,
    }))
  it('accepts matching server-derived opening amount', () =>
    expect(validateCreditCommandResponse(openingCommand, openingResponse)).toMatchObject({
      amountMinor: 225000,
      status: 'unpaid',
    }))
  it.each([
    { ...settingsResponse, customerId: other },
    { ...settingsResponse, paymentTerm: 'cod' },
    { ...settingsResponse, creditLimitMinor: 1 },
  ])('retains mismatched settings response', (response) =>
    expect(() => validateCreditCommandResponse(settingsCommand, response)).toThrow(),
  )
  it.each([
    { ...openingResponse, invoiceId: other },
    { ...openingResponse, dueDate: '2026-10-12' },
    { ...openingResponse, amountMinor: 0 },
  ])('rejects invalid opening response', (response) =>
    expect(() => validateCreditCommandResponse(openingCommand, response)).toThrow(),
  )
})
