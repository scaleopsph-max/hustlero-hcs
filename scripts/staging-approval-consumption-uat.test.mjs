/* global structuredClone */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  approvalPlan,
  approvalReason,
  createApprovalRequest,
  runApprovalConsumptionSuite,
  waitForActualExpiry,
} from './staging-approval-consumption-uat.mjs'
import { rollbackDraft, rollbackPlan } from './staging-paid-rollback-uat.mjs'
import { fundPlan } from './staging-fund-recovery-uat.mjs'
import { staging } from './staging-isolation-uat.mjs'

function fixture({ wrongOwner = false, acceptWrongOrder = false } = {}) {
  const orders = []
  const overrides = []
  let posts = 0
  const clone = (value) => structuredClone(value)
  const context = () => ({
    orders: clone(orders),
    invoices: [],
    inventory: [
      {
        variantId: rollbackPlan.firstVariant,
        locationId: staging.otherBranchId,
        availableMilli: orders.some((row) => row.status === 'confirmed') ? 1000 : 3000,
      },
      {
        variantId: rollbackPlan.secondVariant,
        locationId: staging.otherBranchId,
        availableMilli: orders.some((row) => row.status === 'confirmed') ? 0 : 4000,
      },
    ],
  })
  const request = async (input) => {
    if (input.method !== 'POST') {
      if (input.path === '/v1/me')
        return {
          status: 200,
          data: {
            userId: wrongOwner ? 'other' : fundPlan.ownerId,
            tenants: [{ tenantId: staging.tenantId, isOwner: true }],
          },
        }
      if (input.path === '/v1/wholesale/orders') return { status: 200, data: context() }
      if (input.path === '/v1/wholesale/credit-overrides')
        return { status: 200, data: { asOf: new Date().toISOString(), overrides: clone(overrides) } }
      if (input.path === '/v1/wholesale/credit-settings')
        return {
          status: 200,
          data: {
            customers: [
              { customerId: rollbackPlan.customerId, settings: { paymentTerm: 'net_7', creditLimitMinor: 500000 } },
            ],
          },
        }
      return {
        status: 200,
        data: input.path.endsWith('/funds')
          ? { funds: [], payments: [] }
          : { invoices: [{ openBalanceMinor: 160000 }] },
      }
    }
    posts++
    if (input.path === '/v1/wholesale/orders') {
      const id = orders.length ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      orders.push({
        id,
        orderNumber: input.body.orderNumber,
        status: 'draft',
        lines: [
          {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            variantId: rollbackPlan.secondVariant,
            orderedQuantityMilli: 4000,
            fulfilledQuantityMilli: 0,
            cancelledQuantityMilli: 0,
          },
        ],
      })
      return { status: 201, data: { salesOrderId: id, totalMinor: 480000 } }
    }
    if (input.path === '/v1/wholesale/credit-overrides') {
      const id = `dddddddd-dddd-4ddd-8ddd-ddddddddddd${overrides.length}`
      overrides.push({
        overrideId: id,
        salesOrderId: input.body.salesOrderId,
        reason: input.body.reason,
        action: 'confirm',
        status: 'approved',
        consumption: null,
        revokedAt: null,
      })
      return { status: 201, data: { overrideId: id, status: 'approved' } }
    }
    if (input.path.endsWith('/cancel')) {
      const row = orders.find((row) => input.path.includes(row.id))
      assert.ok(['confirmed', 'partially_fulfilled'].includes(row.status), 'Draft cancellation is unsupported')
      row.status = 'cancelled'
      row.lines.forEach((line) => {
        line.cancelledQuantityMilli = line.orderedQuantityMilli
      })
      return { status: 200, data: { status: 'cancelled' } }
    }
    if (input.path.endsWith('/revoke')) {
      const row = overrides.find((row) => input.path.includes(row.overrideId))
      row.revokedAt = new Date().toISOString()
      row.status = row.consumption ? 'consumed' : 'revoked'
      return { status: 201, data: { overrideId: row.overrideId, status: 'revoked' } }
    }
    if (input.idempotencyKey.endsWith('-confirm-a')) {
      orders[0].status = 'confirmed'
      const row = overrides.find((row) => row.overrideId === input.body.creditOverrideId)
      row.status = 'consumed'
      row.consumption = { excessMinor: 140000 }
      return { status: 200, data: { status: 'confirmed' } }
    }
    if (acceptWrongOrder && input.idempotencyKey.endsWith('-wrong-order')) {
      orders[1].status = 'confirmed'
      return { status: 200, data: { status: 'confirmed' } }
    }
    return { status: 409, data: { error: { code: 'WHOLESALE_OVERRIDE_HCCO6', requestId: 'synthetic-trace' } } }
  }
  const expire = async (load, id) => {
    overrides.find((row) => row.overrideId === id).status = 'expired'
    return load()
  }
  return {
    request,
    expire,
    orders,
    overrides,
    get posts() {
      return posts
    },
  }
}
test('nine cases isolate consumption and clean up only cancellable states, retaining inert drafts', async () => {
  const mock = fixture()
  const evidence = await runApprovalConsumptionSuite(mock.request, mock.expire)
  assert.equal(evidence.length, 9)
  assert.equal(mock.orders[0].status, 'cancelled')
  assert.equal(mock.orders[1].status, 'draft')
  assert.ok(mock.overrides.every((row) => row.revokedAt))
  assert.equal(mock.overrides.filter((row) => row.consumption).length, 1)
})
test('unexpected wrong-order acceptance still cancels orders and revokes approvals', async () => {
  const mock = fixture({ acceptWrongOrder: true })
  await assert.rejects(runApprovalConsumptionSuite(mock.request, mock.expire))
  assert.equal(mock.orders[0].status, 'draft')
  assert.equal(mock.orders[1].status, 'cancelled')
  assert.ok(mock.overrides.every((row) => row.revokedAt))
})
test('wrong owner stops before mutations; server expiry observer rejects revoked substitute', async () => {
  const mock = fixture({ wrongOwner: true })
  await assert.rejects(runApprovalConsumptionSuite(mock.request, mock.expire))
  assert.equal(mock.posts, 0)
  await assert.rejects(
    waitForActualExpiry(async () => ({ overrides: [{ overrideId: 'expiry', status: 'revoked' }] }), 'expiry'),
  )
  await waitForActualExpiry(async () => ({ overrides: [{ overrideId: 'expiry', status: 'expired' }] }), 'expiry')
})
test('transport rejects Production, arbitrary orders and enlarged credit exceptions', async () => {
  const request = createApprovalRequest('synthetic-token', async () => ({
    status: 201,
    json: async () => ({ salesOrderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
  }))
  await assert.rejects(request({ path: 'https://production.example/v1/me' }))
  await assert.rejects(
    request({
      path: '/v1/wholesale/orders',
      method: 'POST',
      body: { ...rollbackDraft, orderNumber: 'other' },
      idempotencyKey: 'uat-approval-scope-20261013-draft-a',
    }),
  )
  await request({
    path: '/v1/wholesale/orders',
    method: 'POST',
    body: { ...rollbackDraft, orderNumber: approvalPlan.names[0], notes: approvalPlan.reason },
    idempotencyKey: 'uat-approval-scope-20261013-draft-a',
  })
  await assert.rejects(
    request({
      path: '/v1/wholesale/credit-overrides',
      method: 'POST',
      body: {
        salesOrderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        action: 'confirm',
        approvedExcessMinor: 999999,
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        reason: approvalReason('a-main'),
      },
      idempotencyKey: 'uat-approval-scope-20261013-a-main',
    }),
  )
})
