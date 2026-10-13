/* global fetch, URL, AbortSignal */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { staging } from './staging-isolation-uat.mjs'
import { fundPlan } from './staging-fund-recovery-uat.mjs'

export const paidPlans = [
  {
    term: 'COD',
    orderId: 'f57cb63f-46cb-4c46-bf4e-d813639e4a0d',
    lineId: '79be78ed-d324-4fd0-95d6-6b7fa2a40f55',
    key: '8dc7f7a4-c51a-4b8f-bdee-1b3583a7da40',
    reference: 'AW3-UAT-COD-20261012',
    hash: 'f373704fee9fab125e83d2b21f3ef68df095afbab4e0a65ffcd5039a6569f598',
    invoiceId: 'b6ca6bf8-3b48-4e27-b7d8-17aba275b385',
    saleId: '77fd6c9b-7f92-441b-a84d-f9b64a75110e',
    invoiceNumber: 'INV-20261012-000002',
    issuedAt: '2026-10-12T12:44:11.167502+00:00',
  },
  {
    term: 'Prepaid',
    orderId: 'b9bc46f4-1aad-4d0c-a457-155d28fec90d',
    lineId: 'bf239a7d-d5d0-488e-a446-7cb939dbb0c5',
    key: 'dac38357-f2ef-4e8e-b3d1-db742603df69',
    reference: 'AW3-UAT-PREPAID-20261012',
    hash: '0071979f86a9c298dcdd5ca0006f0e66a0ec2b58253a0e5ab20c5de3828a345d',
    invoiceId: '81f8d91e-ccc6-4a99-85da-c2a5d038964e',
    saleId: '006dc696-1d05-4572-81d2-6f4a82e4cc36',
    invoiceNumber: 'INV-20261012-000003',
    issuedAt: '2026-10-12T12:45:46.713918+00:00',
  },
].map(Object.freeze)

export function paidBody(plan, amountMinor = 160000) {
  return {
    payment: { paymentMethodId: 'fc75965f-b614-4a78-a1c1-562a7aad21b5', amountMinor, reference: plan.reference },
    lines: [{ salesOrderLineId: plan.lineId, quantityMilli: 2000 }],
  }
}
export function paidResponse(plan) {
  return {
    saleId: plan.saleId,
    issuedAt: plan.issuedAt,
    invoiceId: plan.invoiceId,
    totalMinor: 160000,
    orderStatus: 'partially_fulfilled',
    salesOrderId: plan.orderId,
    invoiceNumber: plan.invoiceNumber,
    fulfilledQuantityMilli: 2000,
  }
}
export function verifyHistoricalHash(plan) {
  const hash = createHash('sha256')
    .update(JSON.stringify({ salesOrderId: plan.orderId, ...paidBody(plan), userId: fundPlan.ownerId }))
    .digest('hex')
  assert.equal(hash, plan.hash, 'Historical actor-bound payload hash differs')
}

export function createPaidReplayRequest(token, transport = fetch) {
  assert.ok(token && !/[\r\n]/.test(token))
  return async ({ path, method = 'GET', body, key }) => {
    const url = new URL(path, staging.api)
    assert.equal(url.origin, staging.api)
    if (method === 'GET')
      assert.ok(
        ['/v1/me', '/v1/wholesale/orders', '/v1/wholesale/credit-overrides', '/v1/wholesale/funds'].includes(path),
      )
    else {
      assert.equal(method, 'POST')
      const plan = paidPlans.find((row) => path === `/v1/wholesale/orders/${row.orderId}/fulfill`)
      if (plan) {
        assert.deepEqual(body, paidBody(plan, body.payment?.amountMinor))
        assert.ok([160000, 159999].includes(body.payment.amountMinor))
        assert.ok([plan.key, `uat-paid-${plan.term.toLowerCase()}-newkey-20261013`].includes(key))
        if (key !== plan.key) assert.equal(body.payment.amountMinor, 160000)
      } else {
        assert.equal(path, '/v1/wholesale/credit-overrides')
        assert.equal(body.action, 'confirm')
        assert.equal(body.approvedExcessMinor, 1)
        assert.equal(body.reason, 'Synthetic Staging approval denial UAT')
        assert.deepEqual(Object.keys(body).sort(), [
          'action',
          'approvedExcessMinor',
          'expiresAt',
          'reason',
          'salesOrderId',
        ])
        assert.ok(
          (key === 'uat-paid-expired-approval-20261013' &&
            body.salesOrderId === paidPlans[0].orderId &&
            body.expiresAt === '2026-10-12T00:00:00Z') ||
            (key === 'uat-paid-missing-approval-scope-20261013' &&
              body.salesOrderId === staging.absentOrderId &&
              Number.isFinite(Date.parse(body.expiresAt))),
        )
      }
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

export async function runPaidReplaySuite(request, day) {
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/)
  const evidence = []
  const get = async (path) => {
    const result = await request({ path })
    assert.equal(result.status, 200)
    return result.data
  }
  const me = await get('/v1/me')
  assert.equal(me.userId, fundPlan.ownerId)
  assert.ok(me.tenants.some((row) => row.tenantId === staging.tenantId && row.isOwner))
  evidence.push({ name: 'Exact Staging owner', status: 200 })
  const before = await get('/v1/wholesale/orders')
  const funds = await get('/v1/wholesale/funds')
  const approvals = await get('/v1/wholesale/credit-overrides')
  for (const plan of paidPlans) {
    verifyHistoricalHash(plan)
    assert.equal(before.orders.find((row) => row.id === plan.orderId)?.status, 'cancelled')
    assert.ok(before.invoices.some((row) => row.id === plan.invoiceId))
  }
  evidence.push({ name: 'Historical cancelled-order and paid invoice baseline', status: 200 })
  const deny = async (name, input, status, code) => {
    const result = await request(input)
    assert.equal(result.status, status)
    assert.equal(result.data.error.code, code)
    assert.ok(result.data.error.requestId)
    assert.deepEqual(Object.keys(result.data), ['error'])
    evidence.push({ name, status, code, requestId: result.data.error.requestId })
  }
  for (const plan of paidPlans) {
    const input = {
      path: `/v1/wholesale/orders/${plan.orderId}/fulfill`,
      method: 'POST',
      key: plan.key,
      body: paidBody(plan),
    }
    const replay = await request(input)
    assert.equal(replay.status, 201)
    assert.deepEqual(replay.data, paidResponse(plan))
    evidence.push({ name: `${plan.term}: original historical response recovered`, status: 201 })
    const repeat = await request(input)
    assert.equal(repeat.status, 201)
    assert.deepEqual(repeat.data, replay.data)
    evidence.push({ name: `${plan.term}: repeated exact-key replay unchanged`, status: 201 })
    await deny(
      `${plan.term}: changed body on historical key rejected`,
      { ...input, body: paidBody(plan, 159999) },
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
    )
    await deny(
      `${plan.term}: new delivery key on cancelled order rejected`,
      { ...input, key: `uat-paid-${plan.term.toLowerCase()}-newkey-20261013` },
      409,
      'WHOLESALE_ORDER_STATUS_CONFLICT',
    )
  }
  const approval = { action: 'confirm', approvedExcessMinor: 1, reason: 'Synthetic Staging approval denial UAT' }
  await deny(
    'Approval creation with past expiry rejected',
    {
      path: '/v1/wholesale/credit-overrides',
      method: 'POST',
      key: 'uat-paid-expired-approval-20261013',
      body: { ...approval, salesOrderId: paidPlans[0].orderId, expiresAt: '2026-10-12T00:00:00Z' },
    },
    400,
    'WHOLESALE_OVERRIDE_HCCO5',
  )
  const expiresAt = new Date(Date.parse(`${day}T00:00:00Z`) + 2 * 86400000).toISOString()
  await deny(
    'Approval creation for nonexistent order scope rejected',
    {
      path: '/v1/wholesale/credit-overrides',
      method: 'POST',
      key: 'uat-paid-missing-approval-scope-20261013',
      body: { ...approval, salesOrderId: staging.absentOrderId, expiresAt },
    },
    404,
    'WHOLESALE_OVERRIDE_HCCO3',
  )
  assert.deepEqual(await get('/v1/wholesale/orders'), before, 'Order/inventory/invoice context changed')
  assert.deepEqual(await get('/v1/wholesale/funds'), funds, 'Receipt/fund context changed')
  assert.deepEqual((await get('/v1/wholesale/credit-overrides')).overrides, approvals.overrides, 'Approvals changed')
  evidence.push({ name: 'Order, invoice, stock, receipt, fund and approval contexts unchanged', status: 200 })
  return evidence
}
