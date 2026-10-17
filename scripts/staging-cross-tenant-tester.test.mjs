import test from 'node:test'
import assert from 'node:assert/strict'
import { staging } from './staging-isolation-uat.mjs'
import { foreignFixture } from './staging-cross-tenant-owner.mjs'
import {
  createCrossTenantTesterRequest,
  runCrossTenantTesterSuite,
  testerDenialKey,
} from './staging-cross-tenant-tester.mjs'

const day = '2026-10-14'
const trace = '00000000-0000-4000-8000-000000000003'
const deny = (status, code) => ({ status, data: { error: { code, requestId: trace } } })
async function passing(input) {
  if (input.path === '/v1/me')
    return {
      status: 200,
      data: {
        userId: staging.userId,
        tenants: [
          {
            tenantId: staging.tenantId,
            isOwner: false,
            employeeId: 'employee',
            locationIds: [staging.branchId],
            permissions: ['reports.read', 'wholesale_orders.read'],
            entitlements: ['advanced_wholesale'],
          },
        ],
      },
    }
  if (input.method === 'POST') {
    assert.equal(input.path, `/v1/wholesale/orders/${foreignFixture.orderId}/confirm`)
    assert.notEqual(input.tenantId, foreignFixture.tenantId)
    return deny(403, 'WHOLESALE_ORDER_ACCESS_DENIED')
  }
  if (input.tenantId === foreignFixture.tenantId) {
    const code = input.path.includes('/reports/')
      ? 'REPORTING_ACCESS_DENIED'
      : input.path.includes('/receivables')
        ? 'WHOLESALE_RECEIVABLE_ACCESS_DENIED'
        : input.path.includes('/payments')
          ? 'WHOLESALE_PAYMENT_ACCESS_DENIED'
          : input.path.includes('/statements')
            ? 'STATEMENT_ACCESS_DENIED'
            : 'WHOLESALE_ORDER_ACCESS_DENIED'
    return deny(403, code)
  }
  if (input.path.includes(staging.otherBranchId))
    return deny(404, input.path.includes('/statements') ? 'STATEMENT_SCOPE_ERROR' : 'REPORT_LOCATION_NOT_FOUND')
  if (input.path === '/v1/wholesale/orders')
    return {
      status: 200,
      data: { canManage: false, locations: [{ id: staging.branchId }], orders: [], inventory: [], invoices: [] },
    }
  return { status: 200, data: { scope: { locationId: staging.branchId }, locations: [{ id: staging.branchId }] } }
}

test('20 cases resolve sentinel negatives to actual populated B; no successful mutation', async () => {
  const seen = []
  const request = createCrossTenantTesterRequest('synthetic-token', day, async (url, init) => {
    seen.push({ url, init })
    const result = await passing({
      path: url.pathname + url.search,
      tenantId: init.headers['X-Tenant-Id'],
      method: init.method,
    })
    return { status: result.status, json: async () => result.data }
  })
  const evidence = await runCrossTenantTesterSuite(request, day)
  assert.equal(evidence.length, 20)
  assert.equal(seen.length, 20)
  assert.equal(seen.filter((r) => r.init.method === 'POST').length, 1)
  assert.equal(seen.find((r) => r.init.method === 'POST').init.headers['Idempotency-Key'], testerDenialKey)
  assert.ok(
    seen.every(
      (r) => !r.url.href.includes(staging.absentOrderId) && r.init.headers['X-Tenant-Id'] !== staging.foreignTenantId,
    ),
  )
  assert.ok(seen.every((r) => r.url.origin === staging.api && r.init.redirect === 'error'))
  assert.ok(!JSON.stringify(evidence).includes('synthetic-token'))
})

test('transport rejects broadened routes, tenant, mutation, body and dates before network', async () => {
  let calls = 0
  const request = createCrossTenantTesterRequest('synthetic-token', day, async () => {
    calls++
    throw new Error('Unexpected network')
  })
  for (const input of [
    { path: 'https://production.example/v1/me' },
    { path: '/v1/catalog' },
    { path: '/v1/me', tenantId: foreignFixture.tenantId },
    { path: `/v1/wholesale/orders/${staging.absentOrderId}/confirm`, method: 'POST', body: {} },
    { path: `/v1/wholesale/orders/${foreignFixture.orderId}/confirm`, method: 'POST', body: { changed: true } },
    {
      path: `/v1/wholesale/orders/${foreignFixture.orderId}/confirm`,
      method: 'POST',
      tenantId: foreignFixture.tenantId,
      body: {},
    },
    { path: '/v1/me', body: {} },
    { path: '/v1/wholesale/orders', method: 'DELETE' },
  ])
    await assert.rejects(request(input))
  assert.equal(calls, 0)
  assert.throws(() => createCrossTenantTesterRequest('synthetic-token', 'bad-date'))
})

test('owner or second membership halts before any denied command', async () => {
  for (const broaden of [
    (data) => {
      data.tenants[0].isOwner = true
    },
    (data) => {
      data.tenants.push({ tenantId: foreignFixture.tenantId })
    },
  ]) {
    let calls = 0
    await assert.rejects(
      runCrossTenantTesterSuite(async (input) => {
        calls++
        const result = await passing(input)
        broaden(result.data)
        return result
      }, day),
    )
    assert.equal(calls, 1)
  }
})

test('allowed branch reads cannot include a real B invoice or receipt reference', async () => {
  for (const id of [foreignFixture.invoiceId, foreignFixture.paymentId]) {
    let calls = 0
    await assert.rejects(
      runCrossTenantTesterSuite(async (input) => {
        calls++
        const result = await passing(input)
        if (input.path === '/v1/wholesale/orders') result.data.unexpectedForeignReference = id
        return result
      }, day),
    )
    assert.equal(calls, 2)
  }
})

test('acceptance, generic error, missing trace and data leakage cannot pass populated denials', async () => {
  for (const bad of [
    { status: 200, data: {} },
    deny(400, 'VALIDATION_ERROR'),
    { status: 403, data: { error: { code: 'WHOLESALE_RECEIVABLE_ACCESS_DENIED' } } },
    { status: 403, data: { ...deny(403, 'WHOLESALE_RECEIVABLE_ACCESS_DENIED').data, invoices: [] } },
  ]) {
    let laterCalls = 0
    const progress = []
    await assert.rejects(
      runCrossTenantTesterSuite(
        async (input) => {
          if (input.path === '/v1/wholesale/receivables') return bad
          if (input.path === '/v1/wholesale/payments') laterCalls++
          return passing(input)
        },
        day,
        (entry) => progress.push(entry),
      ),
    )
    assert.equal(laterCalls, 0)
    assert.equal(progress.length, 17, 'Earlier verified checkpoints retained on failure')
  }
})
