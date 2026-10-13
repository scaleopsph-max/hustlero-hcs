/* global fetch, URL, AbortSignal */
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { staging } from './staging-isolation-uat.mjs'
import { fundPlan } from './staging-fund-recovery-uat.mjs'
import { rollbackDraft, rollbackPlan } from './staging-paid-rollback-uat.mjs'

export const approvalPlan = Object.freeze({
  names: ['SO-AW3-SCOPE-A-20261013', 'SO-AW3-SCOPE-B-20261013'],
  reason: 'Synthetic Staging approval consumption UAT; cancel orders and revoke approvals after tests',
  excessMinor: 140000,
})
const key = (step) => `uat-approval-scope-20261013-${step}`
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const roles = ['a-main', 'a-action', 'b-expiring']
export const approvalReason = (role) => `${approvalPlan.reason}: ${role}`

export function createApprovalRequest(token, transport = fetch) {
  assert.ok(token && !/[\r\n]/.test(token))
  const orders = new Map()
  const approvals = new Map()
  let lineId = null
  return async ({ path, method = 'GET', body, idempotencyKey }) => {
    const url = new URL(path, staging.api)
    assert.equal(url.origin, staging.api)
    if (method === 'GET')
      assert.ok(
        [
          '/v1/me',
          '/v1/wholesale/orders',
          '/v1/wholesale/credit-overrides',
          '/v1/wholesale/credit-settings',
          '/v1/wholesale/funds',
          '/v1/wholesale/receivables',
        ].includes(path),
      )
    else {
      assert.equal(method, 'POST')
      if (path === '/v1/wholesale/orders') {
        const name = approvalPlan.names.find((name) => name === body.orderNumber)
        assert.ok(name)
        assert.deepEqual(body, { ...rollbackDraft, orderNumber: name, notes: approvalPlan.reason })
        assert.equal(idempotencyKey, key(name === approvalPlan.names[0] ? 'draft-a' : 'draft-b'))
      } else if (path === '/v1/wholesale/credit-overrides') {
        const role = roles.find((role) => idempotencyKey === key(role))
        assert.ok(role)
        assert.equal(body.salesOrderId, orders.get(role === 'b-expiring' ? 'b' : 'a'))
        assert.equal(body.action, 'confirm')
        assert.equal(body.approvedExcessMinor, 140000)
        assert.equal(body.reason, approvalReason(role))
        assert.deepEqual(Object.keys(body).sort(), [
          'action',
          'approvedExcessMinor',
          'expiresAt',
          'reason',
          'salesOrderId',
        ])
        assert.ok(
          Number.isFinite(Date.parse(body.expiresAt)) && Date.parse(body.expiresAt) <= Date.now() + 600000,
          'Bounded expiry required',
        )
      } else {
        const cancelTarget = ['a', 'b'].find((role) => path === `/v1/wholesale/orders/${orders.get(role)}/cancel`)
        const revokeTarget = roles.find(
          (role) => path === `/v1/wholesale/credit-overrides/${approvals.get(role)}/revoke`,
        )
        if (cancelTarget) {
          assert.equal(idempotencyKey, key(`cancel-${cancelTarget}`))
          assert.deepEqual(body, { reason: approvalPlan.reason })
        } else if (revokeTarget) {
          assert.equal(idempotencyKey, key(`revoke-${revokeTarget}`))
          assert.deepEqual(body, { reason: approvalPlan.reason })
        } else if (path === `/v1/wholesale/orders/${orders.get('a')}/fulfill`) {
          assert.equal(idempotencyKey, key('wrong-action'))
          assert.ok(lineId)
          assert.deepEqual(body, {
            creditOverrideId: approvals.get('a-action'),
            lines: [{ salesOrderLineId: lineId, quantityMilli: 2000 }],
          })
        } else {
          const step =
            idempotencyKey === key('wrong-order')
              ? 'wrong-order'
              : idempotencyKey === key('expired')
                ? 'expired'
                : idempotencyKey === key('confirm-a')
                  ? 'confirm-a'
                  : null
          assert.ok(step)
          assert.equal(path, `/v1/wholesale/orders/${orders.get(step === 'confirm-a' ? 'a' : 'b')}/confirm`)
          assert.deepEqual(body, { creditOverrideId: approvals.get(step === 'expired' ? 'b-expiring' : 'a-main') })
        }
      }
    }
    const response = await transport(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': staging.tenantId,
        ...(method === 'POST' ? { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const data = await response.json()
    if (path === '/v1/wholesale/orders' && method === 'GET')
      for (const row of data.orders ?? []) {
        const index = approvalPlan.names.indexOf(row.orderNumber)
        if (index >= 0) {
          assert.ok(uuid(row.id))
          orders.set(index === 0 ? 'a' : 'b', row.id)
          if (index === 0) lineId = row.lines.find((line) => line.variantId === rollbackPlan.secondVariant)?.id
        }
      }
    if (path === '/v1/wholesale/orders' && method === 'POST' && response.status === 201) {
      assert.ok(uuid(data.salesOrderId))
      orders.set(body.orderNumber === approvalPlan.names[0] ? 'a' : 'b', data.salesOrderId)
    }
    if (path === '/v1/wholesale/credit-overrides' && method === 'POST' && response.status === 201) {
      assert.ok(uuid(data.overrideId))
      approvals.set(
        roles.find((role) => idempotencyKey === key(role)),
        data.overrideId,
      )
    }
    if (path === '/v1/wholesale/credit-overrides' && method === 'GET')
      for (const row of data.overrides ?? []) {
        const role = roles.find((role) => row.reason === approvalReason(role))
        if (role) {
          assert.equal(row.salesOrderId, orders.get(role === 'b-expiring' ? 'b' : 'a'))
          assert.ok(uuid(row.overrideId))
          approvals.set(role, row.overrideId)
        }
      }
    return { status: response.status, data }
  }
}

export async function waitForActualExpiry(load, id) {
  const deadline = Date.now() + 65000
  while (Date.now() < deadline) {
    const context = await load()
    const row = context.overrides.find((row) => row.overrideId === id)
    assert.ok(row)
    if (row.status === 'expired') return context
    assert.equal(row.status, 'approved')
    await sleep(1000)
  }
  throw Error('Server expiry not observed within bounded wait')
}

export async function runApprovalConsumptionSuite(request, waitExpired = waitForActualExpiry, onCase = () => {}) {
  const evidence = []
  const record = (entry) => {
    evidence.push(entry)
    onCase(entry)
  }
  const get = async (path) => {
    const r = await request({ path })
    assert.equal(r.status, 200)
    return r.data
  }
  const post = async (path, body, step, status) => {
    const r = await request({ path, body, method: 'POST', idempotencyKey: key(step) })
    assert.equal(r.status, status)
    return r.data
  }
  const me = await get('/v1/me')
  assert.equal(me.userId, fundPlan.ownerId)
  assert.ok(me.tenants.some((row) => row.tenantId === staging.tenantId && row.isOwner))
  const before = await get('/v1/wholesale/orders')
  assert.ok(
    !before.orders.some((row) => approvalPlan.names.includes(row.orderNumber)),
    'Existing test fixtures: reconcile instead of rerun',
  )
  const settings = await get('/v1/wholesale/credit-settings')
  const original = settings.customers.find((row) => row.customerId === rollbackPlan.customerId).settings
  assert.equal(original.paymentTerm, 'net_7')
  assert.equal(original.creditLimitMinor, 500000)
  const debt = await get('/v1/wholesale/receivables')
  assert.ok(
    debt.invoices.every((row) => Number.isSafeInteger(row.openBalanceMinor)),
    'All invoices must be classified',
  )
  assert.equal(
    debt.invoices.reduce((sum, row) => sum + row.openBalanceMinor, 0),
    160000,
    'Debt/excess baseline changed',
  )
  const funds = await get('/v1/wholesale/funds')
  for (const [variant, qty] of [
    [rollbackPlan.firstVariant, 2000],
    [rollbackPlan.secondVariant, 4000],
  ])
    assert.ok(
      before.inventory.some(
        (row) => row.variantId === variant && row.locationId === staging.otherBranchId && row.availableMilli >= qty,
      ),
    )
  record({ name: 'Exact owner, original terms and stock baseline', status: 200 })
  let started = false
  let runError = null
  const cleanupErrors = []
  try {
    started = true
    const a = await post(
      '/v1/wholesale/orders',
      { ...rollbackDraft, orderNumber: approvalPlan.names[0], notes: approvalPlan.reason },
      'draft-a',
      201,
    )
    const b = await post(
      '/v1/wholesale/orders',
      { ...rollbackDraft, orderNumber: approvalPlan.names[1], notes: approvalPlan.reason },
      'draft-b',
      201,
    )
    assert.equal(a.totalMinor, 480000)
    assert.equal(b.totalMinor, 480000)
    const draftContext = await get('/v1/wholesale/orders')
    assert.deepEqual(draftContext.inventory, before.inventory)
    record({ name: 'Two six-unit drafts; no reservation', status: 201 })
    const approve = async (role, id, seconds) => {
      const clock = await get('/v1/wholesale/credit-overrides')
      const expiresAt = new Date(Date.parse(clock.asOf) + seconds * 1000).toISOString()
      return post(
        '/v1/wholesale/credit-overrides',
        { salesOrderId: id, action: 'confirm', approvedExcessMinor: 140000, expiresAt, reason: approvalReason(role) },
        role,
        201,
      )
    }
    const main = await approve('a-main', a.salesOrderId, 480)
    const action = await approve('a-action', a.salesOrderId, 480)
    record({ name: 'Two unconsumed confirm approvals for A, exact PHP 1,400 excess', status: 201 })
    const deny = async (step, path, body, baseline) => {
      const r = await request({ path, body, method: 'POST', idempotencyKey: key(step) })
      assert.equal(r.status, 409)
      assert.equal(r.data.error.code, 'WHOLESALE_OVERRIDE_HCCO6')
      assert.ok(r.data.error.requestId)
      assert.deepEqual(Object.keys(r.data), ['error'])
      assert.deepEqual(await get('/v1/wholesale/orders'), baseline)
      assert.deepEqual(await get('/v1/wholesale/funds'), funds)
      record({
        name: `${step}: invalid approval rejected with complete business rollback`,
        status: 409,
        code: r.data.error.code,
        requestId: r.data.error.requestId,
      })
    }
    await deny(
      'wrong-order',
      `/v1/wholesale/orders/${b.salesOrderId}/confirm`,
      { creditOverrideId: main.overrideId },
      draftContext,
    )
    const expiring = await approve('b-expiring', b.salesOrderId, 25)
    const expiredContext = await waitExpired(() => get('/v1/wholesale/credit-overrides'), expiring.overrideId)
    assert.equal(expiredContext.overrides.find((row) => row.overrideId === expiring.overrideId).status, 'expired')
    record({ name: 'B approval observed actually expired by server', status: 200 })
    await deny(
      'expired',
      `/v1/wholesale/orders/${b.salesOrderId}/confirm`,
      { creditOverrideId: expiring.overrideId },
      draftContext,
    )
    await post(
      `/v1/wholesale/orders/${a.salesOrderId}/confirm`,
      { creditOverrideId: main.overrideId },
      'confirm-a',
      200,
    )
    const confirmed = await get('/v1/wholesale/orders')
    const aOrder = confirmed.orders.find((row) => row.id === a.salesOrderId)
    assert.equal(aOrder.status, 'confirmed')
    const approvals = await get('/v1/wholesale/credit-overrides')
    const consumed = approvals.overrides.find((row) => row.overrideId === main.overrideId)
    assert.equal(consumed.status, 'consumed')
    assert.equal(consumed.consumption.excessMinor, 140000)
    const wrongAction = approvals.overrides.find((row) => row.overrideId === action.overrideId)
    assert.equal(wrongAction.status, 'approved')
    assert.equal(wrongAction.consumption, null)
    assert.equal(wrongAction.action, 'confirm')
    record({ name: 'Valid A confirmation consumes only main approval once', status: 200 })
    const line = aOrder.lines.find((row) => row.variantId === rollbackPlan.secondVariant)
    await deny(
      'wrong-action',
      `/v1/wholesale/orders/${a.salesOrderId}/fulfill`,
      { creditOverrideId: action.overrideId, lines: [{ salesOrderLineId: line.id, quantityMilli: 2000 }] },
      confirmed,
    )
  } catch (error) {
    runError = error
  } finally {
    if (started) {
      for (const [index, name] of approvalPlan.names.entries())
        try {
          const context = await get('/v1/wholesale/orders')
          const row = context.orders.find((row) => row.orderNumber === name)
          if (row && ['confirmed', 'partially_fulfilled'].includes(row.status))
            await post(
              `/v1/wholesale/orders/${row.id}/cancel`,
              { reason: approvalPlan.reason },
              `cancel-${index === 0 ? 'a' : 'b'}`,
              200,
            )
        } catch (error) {
          cleanupErrors.push(error)
        }
      for (const role of roles)
        try {
          const context = await get('/v1/wholesale/credit-overrides')
          const row = context.overrides.find((row) => row.reason === approvalReason(role))
          if (row && !row.revokedAt)
            await post(
              `/v1/wholesale/credit-overrides/${row.overrideId}/revoke`,
              { reason: approvalPlan.reason },
              `revoke-${role}`,
              201,
            )
        } catch (error) {
          cleanupErrors.push(error)
        }
    }
  }
  if (cleanupErrors.length) throw Error('Approval/order cleanup incomplete; independently reconcile before proceeding')
  if (runError) throw runError
  const after = await get('/v1/wholesale/orders')
  assert.deepEqual(after.inventory, before.inventory)
  assert.deepEqual(after.invoices, before.invoices)
  for (const name of approvalPlan.names) {
    const row = after.orders.find((row) => row.orderNumber === name)
    assert.ok(['draft', 'cancelled'].includes(row.status))
    assert.ok(
      row.lines.every(
        (line) =>
          line.fulfilledQuantityMilli === 0 &&
          line.cancelledQuantityMilli === (row.status === 'draft' ? 0 : line.orderedQuantityMilli),
      ),
    )
  }
  assert.deepEqual(await get('/v1/wholesale/funds'), funds)
  assert.deepEqual(await get('/v1/wholesale/credit-settings'), settings)
  const endingDebt = await get('/v1/wholesale/receivables')
  assert.deepEqual(endingDebt, debt)
  const endingApprovals = (await get('/v1/wholesale/credit-overrides')).overrides.filter((row) =>
    roles.some((role) => row.reason === approvalReason(role)),
  )
  assert.equal(endingApprovals.length, 3)
  assert.ok(endingApprovals.every((row) => row.revokedAt))
  assert.equal(endingApprovals.filter((row) => row.consumption !== null).length, 1)
  record({
    name: 'Confirmed orders cancelled, inert drafts retained; approvals revoked and business balances restored',
    status: 200,
  })
  return evidence
}
