import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPaidReplayRequest,
  paidPlans,
  paidBody,
  paidResponse,
  runPaidReplaySuite,
  verifyHistoricalHash,
} from './staging-paid-replay-uat.mjs'
import { staging } from './staging-isolation-uat.mjs'
import { fundPlan } from './staging-fund-recovery-uat.mjs'

function fixture({ badIdentity = false, badReplay = false, mutate = false } = {}) {
  let posts = 0
  const request = async (input) => {
    if (input.path === '/v1/me')
      return {
        status: 200,
        data: {
          userId: badIdentity ? 'other' : fundPlan.ownerId,
          tenants: [{ tenantId: staging.tenantId, isOwner: true }],
        },
      }
    if (input.method !== 'POST') {
      if (input.path === '/v1/wholesale/orders')
        return {
          status: 200,
          data: {
            orders: paidPlans.map((row) => ({ id: row.orderId, status: 'cancelled' })),
            invoices: paidPlans.map((row) => ({ id: row.invoiceId })),
            inventory: [{ qty: mutate && posts ? 99 : 4 }],
          },
        }
      return { status: 200, data: input.path.endsWith('/funds') ? { funds: [], payments: [] } : { overrides: [] } }
    }
    posts++
    const deny = (status, code) => ({ status, data: { error: { code, requestId: 'synthetic-trace' } } })
    if (input.key === 'uat-paid-expired-approval-20261013') return deny(400, 'WHOLESALE_OVERRIDE_HCCO5')
    if (input.key === 'uat-paid-missing-approval-scope-20261013') return deny(404, 'WHOLESALE_OVERRIDE_HCCO3')
    if (input.key.startsWith('uat-paid-')) return deny(409, 'WHOLESALE_ORDER_STATUS_CONFLICT')
    if (input.body.payment.amountMinor !== 160000) return deny(409, 'IDEMPOTENCY_KEY_CONFLICT')
    const plan = paidPlans.find((row) => row.key === input.key)
    return { status: 201, data: { ...paidResponse(plan), ...(badReplay ? { invoiceId: 'new-invoice' } : {}) } }
  }
  return {
    request,
    get posts() {
      return posts
    },
  }
}
test('both immutable original actor-bound payload hashes match', () => {
  paidPlans.forEach(verifyHistoricalHash)
})
test('13 historical replay/denial cases pass without new context changes', async () => {
  const mock = fixture()
  const result = await runPaidReplaySuite(mock.request, '2026-10-13')
  assert.equal(result.length, 13)
  assert.equal(mock.posts, 10)
})
test('wrong owner, new invoice replay and altered stock fail closed', async () => {
  for (const options of [{ badIdentity: true }, { badReplay: true }, { mutate: true }])
    await assert.rejects(runPaidReplaySuite(fixture(options).request, '2026-10-13'))
})
test('transport prohibits foreign targets, arbitrary orders, quantities and new approvals', async () => {
  const request = createPaidReplayRequest('synthetic-token', async () => ({ status: 200, json: async () => ({}) }))
  await assert.rejects(request({ path: 'https://production.example/v1/me' }))
  await assert.rejects(
    request({
      path: '/v1/wholesale/orders/other/fulfill',
      method: 'POST',
      key: paidPlans[0].key,
      body: paidBody(paidPlans[0]),
    }),
  )
  await assert.rejects(
    request({
      path: `/v1/wholesale/orders/${paidPlans[0].orderId}/fulfill`,
      method: 'POST',
      key: paidPlans[0].key,
      body: { ...paidBody(paidPlans[0]), lines: [{ salesOrderLineId: paidPlans[0].lineId, quantityMilli: 3000 }] },
    }),
  )
  await assert.rejects(
    request({ path: '/v1/wholesale/credit-overrides', method: 'POST', key: 'new-approval', body: {} }),
  )
})
