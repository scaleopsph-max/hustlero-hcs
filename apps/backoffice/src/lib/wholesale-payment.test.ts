import { describe, it, expect } from 'vitest'
import { wholesalePaymentsContextSchema, type WholesalePaymentsContext } from '@hcs/contracts'
import {
  parsePaymentMoney,
  prepareWholesalePayment,
  paymentMoneyInput,
  paymentRejectedBeforePosting,
  restoreWholesalePayment,
  validateWholesalePaymentResponse,
  validateWholesalePaymentReceipt,
} from './wholesale-payment'

const customerId = '10000000-0000-4000-8000-000000000001'
const invoiceId = '20000000-0000-4000-8000-000000000001'
const methodId = '30000000-0000-4000-8000-000000000001'
const context: WholesalePaymentsContext = {
  canRecord: true,
  paymentMethods: [{ id: methodId, name: 'Cash' }],
  payments: [],
  invoices: [
    {
      invoiceId,
      invoiceNumber: 'INV-001',
      customerId,
      customerName: 'Synthetic reseller',
      locationId: methodId,
      locationName: 'Store',
      totalMinor: 225000,
      classification: 'invoice',
      eligibleForOpening: false,
      openBalanceMinor: 225000,
      dueDate: '2026-10-11',
      canAllocate: true,
    },
  ],
}
describe('wholesale payment entry', () => {
  it.each(['WHOLESALE_PAYMENT_HCAP1', 'WHOLESALE_PAYMENT_HCAP3', 'IDEMPOTENCY_KEY_CONFLICT', 'UNKNOWN'])(
    'retains retry identity after potentially completed outcome %s',
    (code) => expect(paymentRejectedBeforePosting(code)).toBe(false),
  )
  it.each(['WHOLESALE_PAYMENT_HCAP2', 'WHOLESALE_PAYMENT_HCAP4', 'WHOLESALE_PAYMENT_HCAP5'])(
    'allows correction only after definitive rejection %s',
    (code) => expect(paymentRejectedBeforePosting(code)).toBe(true),
  )
  it('restores exact maximum safe minor units without floating point rounding', () =>
    expect(paymentMoneyInput(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91'))
  it.each([
    ['0.01', 1],
    ['450', 45000],
    ['2250.50', 225050],
    [' 1.2 ', 120],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ])('parses exact money %s', (raw, minor) => expect(parsePaymentMoney(raw)).toBe(minor))
  it.each(['-1', '1.001', '1e3', 'NaN', '', '1,000', '90071992547409.92'])('rejects invalid money %s', (raw) =>
    expect(() => parsePaymentMoney(raw)).toThrow(),
  )
  it('prepares explicit partial allocation', () =>
    expect(
      prepareWholesalePayment(context, customerId, methodId, '100', 'Ref', { [invoiceId]: '100' }).amountMinor,
    ).toBe(10000))
  it('rejects mismatched received total', () =>
    expect(() =>
      prepareWholesalePayment(context, customerId, methodId, '101', 'Ref', { [invoiceId]: '100' }),
    ).toThrow())
  it('rejects over-allocation', () =>
    expect(() =>
      prepareWholesalePayment(context, customerId, methodId, '2251', 'Ref', { [invoiceId]: '2251' }),
    ).toThrow())
  it('rejects read-only entry', () =>
    expect(() =>
      prepareWholesalePayment({ ...context, canRecord: false }, customerId, methodId, '100', 'Ref', {
        [invoiceId]: '100',
      }),
    ).toThrow())
  it('rejects wrong customer', () =>
    expect(() => prepareWholesalePayment(context, methodId, methodId, '100', 'Ref', { [invoiceId]: '100' })).toThrow())
  it('rejects unavailable payment method', () =>
    expect(() =>
      prepareWholesalePayment(context, customerId, invoiceId, '100', 'Ref', { [invoiceId]: '100' }),
    ).toThrow())
  it('rejects missing branch permission', () =>
    expect(() =>
      prepareWholesalePayment(
        { ...context, invoices: context.invoices.map((item) => ({ ...item, canAllocate: false })) },
        customerId,
        methodId,
        '100',
        'Ref',
        { [invoiceId]: '100' },
      ),
    ).toThrow())
  it('validates receipt totals in history', () =>
    expect(() =>
      wholesalePaymentsContextSchema.parse({
        ...context,
        payments: [
          {
            paymentId: methodId,
            customerId,
            customerName: 'Synthetic',
            paymentMethodName: 'Cash',
            amountMinor: 10000,
            reference: 'Ref',
            recordedAt: '2026-10-11T01:00:00Z',
            allocations: [{ invoiceId, invoiceNumber: 'INV-001', amountMinor: 9999 }],
          },
        ],
      }),
    ).toThrow())
})

describe('payment response and saved-command recovery', () => {
  const secondInvoice = '20000000-0000-4000-8000-000000000002'
  const command = {
    key: 'wholesale-payment-10000000-0000-4000-8000-000000000001',
    request: {
      customerId,
      paymentMethodId: methodId,
      amountMinor: 10000,
      reference: 'Synthetic receipt',
      allocations: [
        { invoiceId, amountMinor: 6000 },
        { invoiceId: secondInvoice, amountMinor: 4000 },
      ],
    },
  }
  const response = {
    paymentId: methodId,
    customerId,
    amountMinor: 10000,
    allocationCount: 2,
    recordedAt: '2026-10-14T04:00:00Z',
  }
  const receipt = {
    paymentId: methodId,
    customerId,
    customerName: 'Synthetic reseller',
    paymentMethodName: 'Cash',
    amountMinor: 10000,
    reference: 'Synthetic receipt',
    recordedAt: response.recordedAt,
    allocations: command.request.allocations.map((row) => ({ ...row, invoiceNumber: row.invoiceId })),
  }
  const posted = { ...context, payments: [receipt] }

  it('preserves existing command identity/body through storage and accepts reordered receipt allocations', () => {
    expect(restoreWholesalePayment(null)).toBeNull()
    expect(restoreWholesalePayment(JSON.stringify(command))).toEqual(command)
    expect(validateWholesalePaymentResponse(command, response)).toEqual(response)
    expect(
      validateWholesalePaymentReceipt(command, methodId, {
        ...posted,
        payments: [{ ...receipt, allocations: [...receipt.allocations].reverse() }],
      }).paymentId,
    ).toBe(methodId)
  })
  it.each([
    '',
    '{',
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...command, key: 'bad' }),
    JSON.stringify({ ...command, unknown: true }),
    JSON.stringify({ ...command, request: { ...command.request, amountMinor: 10001 } }),
  ])('blocks corrupt payment recovery without creating a new key: %s', (stored) => {
    expect(() => restoreWholesalePayment(stored)).toThrow()
  })
  it.each([{ customerId: methodId }, { amountMinor: 10001 }, { allocationCount: 1 }])(
    'rejects a schema-valid mismatched receipt response %j',
    (change) => {
      expect(() => validateWholesalePaymentResponse(command, { ...response, ...change })).toThrow('does not match')
    },
  )
  it('does not clear pending recovery if receipt is absent from refreshed history', () => {
    expect(() => validateWholesalePaymentReceipt(command, methodId, context)).toThrow('does not match')
  })
  it.each([
    { paymentId: invoiceId },
    { customerId: methodId },
    { amountMinor: 10001 },
    { reference: 'Other receipt' },
    { allocations: [{ ...receipt.allocations[0]!, invoiceId: methodId }, receipt.allocations[1]!] },
    {
      allocations: [
        { ...receipt.allocations[0]!, amountMinor: 5000 },
        { ...receipt.allocations[1]!, amountMinor: 5000 },
      ],
    },
    { allocations: [receipt.allocations[0]!, receipt.allocations[0]!] },
    { allocations: [receipt.allocations[0]!] },
  ])('rejects schema-valid wrong receipt/reference/allocations before recovery is cleared %j', (change) => {
    expect(() =>
      validateWholesalePaymentReceipt(command, methodId, {
        ...posted,
        payments: [{ ...receipt, ...change }],
      }),
    ).toThrow('does not match')
  })
})
