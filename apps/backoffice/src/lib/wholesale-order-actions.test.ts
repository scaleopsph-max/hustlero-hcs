import { describe, it, expect } from 'vitest'
import { type WholesaleCreditOverridesContext, type WholesaleOrderContext } from '@hcs/contracts'
import {
  pendingOrderActionSchema,
  eligibleOrderOverrides,
  prepareOrderOverride,
  prepareCreditFulfillment,
  restoreOrderAction,
  orderActionDefinitivelyRejected,
  validateOrderActionResponse,
  validatePaidFulfillmentInvoice,
} from './wholesale-order-actions'
const id = '30000000-0000-4000-8000-000000000001',
  other = '30000000-0000-4000-8000-000000000002'
const time = '2026-10-11T04:00:00Z',
  now = Date.parse(time)
const order: WholesaleOrderContext['orders'][number] = {
  id,
  orderNumber: 'SYN-001',
  customerId: id,
  customerName: 'Synthetic',
  locationId: id,
  locationName: 'Main',
  priceListId: id,
  pricingType: 'wholesale',
  status: 'confirmed',
  notes: null,
  subtotalMinor: 450000,
  totalMinor: 450000,
  confirmedAt: time,
  createdAt: time,
  lines: [
    {
      id,
      variantId: id,
      productName: 'Shirt',
      variantName: 'Medium',
      sku: 'SYN',
      orderedQuantityMilli: 10000,
      fulfilledQuantityMilli: 4000,
      cancelledQuantityMilli: 1000,
      unitPriceMinor: 45000,
      lineTotalMinor: 450000,
    },
  ],
}
const approval: WholesaleCreditOverridesContext['overrides'][number] = {
  overrideId: id,
  salesOrderId: id,
  orderNumber: 'SYN-001',
  status: 'approved',
  consumption: null,
  customerId: id,
  action: 'confirm',
  approvedExcessMinor: 10001,
  expiresAt: '2099-10-12T04:00:00Z',
  reason: 'Authorized exception',
  approvedBy: id,
  approvedAt: time,
  revokedBy: null,
  revokedAt: null,
  revokeReason: null,
}
const context = { asOf: time, canApprove: false, overrides: [approval] }
const confirm = {
  kind: 'confirm' as const,
  orderId: id,
  key: 'synthetic-confirm-key-001',
  payload: { creditOverrideId: id },
}
const fulfill = {
  kind: 'fulfill' as const,
  orderId: id,
  key: 'synthetic-fulfill-key-001',
  payload: { lines: [{ salesOrderLineId: id, quantityMilli: 1125 }], creditOverrideId: id },
}
describe('wholesale order action selection and recovery', () => {
  it('lets an operator use an existing matching approval without approval authority', () =>
    expect(eligibleOrderOverrides(context, order, 'confirm', now)).toEqual([approval]))
  it.each([
    { salesOrderId: other },
    { customerId: other },
    { action: 'fulfill' as const },
    { status: 'expired' as const },
    { status: 'revoked' as const },
    { status: 'consumed' as const },
    { expiresAt: time },
    { revokedAt: time },
    { consumption: { consumedBy: id, consumedAt: time, excessMinor: 1, exposureMinor: 2, creditLimitMinor: 1 } },
  ])('omits unavailable/mismatched approval %j', (change) =>
    expect(
      eligibleOrderOverrides({ ...context, overrides: [{ ...approval, ...change }] }, order, 'confirm', now),
    ).toEqual([]),
  )
  it('does not automatically choose an exception', () =>
    expect(prepareOrderOverride(context, order, 'confirm', '')).toEqual({}))
  it('sends only the selected approval ID', () =>
    expect(prepareOrderOverride(context, order, 'confirm', id)).toEqual({ creditOverrideId: id }))
  it('rejects stale or other-action selection', () =>
    expect(() => prepareOrderOverride(context, order, 'fulfill', id)).toThrow())
  it('parses regular fulfillment exactly', () =>
    expect(prepareCreditFulfillment(order, { [id]: '1.125' }, { creditOverrideId: id })).toEqual(fulfill.payload))
  it.each(['1.0001', '1e3', '-1', '5.001', '9007199254740992', 'x'])('rejects invalid/excess quantity %s', (value) =>
    expect(() => prepareCreditFulfillment(order, { [id]: value }, {})).toThrow(),
  )
  it('requires nonzero quantities', () => expect(() => prepareCreditFulfillment(order, { [id]: '0' }, {})).toThrow())
  it.each([confirm, fulfill])('restores exact action and approval identity', (command) =>
    expect(restoreOrderAction(JSON.stringify(command), null)).toEqual(command),
  )
  it('restores legacy paid fulfillment without changing key or payload', () => {
    const legacy = {
      orderId: id,
      key: fulfill.key,
      payload: {
        lines: fulfill.payload.lines,
        payment: { paymentMethodId: id, amountMinor: 50625, reference: 'Received cash' },
      },
    }
    expect(restoreOrderAction(null, JSON.stringify(legacy))).toEqual({ kind: 'fulfill', ...legacy })
  })
  it('refuses conflicting old/new recovery records', () =>
    expect(() => restoreOrderAction(JSON.stringify(confirm), JSON.stringify(fulfill))).toThrow())
  it('does not reinterpret legacy unpaid fulfillment', () =>
    expect(() =>
      restoreOrderAction(
        null,
        JSON.stringify({ orderId: id, key: fulfill.key, payload: { lines: fulfill.payload.lines } }),
      ),
    ).toThrow())
  it('rejects corrupt storage', () => expect(() => restoreOrderAction('{', null)).toThrow())
  it('rejects scope injection', () =>
    expect(
      pendingOrderActionSchema.safeParse({ ...confirm, payload: { ...confirm.payload, tenantId: id } }).success,
    ).toBe(false))
  it('rejects paid and override together', () =>
    expect(
      pendingOrderActionSchema.safeParse({
        ...fulfill,
        payload: { ...fulfill.payload, payment: { paymentMethodId: id, amountMinor: 1, reference: 'Cash' } },
      }).success,
    ).toBe(false))
  it.each([
    undefined,
    'WHOLESALE_ORDER_ACCESS_DENIED',
    'WHOLESALE_ORDER_NOT_FOUND',
    'WHOLESALE_ORDER_STATUS_CONFLICT',
    'IDEMPOTENCY_KEY_CONFLICT',
    'WHOLESALE_CREDIT_HCCR2',
  ])('retains uncertain recovery %s', (code) => expect(orderActionDefinitivelyRejected(confirm, code)).toBe(false))
  it.each(['WHOLESALE_OVERRIDE_HCCO6', 'WHOLESALE_CREDIT_HCCR1', 'WHOLESALE_CREDIT_HCCR3', 'WHOLESALE_CREDIT_HCCR4'])(
    'unlocks definite command rollback %s',
    (code) => expect(orderActionDefinitivelyRejected(confirm, code)).toBe(true),
  )
  it('validates confirmation order identity', () =>
    expect(
      validateOrderActionResponse(confirm, {
        salesOrderId: id,
        status: 'confirmed',
        reservedLineCount: 1,
        totalMinor: 450000,
      }).salesOrderId,
    ).toBe(id))
  it('rejects another confirmed order', () =>
    expect(() =>
      validateOrderActionResponse(confirm, {
        salesOrderId: other,
        status: 'confirmed',
        reservedLineCount: 1,
        totalMinor: 450000,
      }),
    ).toThrow())
  const invoice = {
    salesOrderId: id,
    orderStatus: 'partially_fulfilled',
    invoiceId: id,
    invoiceNumber: 'SYN-INV',
    saleId: id,
    fulfilledQuantityMilli: 1125,
    totalMinor: 50625,
    issuedAt: time,
  }
  it('validates delivered quantity', () => expect(validateOrderActionResponse(fulfill, invoice)).toEqual(invoice))
  it('rejects a wrong delivered quantity', () =>
    expect(() => validateOrderActionResponse(fulfill, { ...invoice, fulfilledQuantityMilli: 1000 })).toThrow())
  it('rejects another fulfilled order', () =>
    expect(() => validateOrderActionResponse(fulfill, { ...invoice, salesOrderId: other })).toThrow())
  const paid = {
    ...fulfill,
    payload: {
      lines: fulfill.payload.lines,
      payment: { paymentMethodId: id, amountMinor: 50625, reference: 'Synthetic received cash' },
    },
  }
  const savedInvoice: WholesaleOrderContext['invoices'][number] = {
    id,
    invoiceNumber: invoice.invoiceNumber,
    salesOrderId: id,
    orderNumber: order.orderNumber,
    saleId: id,
    customerId: id,
    customerName: order.customerName,
    locationId: id,
    locationName: order.locationName,
    totalMinor: invoice.totalMinor,
    issuedAt: time,
    lines: [
      {
        id,
        salesOrderLineId: id,
        saleLineId: id,
        variantId: id,
        productName: 'Shirt',
        variantName: 'Medium',
        sku: 'SYN',
        quantityMilli: 1125,
        unitPriceMinor: 45000,
        lineTotalMinor: 50625,
      },
    ],
  }
  const history = {
    canManage: true,
    customers: [],
    locations: [],
    variants: [],
    inventory: [],
    priceLists: [],
    orders: [order],
    invoices: [savedInvoice],
  }
  it('accepts matching paid amount and authorized immutable invoice', () =>
    expect(validatePaidFulfillmentInvoice(paid, invoice, history)).toEqual(invoice))
  it.each([0, 50624, 50626])('rejects schema-valid wrong paid invoice amount %s', (totalMinor) =>
    expect(() => validateOrderActionResponse(paid, { ...invoice, totalMinor })).toThrow(/original payment/),
  )
  it.each([
    { salesOrderId: other },
    { saleId: other },
    { customerId: other },
    { locationId: other },
    { invoiceNumber: 'Other invoice' },
    { totalMinor: 50624 },
    { issuedAt: '2026-10-11T04:00:01Z' },
    { lines: [{ ...savedInvoice.lines[0], salesOrderLineId: other }] },
    { lines: [{ ...savedInvoice.lines[0], quantityMilli: 1124 }] },
    { lines: [] },
    { lines: [savedInvoice.lines[0], savedInvoice.lines[0]] },
  ])('rejects mismatched authorized invoice %j', (change) =>
    expect(() =>
      validatePaidFulfillmentInvoice(paid, invoice, { ...history, invoices: [{ ...savedInvoice, ...change }] }),
    ).toThrow(),
  )
  it.each([{ invoices: [] }, { invoices: [savedInvoice, savedInvoice] }, { orders: [] }, { invoices: null }])(
    'retains ambiguous recovery on missing/duplicate/invalid history %j',
    (change) => {
      const stored = JSON.stringify(paid)
      expect(() => validatePaidFulfillmentInvoice(paid, invoice, { ...history, ...change })).toThrow()
      expect(restoreOrderAction(stored, null)).toEqual(paid)
      expect(orderActionDefinitivelyRejected(paid, undefined)).toBe(false)
    },
  )
  it('accepts equivalent timestamp offsets and later cancelled order state for exact replay', () =>
    expect(
      validatePaidFulfillmentInvoice(paid, invoice, {
        ...history,
        orders: [{ ...order, status: 'cancelled' }],
        invoices: [{ ...savedInvoice, issuedAt: '2026-10-11T12:00:00+08:00' }],
      }),
    ).toEqual(invoice))
  it('does not impose paid reconciliation on ordinary credit commands', () => {
    expect(validateOrderActionResponse(fulfill, invoice)).toEqual(invoice)
    expect(() => validatePaidFulfillmentInvoice(fulfill, invoice, history)).toThrow(/Paid fulfillment/)
  })
})
