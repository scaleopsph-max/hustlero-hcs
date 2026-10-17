/* global fetch, URL, AbortSignal */
import assert from 'node:assert/strict'
import { staging } from './staging-isolation-uat.mjs'
import { fundPlan } from './staging-fund-recovery-uat.mjs'
import { rollbackPlan, rollbackDraft } from './staging-paid-rollback-uat.mjs'
import { bFixture } from './staging-second-tenant-fixtures.mjs'

export const foreignFixture = Object.freeze({
  tenantId: bFixture.tenantId,
  locationId: bFixture.locationId,
  customerId: '1bcb909c-9fd9-4717-900f-0ee31a4da510',
  productId: '053e1b00-d090-4205-aaa7-cfbed204130a',
  variantId: 'b1632037-4281-4bff-afd2-c1023558753f',
  methodId: '634f2747-f324-4a63-aca0-93f385d684af',
  priceListId: '8d308627-1f2e-4abd-81d8-39c0f0fdc04c',
  orderId: '4eb62d0c-8fde-4196-80ab-687b5d7eab76',
  lineId: '9fec1176-5b9e-4f76-a6d1-e5be14c6bbe5',
  invoiceId: '2c4e1019-b313-4bd1-a376-d971c5cf3bf2',
  paymentId: '140fc133-5590-45f0-b2a3-33a7f570200e',
})
export const aOpenInvoice = '6363f7d5-9205-4c4e-9c03-15c0a91de2a0'
export const crossKey = (step) => `uat-cross-tenant-owner-20261014-${step}`
export const scopePaths = [
  '/v1/catalog',
  '/v1/customers',
  '/v1/pricing',
  '/v1/wholesale/orders',
  '/v1/wholesale/receivables',
  '/v1/wholesale/payments',
  '/v1/wholesale/credit-settings',
]
const reason =
  'Approved Staging foreign-reference denial only; no successful mutation, real collection or Production action'
const draft = (step, changes) => ({
  ...rollbackDraft,
  orderNumber: `ISO-DENY-20261014-${step}`,
  notes: reason,
  ...changes,
})
const payment = (changes) => ({
  customerId: rollbackPlan.customerId,
  paymentMethodId: rollbackPlan.methodId,
  amountMinor: 100,
  reference: 'UAT-FOREIGN-DENIAL-20261014',
  allocations: [{ invoiceId: aOpenInvoice, amountMinor: 100 }],
  ...changes,
})

export const ownerScopeCases = [
  {
    step: 'customer-read',
    path: `/v1/customers/${foreignFixture.customerId}`,
    method: 'GET',
    status: 404,
    code: 'CUSTOMER_NOT_FOUND',
  },
  {
    step: 'product-update',
    path: `/v1/catalog/products/${foreignFixture.productId}`,
    method: 'PATCH',
    body: {
      name: bFixture.product.name,
      description: bFixture.product.description,
      categoryName: bFixture.product.categoryName,
    },
    status: 404,
    code: 'PRODUCT_NOT_FOUND',
  },
  {
    step: 'draft-customer',
    path: '/v1/wholesale/orders',
    method: 'POST',
    body: draft('customer', { customerId: foreignFixture.customerId }),
    status: 400,
    code: 'INVALID_WHOLESALE_ORDER',
    scopeMessage: 'An active reseller customer is required',
  },
  {
    step: 'draft-location',
    path: '/v1/wholesale/orders',
    method: 'POST',
    body: draft('location', { locationId: foreignFixture.locationId }),
    status: 400,
    code: 'INVALID_WHOLESALE_ORDER',
    scopeMessage: 'The order location is unavailable',
  },
  {
    step: 'draft-price',
    path: '/v1/wholesale/orders',
    method: 'POST',
    body: draft('price', { priceListId: foreignFixture.priceListId }),
    status: 400,
    code: 'INVALID_WHOLESALE_ORDER',
    scopeMessage: 'The price list is unavailable',
  },
  {
    step: 'draft-variant',
    path: '/v1/wholesale/orders',
    method: 'POST',
    body: draft('variant', { lines: [{ variantId: foreignFixture.variantId, quantityMilli: 6000 }] }),
    status: 400,
    code: 'INVALID_WHOLESALE_ORDER',
    scopeMessage: 'An order item is unavailable in the price list',
  },
  {
    step: 'order-confirm',
    path: `/v1/wholesale/orders/${foreignFixture.orderId}/confirm`,
    method: 'POST',
    body: {},
    status: 404,
    code: 'WHOLESALE_ORDER_NOT_FOUND',
  },
  {
    step: 'order-fulfill',
    path: `/v1/wholesale/orders/${foreignFixture.orderId}/fulfill`,
    method: 'POST',
    body: { lines: [{ salesOrderLineId: foreignFixture.lineId, quantityMilli: 1000 }] },
    status: 404,
    code: 'WHOLESALE_ORDER_NOT_FOUND',
  },
  {
    step: 'order-cancel',
    path: `/v1/wholesale/orders/${foreignFixture.orderId}/cancel`,
    method: 'POST',
    body: { reason },
    status: 404,
    code: 'WHOLESALE_ORDER_NOT_FOUND',
  },
  {
    step: 'invoice-opening',
    path: '/v1/wholesale/receivables/opening',
    method: 'POST',
    body: { invoiceId: foreignFixture.invoiceId, dueDate: '2026-10-14', reason },
    status: 404,
    code: 'WHOLESALE_RECEIVABLE_HCAR3',
  },
  {
    step: 'payment-customer',
    path: '/v1/wholesale/payments',
    method: 'POST',
    body: payment({ customerId: foreignFixture.customerId }),
    status: 404,
    code: 'WHOLESALE_PAYMENT_HCAP3',
  },
  {
    step: 'payment-method',
    path: '/v1/wholesale/payments',
    method: 'POST',
    body: payment({ paymentMethodId: foreignFixture.methodId }),
    status: 404,
    code: 'WHOLESALE_PAYMENT_HCAP3',
  },
  {
    step: 'payment-invoice',
    path: '/v1/wholesale/payments',
    method: 'POST',
    body: payment({ allocations: [{ invoiceId: foreignFixture.invoiceId, amountMinor: 100 }] }),
    status: 404,
    code: 'WHOLESALE_PAYMENT_HCAP3',
  },
  {
    step: 'fund-receipt',
    path: '/v1/wholesale/funds',
    method: 'POST',
    body: {
      paymentId: foreignFixture.paymentId,
      capitalMinor: 100,
      operatingMinor: 0,
      settledConfirmed: true,
      settlementReference: 'SYNTHETIC-FOREIGN-DENIAL-20261014',
      reason,
    },
    status: 404,
    code: 'WHOLESALE_FUNDS_HCFD3',
  },
]

export function createCrossTenantOwnerRequest(token, transport = fetch) {
  assert.ok(token && !/[\r\n]/.test(token))
  return async ({ path, method = 'GET', body, idempotencyKey, tenantId = staging.tenantId }) => {
    const url = new URL(path, staging.api)
    assert.equal(url.origin, staging.api)
    const negative = ownerScopeCases.find(
      (row) =>
        row.path === path && row.method === method && (method === 'GET' || idempotencyKey === crossKey(row.step)),
    )
    if (negative) {
      assert.equal(tenantId, staging.tenantId, 'Foreign reference tests must select PABL0, never B')
      assert.deepEqual(body, negative.body)
      assert.equal(idempotencyKey, method === 'GET' ? undefined : crossKey(negative.step))
    } else {
      assert.equal(method, 'GET', 'Only exact foreign-reference denials allow commands')
      assert.ok([staging.tenantId, foreignFixture.tenantId].includes(tenantId))
      assert.ok(
        scopePaths.includes(path) ||
          (tenantId === staging.tenantId && ['/v1/me', '/v1/wholesale/funds'].includes(path)),
      )
      assert.equal(body, undefined)
      assert.equal(idempotencyKey, undefined)
    }
    const response = await transport(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
        ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json() }
  }
}

export async function runCrossTenantOwnerSuite(request, onCase = () => {}) {
  const evidence = []
  const record = (entry) => {
    evidence.push(entry)
    onCase(entry)
  }
  const get = async (path, tenantId = staging.tenantId) => {
    const r = await request({ path, tenantId })
    assert.equal(r.status, 200, 'Positive scope control unavailable; stop before denials')
    return r.data
  }
  const me = await get('/v1/me')
  assert.equal(me.userId, fundPlan.ownerId)
  assert.equal(me.tenants.length, 2)
  for (const tenantId of [staging.tenantId, foreignFixture.tenantId])
    assert.ok(me.tenants.some((row) => row.tenantId === tenantId && row.isOwner))
  record({
    name: 'Exact existing owner of two businesses; this is object-reference scope, not non-member denial',
    status: 200,
  })
  const a = new Map()
  const b = new Map()
  for (const path of scopePaths) {
    a.set(path, await get(path))
    b.set(path, await get(path, foreignFixture.tenantId))
  }
  const funds = await get('/v1/wholesale/funds')
  assert.equal(funds.canManage, true)
  assert.deepEqual(
    funds.funds.map((row) => row.balanceMinor).sort((x, y) => x - y),
    [30000, 50000],
  )
  const aOrders = a.get('/v1/wholesale/orders')
  const bOrders = b.get('/v1/wholesale/orders')
  assert.equal(aOrders.canManage, true)
  assert.equal(bOrders.canManage, true)
  assert.equal(aOrders.orders.length, 11)
  assert.equal(bOrders.orders.length, 1)
  assert.equal(bOrders.orders[0].id, foreignFixture.orderId)
  assert.equal(bOrders.orders[0].status, 'fulfilled')
  assert.equal(bOrders.invoices[0].id, foreignFixture.invoiceId)
  assert.equal(b.get('/v1/wholesale/payments').payments[0].paymentId, foreignFixture.paymentId)
  assert.equal(b.get('/v1/wholesale/receivables').invoices[0].openBalanceMinor, 0)
  assert.ok(
    a
      .get('/v1/customers')
      .customers.some((row) => row.id === rollbackPlan.customerId && row.customerType === 'reseller'),
  )
  assert.ok(aOrders.locations.some((row) => row.id === staging.otherBranchId))
  const list = a.get('/v1/pricing').priceLists.find((row) => row.id === rollbackPlan.priceListId)
  assert.ok(list?.isActive && (list.isDefault || list.customerIds.includes(rollbackPlan.customerId)))
  for (const variant of [rollbackPlan.firstVariant, rollbackPlan.secondVariant])
    assert.ok(list.entries.some((row) => row.variantId === variant))
  const open = a.get('/v1/wholesale/payments').invoices.find((row) => row.invoiceId === aOpenInvoice)
  assert.equal(open?.customerId, rollbackPlan.customerId)
  assert.ok(open.canAllocate && open.openBalanceMinor >= 100)
  assert.ok(a.get('/v1/wholesale/payments').paymentMethods.some((row) => row.id === rollbackPlan.methodId))
  for (const payload of a.values())
    for (const id of Object.values(foreignFixture))
      assert.ok(!JSON.stringify(payload).includes(id), 'PABL0 context exposes B identifiers')
  for (const payload of b.values())
    for (const id of [
      staging.tenantId,
      staging.otherBranchId,
      staging.branchId,
      rollbackPlan.customerId,
      rollbackPlan.firstVariant,
      rollbackPlan.secondVariant,
      rollbackPlan.priceListId,
      aOpenInvoice,
      rollbackPlan.methodId,
    ])
      assert.ok(!JSON.stringify(payload).includes(id), 'B context exposes PABL0 identifiers')
  record({
    name: 'Seven context families per business isolated; real B invoice/receipt and valid A controls verified',
    status: 200,
  })
  for (const row of ownerScopeCases) {
    const r = await request({
      path: row.path,
      method: row.method,
      ...(row.body ? { body: row.body } : {}),
      ...(row.method === 'GET' ? {} : { idempotencyKey: crossKey(row.step) }),
    })
    const entry = { name: row.step, status: r.status }
    if (typeof r.data?.error?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(r.data.error.code))
      entry.code = r.data.error.code
    if (typeof r.data?.error?.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(r.data.error.requestId))
      entry.requestId = r.data.error.requestId
    if (r.status !== row.status || entry.code !== row.code) {
      record({ ...entry, name: `${row.step}: unexpected outcome; reconcile before proceeding` })
      throw Error('Scope denial failed; no further commands sent')
    }
    assert.deepEqual(Object.keys(r.data), ['error'])
    assert.ok(entry.requestId)
    if (row.scopeMessage)
      assert.equal(r.data.error.message, row.scopeMessage, 'Generic payload validation is not foreign-scope evidence')
    for (const path of ['/v1/wholesale/orders', '/v1/wholesale/payments']) {
      assert.deepEqual(await get(path), a.get(path), 'PABL0 financial/inventory context changed')
      assert.deepEqual(await get(path, foreignFixture.tenantId), b.get(path), 'B financial/inventory context changed')
    }
    assert.deepEqual(await get('/v1/wholesale/funds'), funds)
    if (row.step === 'product-update')
      for (const [tenantId, baseline] of [
        [staging.tenantId, a],
        [foreignFixture.tenantId, b],
      ])
        assert.deepEqual(await get('/v1/catalog', tenantId), baseline.get('/v1/catalog'))
    record(entry)
  }
  for (const path of scopePaths) {
    assert.deepEqual(await get(path), a.get(path))
    assert.deepEqual(await get(path, foreignFixture.tenantId), b.get(path))
  }
  record({
    name: 'All enumerated owner scope denials passed; both business contexts unchanged. Restricted tester matrix and B suspension pending',
    status: 200,
  })
  return evidence
}
