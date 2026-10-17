/* global structuredClone */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createRollbackRequest,
  rollbackDraft,
  rollbackPlan,
  rollbackSettings,
  restoreSettings,
  runPaidRollbackSuite,
} from './staging-paid-rollback-uat.mjs'
import { staging } from './staging-isolation-uat.mjs'
import { fundPlan } from './staging-fund-recovery-uat.mjs'

const orderId = '11111111-1111-4111-8111-111111111111'
const lineId = '22222222-2222-4222-8222-222222222222'
function fixture({ wrongOwner = false, fulfillmentSucceeds = false, failConfirm = false } = {}) {
  let terms = { paymentTerm: 'net_7', creditLimitMinor: 500000 }
  let order = null
  const posts = []
  const context = () => ({
    orders: order ? [structuredClone(order)] : [],
    invoices: [],
    inventory: [
      {
        variantId: rollbackPlan.firstVariant,
        locationId: staging.otherBranchId,
        availableMilli: order?.status === 'confirmed' ? 1000 : 3000,
      },
      {
        variantId: rollbackPlan.secondVariant,
        locationId: staging.otherBranchId,
        availableMilli: order?.status === 'confirmed' ? 0 : 4000,
      },
    ],
    priceLists: [
      {
        id: rollbackPlan.priceListId,
        entries: [rollbackPlan.firstVariant, rollbackPlan.secondVariant].map((variantId) => ({
          variantId,
          unitPriceMinor: 80000,
          thresholdMilli: 6000,
          pricingGroupId: 'group',
        })),
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
      if (input.path === '/v1/wholesale/funds') return { status: 200, data: { funds: [], payments: [] } }
      return { status: 200, data: { customers: [{ customerId: rollbackPlan.customerId, settings: { ...terms } }] } }
    }
    posts.push(input)
    if (input.path.endsWith('credit-settings')) {
      terms = { paymentTerm: input.body.paymentTerm, creditLimitMinor: input.body.creditLimitMinor }
      return { status: 201, data: { ...terms } }
    }
    if (input.path === '/v1/wholesale/orders') {
      order = {
        id: orderId,
        orderNumber: rollbackPlan.orderNumber,
        status: 'draft',
        lines: [
          {
            id: lineId,
            variantId: rollbackPlan.secondVariant,
            orderedQuantityMilli: 4000,
            cancelledQuantityMilli: 0,
            fulfilledQuantityMilli: 0,
          },
        ],
      }
      return { status: 201, data: { salesOrderId: orderId, totalMinor: 480000 } }
    }
    if (input.path.endsWith('/confirm')) {
      if (failConfirm) throw Error('synthetic uncertain confirmation')
      order.status = 'confirmed'
      return { status: 200, data: { status: 'confirmed' } }
    }
    if (input.path.endsWith('/cancel')) {
      order.status = 'cancelled'
      order.lines[0].cancelledQuantityMilli = 4000
      return { status: 200, data: { status: 'cancelled' } }
    }
    if (fulfillmentSucceeds) return { status: 201, data: { invoiceId: 'unexpected-invoice' } }
    const step = input.idempotencyKey.split('-').at(-1)
    return {
      status: step === 'method' ? 404 : 409,
      data: {
        error: {
          code:
            step === 'unpaid'
              ? 'WHOLESALE_CREDIT_HCCR3'
              : step === 'method'
                ? 'WHOLESALE_PAYMENT_HCAP3'
                : 'WHOLESALE_PAID_HCSP3',
          requestId: 'synthetic-trace',
        },
      },
    }
  }
  return {
    request,
    posts,
    get terms() {
      return terms
    },
    get order() {
      return order
    },
  }
}
test('seven rollback checks cancel the order and restore exact original terms', async () => {
  const mock = fixture()
  const evidence = await runPaidRollbackSuite(mock.request)
  assert.equal(evidence.length, 7)
  assert.equal(mock.order.status, 'cancelled')
  assert.deepEqual(mock.terms, { paymentTerm: 'net_7', creditLimitMinor: 500000 })
})
test('unexpected fulfillment success and uncertain confirmation still attempt cleanup', async () => {
  for (const options of [{ fulfillmentSucceeds: true }, { failConfirm: true }]) {
    const mock = fixture(options)
    await assert.rejects(runPaidRollbackSuite(mock.request))
    assert.equal(mock.order.status, 'cancelled')
    assert.deepEqual(mock.terms, { paymentTerm: 'net_7', creditLimitMinor: 500000 })
  }
})
test('wrong owner fails before any mutation', async () => {
  const mock = fixture({ wrongOwner: true })
  await assert.rejects(runPaidRollbackSuite(mock.request))
  assert.equal(mock.posts.length, 0)
})
test('transport refuses unrelated mutations and binding to another order', async () => {
  const request = createRollbackRequest('synthetic-token', async () => ({
    status: 201,
    json: async () => ({ salesOrderId: orderId }),
  }))
  await assert.rejects(request({ path: 'https://production.example/v1/me' }))
  await assert.rejects(
    request({
      path: '/v1/wholesale/credit-settings',
      method: 'POST',
      body: { ...rollbackSettings, creditLimitMinor: 999999 },
      idempotencyKey: 'uat-paid-rollback-20261013-terms',
    }),
  )
  await request({
    path: '/v1/wholesale/orders',
    method: 'POST',
    body: rollbackDraft,
    idempotencyKey: 'uat-paid-rollback-20261013-draft',
  })
  await assert.rejects(
    request({
      path: '/v1/wholesale/orders/33333333-3333-4333-8333-333333333333/cancel',
      method: 'POST',
      body: { reason: rollbackPlan.reason },
      idempotencyKey: 'uat-paid-rollback-20261013-cancel',
    }),
  )
  assert.equal(restoreSettings.creditLimitMinor, 500000)
})
