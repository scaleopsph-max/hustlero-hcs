/* global fetch, URL, AbortSignal */
import assert from 'node:assert/strict'
import { staging } from './staging-isolation-uat.mjs'
import { fundPlan } from './staging-fund-recovery-uat.mjs'

export const bFixture = Object.freeze({
  tenantId: '3e9daa3a-dae7-4aac-a3bf-37dc00f33aba',
  locationId: 'd3a41aae-5ca8-4450-9d9c-2a22f074309f',
  orderNumber: 'SO-UAT-B-20261013-001',
  reason: 'Owner-approved synthetic second-tenant UAT B fixture; PHP 1 only; no real collection or Production money',
  profile: {
    step: 'business_questions',
    businessType: 'retail',
    salesChannels: ['wholesale'],
    tracksInventory: true,
    productSetupMethod: 'manual',
  },
  features: { step: 'feature_selection', enabledFeatures: ['inventory', 'customers', 'advanced_wholesale'] },
  customer: {
    fullName: 'UAT-B-RESELLER',
    email: 'uat-b-reseller@example.invalid',
    phone: null,
    customerGroupId: null,
    customerType: 'reseller',
    emailMarketingConsent: false,
    smsMarketingConsent: false,
  },
  product: {
    name: 'UAT B Isolation Item',
    description: 'Synthetic Staging isolation fixture, not real merchandise',
    categoryName: 'UAT B',
    variantName: 'Default',
    sku: 'UAT-B-00001',
    retailPriceMinor: 100,
    unitCostMinor: 0,
    trackInventory: true,
    barcodes: [],
  },
  method: { code: 'UAT-B-CASH', name: 'UAT B synthetic cash', methodType: 'cash' },
})
export const bKey = (step) => `uat-second-tenant-b-20261013-${step}`
const uuid = (value) =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const aPaths = [
  '/v1/catalog',
  '/v1/customers',
  '/v1/pricing',
  '/v1/wholesale/orders',
  '/v1/wholesale/receivables',
  '/v1/wholesale/payments',
  '/v1/wholesale/credit-settings',
  '/v1/wholesale/funds',
]
const bPaths = [
  '/v1/me',
  '/v1/onboarding',
  '/v1/catalog',
  '/v1/customers',
  '/v1/pricing',
  '/v1/register-operations',
  '/v1/wholesale/orders',
  '/v1/wholesale/payments',
  '/v1/wholesale/receivables',
]

export function bCommand(step, ids) {
  const requireId = (field) => {
    assert.ok(uuid(ids[field]), `Missing fixture binding: ${field}`)
    return ids[field]
  }
  switch (step) {
    case 'profile':
      return { path: '/v1/onboarding', method: 'PATCH', body: bFixture.profile }
    case 'features':
      return { path: '/v1/onboarding', method: 'PATCH', body: bFixture.features }
    case 'customer':
      return { path: '/v1/customers', method: 'POST', body: bFixture.customer }
    case 'product':
      return { path: '/v1/catalog/products', method: 'POST', body: bFixture.product }
    case 'method':
      return { path: '/v1/payment-methods', method: 'POST', body: bFixture.method }
    case 'pricing':
      return {
        path: '/v1/pricing/price-lists',
        method: 'POST',
        body: {
          code: 'UAT-B-WHOLESALE',
          name: 'UAT B wholesale',
          pricingType: 'wholesale',
          isDefault: true,
          isActive: true,
          pricingGroup: { code: 'UAT-B-GROUP', name: 'UAT B one-unit group', thresholdMilli: 1000 },
          customerIds: [requireId('customerId')],
          entries: [{ variantId: requireId('variantId'), unitPriceMinor: 100 }],
        },
      }
    case 'terms':
      return {
        path: '/v1/wholesale/credit-settings',
        method: 'POST',
        body: {
          customerId: requireId('customerId'),
          paymentTerm: 'net_7',
          creditLimitMinor: 100,
          reason: bFixture.reason,
        },
      }
    case 'opening':
      return {
        path: '/v1/inventory/opening-balances',
        method: 'POST',
        body: {
          locationId: bFixture.locationId,
          entries: [{ variantId: requireId('variantId'), quantityMilli: 1000, unitCostMinor: 0 }],
        },
      }
    case 'draft':
      return {
        path: '/v1/wholesale/orders',
        method: 'POST',
        body: {
          orderNumber: bFixture.orderNumber,
          customerId: requireId('customerId'),
          locationId: bFixture.locationId,
          priceListId: requireId('priceListId'),
          pricingType: 'wholesale',
          notes: bFixture.reason,
          lines: [{ variantId: requireId('variantId'), quantityMilli: 1000 }],
        },
      }
    case 'confirm':
      return { path: `/v1/wholesale/orders/${requireId('salesOrderId')}/confirm`, method: 'POST', body: {} }
    case 'fulfill':
      return {
        path: `/v1/wholesale/orders/${requireId('salesOrderId')}/fulfill`,
        method: 'POST',
        body: { lines: [{ salesOrderLineId: requireId('lineId'), quantityMilli: 1000 }] },
      }
    case 'payment':
      return {
        path: '/v1/wholesale/payments',
        method: 'POST',
        body: {
          customerId: requireId('customerId'),
          paymentMethodId: requireId('paymentMethodId'),
          amountMinor: 100,
          reference: 'UAT-B-SYNTHETIC-20261013-001',
          allocations: [{ invoiceId: requireId('invoiceId'), amountMinor: 100 }],
        },
      }
    default:
      throw Error('Unsupported fixture command')
  }
}

export function createBFixtureRequest(token, transport = fetch) {
  assert.ok(token && !/[\r\n]/.test(token))
  const ids = {}
  return async ({ path, method = 'GET', body, idempotencyKey, tenantId = bFixture.tenantId }) => {
    const url = new URL(path, staging.api)
    assert.equal(url.origin, staging.api)
    if (method === 'GET') {
      assert.ok(
        (tenantId === bFixture.tenantId && bPaths.includes(path)) ||
          (tenantId === staging.tenantId && aPaths.includes(path)),
      )
      assert.equal(body, undefined)
      assert.equal(idempotencyKey, undefined)
    } else {
      assert.equal(tenantId, bFixture.tenantId, 'No PABL0 write allowed')
      const prefix = bKey('')
      assert.ok(typeof idempotencyKey === 'string' && idempotencyKey.startsWith(prefix))
      const expected = bCommand(idempotencyKey.slice(prefix.length), ids)
      assert.deepEqual({ path, method, body }, expected, 'Exact fixed fixture command required')
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
    const data = await response.json()
    if (method !== 'GET' && response.status >= 200 && response.status < 300) {
      const bindings =
        {
          customer: ['customerId'],
          product: ['productId', 'variantId'],
          method: ['paymentMethodId'],
          pricing: ['priceListId', 'pricingGroupId'],
          draft: ['salesOrderId'],
          fulfill: ['invoiceId', 'saleId'],
          payment: ['paymentId'],
        }[idempotencyKey.slice(bKey('').length)] ?? []
      for (const field of bindings) {
        assert.ok(uuid(data[field]), 'Malformed fixture response; reconcile before retry')
        ids[field] = data[field]
      }
    }
    if (method === 'GET' && tenantId === bFixture.tenantId && path === '/v1/wholesale/orders' && ids.salesOrderId) {
      const row = data.orders?.find((row) => row.id === ids.salesOrderId)
      if (row) {
        assert.equal(row.locationId, bFixture.locationId)
        assert.equal(row.lines.length, 1)
        assert.equal(row.lines[0].variantId, ids.variantId)
        assert.ok(uuid(row.lines[0].id))
        ids.lineId = row.lines[0].id
      }
    }
    return { status: response.status, data }
  }
}

export async function runBFixtureSuite(request, onCase = () => {}, { reuseApprovedProfile = false } = {}) {
  assert.equal(typeof reuseApprovedProfile, 'boolean')
  const evidence = []
  const ids = {}
  const record = (entry) => {
    evidence.push(entry)
    onCase(entry)
  }
  const get = async (path, tenantId = bFixture.tenantId) => {
    const result = await request({ path, tenantId })
    if (result.status !== 200) recordFailure(`Read rejected: ${path}; no automatic retry`, result)
    assert.equal(result.status, 200, `Fixture read failed: ${path}; do not retry writes`)
    return result.data
  }
  function recordFailure(name, result) {
    const entry = { name, status: result.status }
    const error = result.data?.error
    if (typeof error?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.code)) entry.code = error.code
    if (uuid(error?.requestId)) entry.requestId = error.requestId
    record(entry)
  }
  const me = await get('/v1/me')
  assert.equal(me.userId, fundPlan.ownerId)
  assert.equal(me.tenants.length, 2)
  for (const id of [staging.tenantId, bFixture.tenantId])
    assert.ok(me.tenants.some((row) => row.tenantId === id && row.isOwner))
  const setup = await get('/v1/onboarding')
  assert.equal(setup.tenantId, bFixture.tenantId)
  for (const code of bFixture.features.enabledFeatures)
    assert.ok(
      setup.featureOptions.some((row) => row.code === code),
      'Active B prerequisites required before any write; no silent renewal',
    )
  const savedProfile = setup.businessProfile !== null
  if (savedProfile) {
    assert.equal(reuseApprovedProfile, true, 'Existing setup requires explicit resume approval, not automatic reseed')
    assert.deepEqual(
      setup.businessProfile,
      {
        businessType: bFixture.profile.businessType,
        salesChannels: bFixture.profile.salesChannels,
        tracksInventory: bFixture.profile.tracksInventory,
        productSetupMethod: bFixture.profile.productSetupMethod,
      },
      'Saved profile differs from exact approved fixture',
    )
    assert.ok(setup.steps.some((row) => row.code === 'business_questions' && row.status === 'complete'))
  }
  assert.ok(!setup.steps.some((row) => row.code === 'feature_selection' && row.status === 'complete'))
  const catalog = await get('/v1/catalog')
  assert.equal(catalog.products.length, 0)
  const methods = await get('/v1/register-operations')
  assert.equal(methods.paymentMethods.length, 4)
  assert.ok(methods.paymentMethods.every((row) => row.isSystemDefault && row.isActive))
  assert.deepEqual(methods.paymentMethods.map((row) => row.code).sort(), [
    'bank_transfer',
    'card_terminal',
    'cash',
    'e_wallet',
  ])
  const aBefore = new Map()
  for (const path of aPaths) aBefore.set(path, await get(path, staging.tenantId))
  record({
    name: savedProfile
      ? 'Exact B owner, approved saved profile reused without replay; empty catalog, seeded methods and PABL0 baselines'
      : 'Exact B owner, empty setup/catalog, four seeded system payment methods; PABL0 baselines captured',
    status: 200,
  })
  const command = async (step, status) => {
    const result = await request({ ...bCommand(step, ids), idempotencyKey: bKey(step) })
    if (result.status !== status) recordFailure(`${step}: fixture command rejected; independently reconcile`, result)
    assert.equal(result.status, status, `Fixture command ${step} failed; independently reconcile before resuming`)
    return result.data
  }
  if (!savedProfile) await command('profile', 200)
  await command('features', 200)
  const enabled = await get('/v1/onboarding')
  for (const code of bFixture.features.enabledFeatures)
    assert.ok(enabled.featureOptions.some((row) => row.code === code && row.enabled))
  assert.equal((await get('/v1/customers')).customers.length, 0)
  const initial = await get('/v1/wholesale/orders')
  assert.equal(initial.orders.length, 0)
  assert.equal(initial.invoices.length, 0)
  assert.equal(initial.inventory.length, 0)
  assert.equal((await get('/v1/wholesale/payments')).payments.length, 0)
  record({ name: 'B-only profile/features enabled; no preexisting financial or inventory fixture', status: 200 })
  Object.assign(ids, await command('customer', 201))
  Object.assign(ids, await command('product', 201))
  Object.assign(ids, await command('method', 201))
  Object.assign(ids, await command('pricing', 201))
  record({
    name: 'One synthetic B reseller/product/variant/method/price list created',
    status: 201,
    customerId: ids.customerId,
    productId: ids.productId,
    variantId: ids.variantId,
    paymentMethodId: ids.paymentMethodId,
    priceListId: ids.priceListId,
  })
  const terms = await command('terms', 201)
  assert.equal(terms.revision, 1)
  assert.equal(terms.creditLimitMinor, 100)
  const opening = await command('opening', 201)
  assert.equal(opening.movementCount, 1)
  const draft = await command('draft', 201)
  Object.assign(ids, { salesOrderId: draft.salesOrderId })
  assert.equal(draft.totalMinor, 100)
  assert.equal(draft.lineCount, 1)
  const context = await get('/v1/wholesale/orders')
  const order = context.orders.find((row) => row.id === ids.salesOrderId)
  assert.ok(order)
  assert.equal(order.locationId, bFixture.locationId)
  assert.equal(order.lines.length, 1)
  assert.equal(order.lines[0].variantId, ids.variantId)
  assert.equal(order.lines[0].orderedQuantityMilli, 1000)
  ids.lineId = order.lines[0].id
  record({
    name: 'One opening unit and PHP 1 draft; B-only Net 7/PHP 1 test limit, no PABL0 terms change',
    status: 201,
    salesOrderId: ids.salesOrderId,
    lineId: ids.lineId,
  })
  const confirmed = await command('confirm', 200)
  assert.equal(confirmed.totalMinor, 100)
  const issued = await command('fulfill', 201)
  assert.equal(issued.totalMinor, 100)
  assert.equal(issued.fulfilledQuantityMilli, 1000)
  assert.equal(issued.orderStatus, 'fulfilled')
  Object.assign(ids, { invoiceId: issued.invoiceId, saleId: issued.saleId })
  record({
    name: 'Exact one-unit PHP 1 B invoice fulfilled; append-only synthetic evidence',
    status: 201,
    invoiceId: ids.invoiceId,
    saleId: ids.saleId,
  })
  const payment = await command('payment', 201)
  assert.equal(payment.amountMinor, 100)
  assert.equal(payment.allocationCount, 1)
  ids.paymentId = payment.paymentId
  record({
    name: 'Exact PHP 1 synthetic B receipt allocated once; no real collection',
    status: 201,
    paymentId: ids.paymentId,
  })
  const final = await get('/v1/wholesale/orders')
  assert.equal(final.orders.length, 1)
  assert.equal(final.invoices.length, 1)
  assert.equal(final.orders[0].id, ids.salesOrderId)
  assert.equal(final.orders[0].status, 'fulfilled')
  assert.equal(final.invoices[0].id, ids.invoiceId)
  assert.equal(final.invoices[0].locationId, bFixture.locationId)
  assert.equal(final.invoices[0].totalMinor, 100)
  const inventory = final.inventory.find(
    (row) => row.variantId === ids.variantId && row.locationId === bFixture.locationId,
  )
  assert.ok(inventory)
  assert.equal(inventory.availableMilli, 0)
  assert.equal(inventory.onHandMilli, 0)
  assert.equal(inventory.reservedMilli, 0)
  const receipts = await get('/v1/wholesale/payments')
  assert.equal(receipts.payments.length, 1)
  assert.equal(receipts.payments[0].paymentId, ids.paymentId)
  assert.equal(receipts.payments[0].customerId, ids.customerId)
  assert.equal(receipts.payments[0].amountMinor, 100)
  assert.deepEqual(
    receipts.payments[0].allocations.map((row) => ({ invoiceId: row.invoiceId, amountMinor: row.amountMinor })),
    [{ invoiceId: ids.invoiceId, amountMinor: 100 }],
  )
  const receivables = await get('/v1/wholesale/receivables')
  assert.equal(receivables.invoices.length, 1)
  assert.equal(receivables.invoices[0].invoiceId, ids.invoiceId)
  assert.equal(receivables.invoices[0].openBalanceMinor, 0)
  for (const path of aPaths)
    assert.deepEqual(await get(path, staging.tenantId), aBefore.get(path), `PABL0 changed: ${path}`)
  record({
    name: 'One paid B invoice/receipt, zero remaining stock/debt; all PABL0 contexts unchanged. Isolation matrix and B suspension pending',
    status: 200,
  })
  return evidence
}
