/* global structuredClone */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFundRequest, fundPlan, runFundRecoverySuite } from './staging-fund-recovery-uat.mjs'
import { staging } from './staging-isolation-uat.mjs'

function fixture({ wrongOwner = false, corruptReplay = false } = {}) {
  let allocation = null
  let writes = 0
  let keyCalls = 0
  const calls = []
  const context = () => ({
    canManage: true,
    funds: [
      { fundType: 'capital_cogs', balanceMinor: allocation ? 50000 : 0 },
      { fundType: 'operating', balanceMinor: allocation ? 30000 : 0 },
    ],
    payments: [
      { paymentId: fundPlan.paymentId, amountMinor: 80000, reference: 'AW3-UAT-PARTIAL-20261012', allocation },
    ],
  })
  const request = async (input) => {
    calls.push(input)
    if (input.path === '/v1/me')
      return {
        status: 200,
        data: {
          userId: wrongOwner ? 'tester' : fundPlan.ownerId,
          tenants: [{ tenantId: staging.tenantId, isOwner: true }],
        },
      }
    if (input.path.includes('/reports/'))
      return {
        status: 200,
        data: { summary: { recordedReceiptsMinor: 800000, closingReceivablesMinor: 160000 }, byPaymentMethod: [] },
      }
    if (input.method !== 'POST') return { status: 200, data: structuredClone(context()) }
    if (input.key.endsWith('-invalid')) return { status: 400, data: { error: { code: 'WHOLESALE_FUNDS_HCFD2' } } }
    if (input.key.endsWith('-duplicate')) return { status: 409, data: { error: { code: 'WHOLESALE_FUNDS_HCFD4' } } }
    keyCalls++
    if (!allocation) {
      writes++
      allocation = {
        paymentId: fundPlan.paymentId,
        capitalMinor: 50000,
        operatingMinor: 30000,
        recordedAt: '2026-10-13T08:00:00Z',
      }
    }
    return { status: 201, data: { ...allocation, ...(corruptReplay && keyCalls > 1 ? { operatingMinor: 29999 } : {}) } }
  }
  return {
    request,
    calls,
    get writes() {
      return writes
    },
  }
}
test('discard/replay and duplicate rejection create only one synthetic allocation', async () => {
  const mock = fixture()
  const evidence = await runFundRecoverySuite(mock.request, '2026-10-13')
  assert.equal(mock.writes, 1)
  assert.equal(evidence.length, 6)
  const posts = mock.calls.filter((row) => row.key === fundPlan.key)
  assert.equal(posts.length, 3)
  assert.ok(posts.every((row) => JSON.stringify(row.body) === JSON.stringify(fundPlan.body)))
  await runFundRecoverySuite(mock.request, '2026-10-13')
  assert.equal(mock.writes, 1)
})
test('wrong identity fails before any business POST', async () => {
  const mock = fixture({ wrongOwner: true })
  await assert.rejects(runFundRecoverySuite(mock.request, '2026-10-13'))
  assert.equal(mock.writes, 0)
})
test('corrupt replay is not reported as recovered', async () => {
  const mock = fixture({ corruptReplay: true })
  await assert.rejects(runFundRecoverySuite(mock.request, '2026-10-13'))
})
test('transport rejects Production, other receipts and arbitrary mutations', async () => {
  const request = createFundRequest('synthetic-token', async () => ({ status: 200, json: async () => ({}) }))
  await assert.rejects(request({ path: 'https://production.example/v1/me' }))
  await assert.rejects(
    request({ path: '/v1/wholesale/orders', method: 'POST', body: fundPlan.body, key: fundPlan.key }),
  )
  await assert.rejects(
    request({
      path: '/v1/wholesale/funds',
      method: 'POST',
      body: { ...fundPlan.body, paymentId: 'other' },
      key: fundPlan.key,
    }),
  )
})
