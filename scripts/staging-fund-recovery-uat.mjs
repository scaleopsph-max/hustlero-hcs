/* global fetch, URL, AbortSignal */
import assert from 'node:assert/strict'
import { staging } from './staging-isolation-uat.mjs'

export const fundPlan = Object.freeze({
  ownerId: 'd4bc81e3-3391-4106-88c7-b256661d8f71',
  email: 'scaleopsph@gmail.com',
  paymentId: '374ffa4a-1fa7-4220-ad2a-36b90c41c8f6',
  key: 'uat-fund-recovery-20261013-800-500-300',
  body: Object.freeze({
    paymentId: '374ffa4a-1fa7-4220-ad2a-36b90c41c8f6',
    capitalMinor: 50000,
    operatingMinor: 30000,
    settledConfirmed: true,
    settlementReference: 'AW3-SYNTHETIC-SETTLED-20261013',
    reason: 'Owner-approved synthetic Staging recovery UAT; no real settlement or Production money',
  }),
})

export function createFundRequest(token, transport = fetch) {
  assert.ok(token && !/[\r\n]/.test(token), 'Session required')
  return async ({ path, method = 'GET', body, key }) => {
    const url = new URL(path, staging.api)
    assert.equal(url.origin, staging.api, 'Staging only')
    assert.ok(['/v1/me', '/v1/wholesale/funds', '/v1/reports/wholesale-settlement'].includes(url.pathname))
    assert.ok(method === 'GET' || (method === 'POST' && path === '/v1/wholesale/funds'), 'Fixed fund route only')
    if (method === 'POST') {
      assert.equal(body.paymentId, fundPlan.paymentId, 'Fixed synthetic receipt only')
      assert.equal(body.capitalMinor, 50000)
      assert.ok(body.operatingMinor === 30000 || body.operatingMinor === 29999)
      assert.deepEqual(body, { ...fundPlan.body, operatingMinor: body.operatingMinor })
      assert.ok([fundPlan.key, `${fundPlan.key}-invalid`, `${fundPlan.key}-duplicate`].includes(key))
    }
    const response = await transport(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': staging.tenantId,
        ...(method === 'POST' ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json() }
  }
}

export async function runFundRecoverySuite(request, day) {
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/)
  const evidence = []
  const get = async (path) => {
    const result = await request({ path })
    assert.equal(result.status, 200)
    return result.data
  }
  const identity = await get('/v1/me')
  assert.equal(identity.userId, fundPlan.ownerId, 'Exact Staging owner required')
  assert.ok(
    identity.tenants.some((row) => row.tenantId === staging.tenantId && row.isOwner),
    'PABL0 owner required',
  )
  const before = await get('/v1/wholesale/funds')
  assert.equal(before.canManage, true)
  const receipt = before.payments.find((row) => row.paymentId === fundPlan.paymentId)
  assert.equal(receipt?.amountMinor, 80000, 'Receipt baseline changed')
  assert.equal(receipt.reference, 'AW3-UAT-PARTIAL-20261012')
  const resumed = receipt.allocation !== null
  if (resumed) {
    assert.equal(receipt.allocation.capitalMinor, 50000)
    assert.equal(receipt.allocation.operatingMinor, 30000)
  }
  for (const type of ['capital_cogs', 'operating'])
    assert.equal(before.funds.filter((row) => row.fundType === type).length, 1)
  const reportPath = `/v1/reports/wholesale-settlement?from=2026-10-08&to=${day}&channel=all`
  const settlement = await get(reportPath)
  evidence.push({ name: 'Exact owner and synthetic receipt baseline', status: 200, resumed })
  const post = (body, key) => request({ path: '/v1/wholesale/funds', method: 'POST', body, key })
  if (!resumed) {
    const invalid = await post({ ...fundPlan.body, operatingMinor: 29999 }, `${fundPlan.key}-invalid`)
    assert.equal(invalid.status, 400)
    assert.equal(invalid.data.error.code, 'WHOLESALE_FUNDS_HCFD2')
    assert.deepEqual(await get('/v1/wholesale/funds'), before, 'Rejected split changed fund state')
    evidence.push({ name: 'Wrong split rejected with unchanged funds', status: 400, code: invalid.data.error.code })
    const committed = await post(fundPlan.body, fundPlan.key)
    assert.equal(committed.status, 201)
    assert.equal(committed.data.paymentId, fundPlan.paymentId)
    assert.equal(committed.data.capitalMinor, 50000)
    assert.equal(committed.data.operatingMinor, 30000)
    // Deliberately discard the first successful response at the client boundary.
    // This tests deployed API replay, not actual network loss or browser reload.
    evidence.push({ name: 'First committed response deliberately discarded', status: 201 })
  }
  const replay = await post(fundPlan.body, fundPlan.key)
  assert.equal(replay.status, 201)
  assert.equal(replay.data.paymentId, fundPlan.paymentId)
  assert.equal(replay.data.capitalMinor, 50000)
  assert.equal(replay.data.operatingMinor, 30000)
  assert.ok(replay.data.recordedAt)
  const repeat = await post(fundPlan.body, fundPlan.key)
  assert.equal(repeat.status, 201)
  assert.deepEqual(repeat.data, replay.data, 'Replay response changed')
  evidence.push({ name: 'Original key/body replays unchanged response', status: 201 })
  const duplicate = await post(fundPlan.body, `${fundPlan.key}-duplicate`)
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.data.error.code, 'WHOLESALE_FUNDS_HCFD4')
  evidence.push({ name: 'New-key duplicate rejected', status: 409, code: duplicate.data.error.code })
  const after = await get('/v1/wholesale/funds')
  assert.equal(after.payments.length, before.payments.length)
  assert.deepEqual(after.payments.find((row) => row.paymentId === fundPlan.paymentId).allocation, replay.data)
  for (const [type, amount] of [
    ['capital_cogs', 50000],
    ['operating', 30000],
  ]) {
    assert.equal(
      after.funds.find((row) => row.fundType === type).balanceMinor,
      before.funds.find((row) => row.fundType === type).balanceMinor + (resumed ? 0 : amount),
    )
  }
  const report = await get(reportPath)
  assert.deepEqual(report.summary, settlement.summary, 'Fund split changed receivables/settlement')
  assert.deepEqual(report.byPaymentMethod, settlement.byPaymentMethod)
  evidence.push({ name: 'Exact fund deltas; unchanged receipt/settlement totals', status: 200 })
  return evidence
}
