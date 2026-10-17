/* global structuredClone */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  foreignFixture as b,
  aOpenInvoice,
  ownerScopeCases,
  scopePaths,
  crossKey,
  createCrossTenantOwnerRequest,
  runCrossTenantOwnerSuite,
} from './staging-cross-tenant-owner.mjs'
import { staging } from './staging-isolation-uat.mjs'
import { rollbackPlan as a } from './staging-paid-rollback-uat.mjs'
import { fundPlan } from './staging-fund-recovery-uat.mjs'

function fixture({ wrongOwner = false, acceptStep = null, genericDraft = false, drift = false, leak = false } = {}) {
  const attempted = []
  const controls = (tenant) => {
    const isB = tenant === b.tenantId
    const customerId = isB ? b.customerId : a.customerId
    const invoiceId = isB ? b.invoiceId : aOpenInvoice
    return {
      '/v1/catalog': { products: [{ id: isB ? b.productId : '83000000-0000-4000-8000-000000000001' }] },
      '/v1/customers': { customers: [{ id: customerId, customerType: 'reseller' }] },
      '/v1/pricing': {
        priceLists: [
          {
            id: isB ? b.priceListId : a.priceListId,
            isActive: true,
            isDefault: true,
            customerIds: [customerId],
            entries: (isB ? [b.variantId] : [a.firstVariant, a.secondVariant]).map((variantId) => ({ variantId })),
          },
        ],
      },
      '/v1/wholesale/orders': {
        canManage: true,
        orders: isB
          ? [{ id: b.orderId, status: 'fulfilled' }]
          : Array.from({ length: 11 }, (_, n) => ({
              id: `83000000-0000-4000-8000-${String(n + 10).padStart(12, '0')}`,
            })),
        locations: [{ id: isB ? b.locationId : staging.otherBranchId }],
        invoices: [{ id: invoiceId }],
        changed: drift && attempted.length > 0,
        ...(leak && !isB ? { foreign: b.customerId } : {}),
      },
      '/v1/wholesale/receivables': { invoices: [{ invoiceId, openBalanceMinor: isB ? 0 : 160000 }] },
      '/v1/wholesale/payments': {
        invoices: [{ invoiceId, customerId, canAllocate: true, openBalanceMinor: isB ? 0 : 160000 }],
        paymentMethods: [{ id: isB ? b.methodId : a.methodId }],
        payments: [{ paymentId: isB ? b.paymentId : fundPlan.paymentId }],
      },
      '/v1/wholesale/credit-settings': { customers: [{ customerId }] },
    }
  }
  const request = async (input) => {
    const row = ownerScopeCases.find(
      (row) =>
        row.path === input.path &&
        row.method === (input.method ?? 'GET') &&
        (row.method === 'GET' || input.idempotencyKey === crossKey(row.step)),
    )
    if (row) {
      assert.equal(input.tenantId ?? staging.tenantId, staging.tenantId)
      assert.deepEqual(input.body, row.body)
      attempted.push(row.step)
      if (row.step === acceptStep) return { status: 201, data: { unexpectedEffect: true } }
      return {
        status: row.status,
        data: {
          error: {
            code: row.code,
            message:
              genericDraft && row.scopeMessage
                ? 'Provide valid draft fields'
                : (row.scopeMessage ?? 'Expected scope rejection'),
            requestId: '83000000-0000-4000-8000-000000000099',
          },
        },
      }
    }
    if (input.path === '/v1/me')
      return {
        status: 200,
        data: {
          userId: wrongOwner ? staging.userId : fundPlan.ownerId,
          tenants: [
            { tenantId: staging.tenantId, isOwner: true },
            { tenantId: b.tenantId, isOwner: true },
          ],
        },
      }
    if (input.path === '/v1/wholesale/funds')
      return {
        status: 200,
        data: {
          canManage: true,
          funds: [{ balanceMinor: 50000 }, { balanceMinor: 30000 }],
          payments: [{ paymentId: fundPlan.paymentId }],
        },
      }
    assert.ok(scopePaths.includes(input.path))
    return { status: 200, data: structuredClone(controls(input.tenantId ?? staging.tenantId)[input.path]) }
  }
  return { request, attempted }
}

test('17 owner matrix checkpoints validate two populated controls and exact foreign-scope denials', async () => {
  const mock = fixture()
  const progress = []
  const result = await runCrossTenantOwnerSuite(mock.request, (entry) => progress.push(entry))
  assert.equal(result.length, 17)
  assert.deepEqual(progress, result)
  assert.deepEqual(
    mock.attempted,
    ownerScopeCases.map((row) => row.step),
  )
})

test('wrong owner or cross-context identifier leakage stops before any denial attempt', async () => {
  for (const mock of [fixture({ wrongOwner: true }), fixture({ leak: true })]) {
    await assert.rejects(() => runCrossTenantOwnerSuite(mock.request))
    assert.deepEqual(mock.attempted, [])
  }
})

test('unexpected command acceptance stops immediately without retries or follow-up writes', async () => {
  const mock = fixture({ acceptStep: 'product-update' })
  const progress = []
  await assert.rejects(
    () => runCrossTenantOwnerSuite(mock.request, (entry) => progress.push(entry)),
    /Scope denial failed/,
  )
  assert.deepEqual(mock.attempted, ['customer-read', 'product-update'])
  assert.equal(progress.at(-1).status, 201)
  assert.ok(!JSON.stringify(progress).includes('unexpectedEffect'))
})

test('generic draft validation or changed business state is not an isolation pass', async () => {
  for (const mock of [fixture({ genericDraft: true }), fixture({ drift: true })])
    await assert.rejects(() => runCrossTenantOwnerSuite(mock.request))
})

test('transport blocks Production, B-selected commands, valid-own-scope substitutions and arbitrary keys', async () => {
  let calls = 0
  const request = createCrossTenantOwnerRequest('synthetic-test-token', async () => {
    calls++
    return { status: 200, json: async () => ({}) }
  })
  const row = ownerScopeCases.find((row) => row.step === 'payment-invoice')
  const cmd = { path: row.path, method: row.method, body: row.body, idempotencyKey: crossKey(row.step) }
  for (const input of [
    { path: 'https://hustlero-hcs-api.scaleopsph.workers.dev/v1/me' },
    { ...cmd, tenantId: b.tenantId },
    { ...cmd, body: { ...row.body, allocations: [{ invoiceId: aOpenInvoice, amountMinor: 100 }] } },
    { ...cmd, idempotencyKey: `${cmd.idempotencyKey}-retry` },
    { ...cmd, path: '/v1/platform/support-access' },
    { path: '/v1/catalog', tenantId: staging.foreignTenantId },
  ])
    await assert.rejects(() => request(input))
  assert.equal(calls, 0)
})

test('same matrix passes through fixed Staging transport with selected-business headers', async () => {
  const mock = fixture()
  const request = createCrossTenantOwnerRequest('synthetic-test-token', async (url, init) => {
    assert.equal(url.origin, staging.api)
    assert.equal(init.redirect, 'error')
    const result = await mock.request({
      path: url.pathname,
      method: init.method,
      body: init.body ? JSON.parse(init.body) : undefined,
      tenantId: init.headers['X-Tenant-Id'],
      idempotencyKey: init.headers['Idempotency-Key'],
    })
    return { status: result.status, json: async () => result.data }
  })
  assert.equal((await runCrossTenantOwnerSuite(request)).length, 17)
})
