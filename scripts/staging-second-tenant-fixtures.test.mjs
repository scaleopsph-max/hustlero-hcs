/* global structuredClone */
import test from 'node:test'
import assert from 'node:assert/strict'
import { bFixture, bCommand, bKey, createBFixtureRequest, runBFixtureSuite } from './staging-second-tenant-fixtures.mjs'
import { staging } from './staging-isolation-uat.mjs'
import { fundPlan } from './staging-fund-recovery-uat.mjs'

const id = (n) => `82000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const bindings = {
  customerId: id(1),
  productId: id(2),
  variantId: id(3),
  paymentMethodId: id(4),
  priceListId: id(5),
  pricingGroupId: id(6),
  salesOrderId: id(7),
  lineId: id(8),
  invoiceId: id(9),
  saleId: id(10),
  paymentId: id(11),
}
const sequence = [
  'profile',
  'features',
  'customer',
  'product',
  'method',
  'pricing',
  'terms',
  'opening',
  'draft',
  'confirm',
  'fulfill',
  'payment',
]

test('expired prerequisite stops before even a business profile write', async () => {
  const mock = fixture({ expired: true })
  await assert.rejects(() => runBFixtureSuite(mock.request), /Active B prerequisites required before any write/)
  assert.deepEqual(mock.mutations, [])
})

test('explicit approved resume skips exact saved profile; unrelated saved profile is never overwritten', async () => {
  const mock = fixture({ exactSavedProfile: true })
  await assert.rejects(() => runBFixtureSuite(mock.request), /explicit resume approval/)
  assert.deepEqual(mock.mutations, [])
  const resumed = await runBFixtureSuite(mock.request, undefined, { reuseApprovedProfile: true })
  assert.match(resumed[0].name, /saved profile reused without replay/)
  assert.deepEqual(
    mock.mutations,
    sequence.filter((step) => step !== 'profile'),
  )
  const changed = fixture({ existingSetup: true })
  await assert.rejects(
    () => runBFixtureSuite(changed.request, undefined, { reuseApprovedProfile: true }),
    /Saved profile differs/,
  )
  assert.deepEqual(changed.mutations, [])
})

function fixture({
  owner = true,
  existingSetup = false,
  failStep = null,
  driftA = false,
  expired = false,
  exactSavedProfile = false,
} = {}) {
  const completed = new Set()
  const mutations = []
  const request = async ({ path, method = 'GET', body, idempotencyKey, tenantId = bFixture.tenantId }) => {
    if (method !== 'GET') {
      const step = idempotencyKey.slice(bKey('').length)
      assert.deepEqual({ path, method, body }, bCommand(step, bindings))
      assert.equal(tenantId, bFixture.tenantId)
      mutations.push(step)
      if (step === failStep)
        return {
          status: 409,
          data: {
            error: { code: 'TEST_FAILURE', requestId: id(99), message: 'Sensitive error text must not be retained' },
          },
        }
      completed.add(step)
      const responses = {
        profile: {},
        features: {},
        customer: { customerId: bindings.customerId },
        product: { productId: bindings.productId, variantId: bindings.variantId },
        method: { paymentMethodId: bindings.paymentMethodId },
        pricing: { priceListId: bindings.priceListId, pricingGroupId: bindings.pricingGroupId },
        terms: { revision: 1, creditLimitMinor: 100 },
        opening: { movementCount: 1 },
        draft: { salesOrderId: bindings.salesOrderId, totalMinor: 100, lineCount: 1 },
        confirm: { totalMinor: 100 },
        fulfill: {
          totalMinor: 100,
          fulfilledQuantityMilli: 1000,
          orderStatus: 'fulfilled',
          invoiceId: bindings.invoiceId,
          saleId: bindings.saleId,
        },
        payment: { amountMinor: 100, allocationCount: 1, paymentId: bindings.paymentId },
      }
      return { status: ['profile', 'features', 'confirm'].includes(step) ? 200 : 201, data: responses[step] }
    }
    if (tenantId === staging.tenantId)
      return { status: 200, data: { syntheticControl: path, changed: driftA && completed.has('payment') } }
    let data
    if (path === '/v1/me')
      data = {
        userId: owner ? fundPlan.ownerId : staging.userId,
        tenants: [
          { tenantId: staging.tenantId, isOwner: true },
          { tenantId: bFixture.tenantId, isOwner: true },
        ],
      }
    else if (path === '/v1/onboarding')
      data = {
        tenantId: bFixture.tenantId,
        businessProfile:
          existingSetup || completed.has('profile') || exactSavedProfile
            ? {
                businessType: existingSetup ? 'services' : 'retail',
                salesChannels: ['wholesale'],
                tracksInventory: true,
                productSetupMethod: 'manual',
              }
            : null,
        steps: [
          {
            code: 'business_questions',
            status: existingSetup || exactSavedProfile || completed.has('profile') ? 'complete' : 'pending',
          },
          { code: 'feature_selection', status: completed.has('features') ? 'complete' : 'pending' },
        ],
        featureOptions: bFixture.features.enabledFeatures
          .filter((code) => !expired || code !== 'advanced_wholesale')
          .map((code) => ({ code, enabled: completed.has('features') })),
      }
    else if (path === '/v1/catalog') data = { products: [] }
    else if (path === '/v1/register-operations')
      data = {
        paymentMethods: ['cash', 'e_wallet', 'bank_transfer', 'card_terminal'].map((code) => ({
          code,
          isActive: true,
          isSystemDefault: true,
        })),
      }
    else if (path === '/v1/customers') data = { customers: [] }
    else if (path === '/v1/wholesale/payments')
      data = {
        payments: completed.has('payment')
          ? [
              {
                paymentId: bindings.paymentId,
                customerId: bindings.customerId,
                amountMinor: 100,
                allocations: [{ invoiceId: bindings.invoiceId, amountMinor: 100 }],
              },
            ]
          : [],
      }
    else if (path === '/v1/wholesale/receivables')
      data = { invoices: [{ invoiceId: bindings.invoiceId, openBalanceMinor: completed.has('payment') ? 0 : 100 }] }
    else if (path === '/v1/wholesale/orders')
      data = {
        orders: completed.has('draft')
          ? [
              {
                id: bindings.salesOrderId,
                locationId: bFixture.locationId,
                status: completed.has('fulfill') ? 'fulfilled' : 'draft',
                lines: [{ id: bindings.lineId, variantId: bindings.variantId, orderedQuantityMilli: 1000 }],
              },
            ]
          : [],
        invoices: completed.has('fulfill')
          ? [{ id: bindings.invoiceId, locationId: bFixture.locationId, totalMinor: 100 }]
          : [],
        inventory: completed.has('opening')
          ? [
              {
                locationId: bFixture.locationId,
                variantId: bindings.variantId,
                availableMilli: completed.has('fulfill') ? 0 : 1000,
                onHandMilli: completed.has('fulfill') ? 0 : 1000,
                reservedMilli: 0,
              },
            ]
          : [],
      }
    else throw Error(`Unmocked read ${path}`)
    return { status: 200, data: structuredClone(data) }
  }
  return { request, mutations }
}

test('approved fixture suite creates only one-unit/PHP 1 B evidence, preserves seeded methods and PABL0 contexts', async () => {
  const mock = fixture()
  const progress = []
  const result = await runBFixtureSuite(mock.request, (entry) => progress.push(entry))
  assert.deepEqual(mock.mutations, sequence)
  assert.equal(result.length, 7)
  assert.deepEqual(progress, result)
  assert.equal(result[5].paymentId, bindings.paymentId)
})

test('wrong owner or preexisting setup stops before writes', async () => {
  for (const mock of [fixture({ owner: false }), fixture({ existingSetup: true })]) {
    await assert.rejects(() => runBFixtureSuite(mock.request))
    assert.deepEqual(mock.mutations, [])
  }
})

test('failed financial command is not retried, concealed or followed by a payment', async () => {
  const mock = fixture({ failStep: 'fulfill' })
  const progress = []
  await assert.rejects(() => runBFixtureSuite(mock.request, (entry) => progress.push(entry)), /independently reconcile/)
  assert.equal(mock.mutations.filter((step) => step === 'fulfill').length, 1)
  assert.ok(!mock.mutations.includes('payment'))
  assert.equal(progress.length, 5)
  assert.deepEqual(progress[4], {
    name: 'fulfill: fixture command rejected; independently reconcile',
    status: 409,
    code: 'TEST_FAILURE',
    requestId: id(99),
  })
  assert.ok(!JSON.stringify(progress).includes('Sensitive error text'))
})

test('PABL0 business-context drift fails after the bounded B fixture instead of claiming isolation pass', async () => {
  const mock = fixture({ driftA: true })
  await assert.rejects(() => runBFixtureSuite(mock.request), /PABL0 changed/)
  assert.deepEqual(mock.mutations, sequence)
})

test('transport rejects non-Staging targets, PABL0 writes, unbound IDs, changed amounts and unrelated cleanup', async () => {
  let calls = 0
  const request = createBFixtureRequest('synthetic-test-token', async () => {
    calls++
    return { status: 200, json: async () => ({}) }
  })
  const profile = { ...bCommand('profile', {}), idempotencyKey: bKey('profile') }
  for (const input of [
    { path: 'https://hustlero-hcs-api.scaleopsph.workers.dev/v1/me' },
    { path: '/v1/../v1/me' },
    { ...profile, tenantId: staging.tenantId },
    { ...profile, body: { ...bFixture.profile, salesChannels: ['online'] } },
    { ...bCommand('payment', bindings), idempotencyKey: bKey('payment') },
    { ...profile, path: '/v1/platform/tenants/x/status' },
    { ...profile, idempotencyKey: bKey('unknown') },
  ])
    await assert.rejects(() => request(input))
  assert.equal(calls, 0)
})

test('transport binds response IDs and validates the same approved live sequence with B-only write headers', async () => {
  const mock = fixture()
  const request = createBFixtureRequest('synthetic-test-token', async (url, init) => {
    assert.equal(url.origin, staging.api)
    assert.equal(init.redirect, 'error')
    const result = await mock.request({
      path: url.pathname,
      method: init.method,
      ...(init.body ? { body: JSON.parse(init.body) } : {}),
      idempotencyKey: init.headers['Idempotency-Key'],
      tenantId: init.headers['X-Tenant-Id'],
    })
    return { status: result.status, json: async () => result.data }
  })
  const result = await runBFixtureSuite(request)
  assert.equal(result.length, 7)
  assert.deepEqual(mock.mutations, sequence)
})
