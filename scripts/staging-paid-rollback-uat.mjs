/* global fetch, URL, AbortSignal */
import assert from 'node:assert/strict'
import { staging } from './staging-isolation-uat.mjs'
import { fundPlan } from './staging-fund-recovery-uat.mjs'

export const rollbackPlan = Object.freeze({
  customerId: '5a3fdf97-3259-42e4-a340-86f045998b35',
  priceListId: '1b081c72-989f-466a-9090-74a95c597b42',
  firstVariant: '0df89c7a-accc-4b58-af58-19936d0d39bf',
  secondVariant: '6e2c9331-1bd3-47a5-ab37-ffb0230b1e59',
  orderNumber: 'SO-AW3-ROLLBACK-20261013',
  reason: 'Synthetic Staging paid rollback UAT; no real collection or delivery',
  missingMethod: '00000000-0000-4000-8000-000000000003',
  methodId: 'fc75965f-b614-4a78-a1c1-562a7aad21b5',
})
const reason = rollbackPlan.reason
export const rollbackDraft = Object.freeze({
  orderNumber: rollbackPlan.orderNumber,
  customerId: rollbackPlan.customerId,
  locationId: staging.otherBranchId,
  priceListId: rollbackPlan.priceListId,
  pricingType: 'wholesale',
  notes: reason,
  lines: [
    { variantId: rollbackPlan.firstVariant, quantityMilli: 2000 },
    { variantId: rollbackPlan.secondVariant, quantityMilli: 4000 },
  ],
})
export const rollbackSettings = Object.freeze({
  customerId: rollbackPlan.customerId,
  paymentTerm: 'cod',
  creditLimitMinor: 640000,
  reason,
})
export const restoreSettings = Object.freeze({
  customerId: rollbackPlan.customerId,
  paymentTerm: 'net_7',
  creditLimitMinor: 500000,
  reason: 'Restore original terms after synthetic Staging paid rollback UAT',
})
const key = (step) => `uat-paid-rollback-20261013-${step}`
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export function createRollbackRequest(token, transport = fetch) {
  assert.ok(token && !/[\r\n]/.test(token))
  let orderId = null
  let lineId = null
  return async (input) => {
    const { path, method = 'GET', body, idempotencyKey } = input
    const url = new URL(path, staging.api)
    assert.equal(url.origin, staging.api)
    if (method === 'GET')
      assert.ok(
        ['/v1/me', '/v1/wholesale/orders', '/v1/wholesale/credit-settings', '/v1/wholesale/funds'].includes(path),
      )
    else {
      assert.equal(method, 'POST')
      if (path === '/v1/wholesale/credit-settings') {
        assert.ok(idempotencyKey === key('terms') || idempotencyKey === key('restore'))
        assert.deepEqual(body, idempotencyKey === key('terms') ? rollbackSettings : restoreSettings)
      } else if (path === '/v1/wholesale/orders') {
        assert.equal(idempotencyKey, key('draft'))
        assert.deepEqual(body, rollbackDraft)
      } else {
        assert.ok(orderId && uuid(orderId), 'Exact freshly created order required')
        if (path === `/v1/wholesale/orders/${orderId}/confirm`) {
          assert.equal(idempotencyKey, key('confirm'))
          assert.deepEqual(body, {})
        } else if (path === `/v1/wholesale/orders/${orderId}/cancel`) {
          assert.equal(idempotencyKey, key('cancel'))
          assert.deepEqual(body, { reason })
        } else {
          assert.equal(path, `/v1/wholesale/orders/${orderId}/fulfill`)
          assert.ok(lineId)
          const step = idempotencyKey?.slice(key('').length)
          assert.ok(['unpaid', 'under', 'over', 'method'].includes(step))
          const expected = { lines: [{ salesOrderLineId: lineId, quantityMilli: 2000 }] }
          if (step !== 'unpaid')
            expected.payment = {
              paymentMethodId: step === 'method' ? rollbackPlan.missingMethod : rollbackPlan.methodId,
              amountMinor: step === 'under' ? 159999 : step === 'over' ? 160001 : 160000,
              reference: 'AW3-ROLLBACK-NO-COLLECTION-20261013',
            }
          assert.deepEqual(body, expected)
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
    if (method === 'POST' && path === '/v1/wholesale/orders' && response.status === 201) {
      assert.ok(uuid(data.salesOrderId))
      orderId = data.salesOrderId
    }
    if (method === 'GET' && path === '/v1/wholesale/orders') {
      const order = data.orders?.find((row) => row.orderNumber === rollbackPlan.orderNumber)
      if (order) {
        assert.ok(uuid(order.id))
        if (orderId) assert.equal(order.id, orderId)
        orderId = order.id
        lineId = order.lines.find((row) => row.variantId === rollbackPlan.secondVariant)?.id
        assert.ok(uuid(lineId))
      }
    }
    return { status: response.status, data }
  }
}

export async function runPaidRollbackSuite(request) {
  const evidence = []
  const get = async (path) => {
    const result = await request({ path })
    assert.equal(result.status, 200)
    return result.data
  }
  const post = async (path, body, step, status) => {
    const result = await request({ path, body, method: 'POST', idempotencyKey: key(step) })
    assert.equal(result.status, status)
    return result.data
  }
  const me = await get('/v1/me')
  assert.equal(me.userId, fundPlan.ownerId)
  assert.ok(me.tenants.some((row) => row.tenantId === staging.tenantId && row.isOwner))
  const before = await get('/v1/wholesale/orders')
  assert.ok(
    !before.orders.some((row) => row.orderNumber === rollbackPlan.orderNumber),
    'Batch already has an order; reconcile instead of repeating',
  )
  const settings = await get('/v1/wholesale/credit-settings')
  const original = settings.customers.find((row) => row.customerId === rollbackPlan.customerId)?.settings
  assert.equal(original?.paymentTerm, 'net_7')
  assert.equal(original.creditLimitMinor, 500000)
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
  const priceList = before.priceLists.find((row) => row.id === rollbackPlan.priceListId)
  const entries = [rollbackPlan.firstVariant, rollbackPlan.secondVariant].map((variant) =>
    priceList.entries.find((row) => row.variantId === variant),
  )
  assert.ok(entries.every((row) => row?.unitPriceMinor === 80000 && row.thresholdMilli === 6000))
  assert.equal(entries[0].pricingGroupId, entries[1].pricingGroupId)
  evidence.push({ name: 'Exact owner, original terms and mixed-variant stock/pricing baseline', status: 200 })
  let changesStarted = false
  let cleanupError = null
  let runError = null
  try {
    changesStarted = true
    const terms = await post('/v1/wholesale/credit-settings', rollbackSettings, 'terms', 201)
    assert.equal(terms.paymentTerm, 'cod')
    assert.equal(terms.creditLimitMinor, 640000)
    const draft = await post('/v1/wholesale/orders', rollbackDraft, 'draft', 201)
    assert.equal(draft.totalMinor, 480000)
    const confirmed = await post(`/v1/wholesale/orders/${draft.salesOrderId}/confirm`, {}, 'confirm', 200)
    assert.equal(confirmed.status, 'confirmed')
    const baseline = await get('/v1/wholesale/orders')
    const order = baseline.orders.find((row) => row.id === draft.salesOrderId)
    assert.equal(order.status, 'confirmed')
    const line = order.lines.find((row) => row.variantId === rollbackPlan.secondVariant)
    assert.ok(line)
    evidence.push({ name: 'Fresh COD order reserves two P-00001 and four P-00002', status: 200 })
    for (const [step, status, code] of [
      ['unpaid', 409, 'WHOLESALE_CREDIT_HCCR3'],
      ['under', 409, 'WHOLESALE_PAID_HCSP3'],
      ['over', 409, 'WHOLESALE_PAID_HCSP3'],
      ['method', 404, 'WHOLESALE_PAYMENT_HCAP3'],
    ]) {
      const body = { lines: [{ salesOrderLineId: line.id, quantityMilli: 2000 }] }
      if (step !== 'unpaid')
        body.payment = {
          paymentMethodId: step === 'method' ? rollbackPlan.missingMethod : rollbackPlan.methodId,
          amountMinor: step === 'under' ? 159999 : step === 'over' ? 160001 : 160000,
          reference: 'AW3-ROLLBACK-NO-COLLECTION-20261013',
        }
      const result = await request({
        path: `/v1/wholesale/orders/${order.id}/fulfill`,
        method: 'POST',
        body,
        idempotencyKey: key(step),
      })
      assert.equal(result.status, status)
      assert.equal(result.data.error.code, code)
      assert.ok(result.data.error.requestId)
      assert.deepEqual(Object.keys(result.data), ['error'])
      assert.deepEqual(await get('/v1/wholesale/orders'), baseline, `${step}: invoice/stock/reservation changed`)
      assert.deepEqual(await get('/v1/wholesale/funds'), funds, `${step}: receipt/funds changed`)
      evidence.push({
        name: `Server ${step} rejection leaves confirmed order, stock, invoices and receipts unchanged`,
        status,
        code,
        requestId: result.data.error.requestId,
      })
    }
  } catch (error) {
    runError = error
  } finally {
    if (changesStarted) {
      try {
        const context = await get('/v1/wholesale/orders')
        const order = context.orders.find((row) => row.orderNumber === rollbackPlan.orderNumber)
        if (order && order.status !== 'cancelled')
          await post(`/v1/wholesale/orders/${order.id}/cancel`, { reason }, 'cancel', 200)
      } catch (error) {
        cleanupError = error
      }
      try {
        const current = (await get('/v1/wholesale/credit-settings')).customers.find(
          (row) => row.customerId === rollbackPlan.customerId,
        ).settings
        if (current.paymentTerm === 'cod' && current.creditLimitMinor === 640000) {
          const restored = await post('/v1/wholesale/credit-settings', restoreSettings, 'restore', 201)
          assert.equal(restored.paymentTerm, 'net_7')
          assert.equal(restored.creditLimitMinor, 500000)
        } else {
          assert.equal(current.paymentTerm, original.paymentTerm, 'Unexpected concurrent terms; do not overwrite')
          assert.equal(
            current.creditLimitMinor,
            original.creditLimitMinor,
            'Unexpected concurrent limit; do not overwrite',
          )
        }
      } catch (error) {
        cleanupError ??= error
      }
    }
  }
  if (cleanupError)
    throw new Error('Cleanup incomplete: independently reconcile order and restore original terms', {
      cause: cleanupError,
    })
  if (runError) throw runError
  const after = await get('/v1/wholesale/orders')
  assert.deepEqual(after.inventory, before.inventory)
  assert.deepEqual(after.invoices, before.invoices)
  const testOrder = after.orders.find((row) => row.orderNumber === rollbackPlan.orderNumber)
  assert.equal(testOrder.status, 'cancelled')
  assert.ok(
    testOrder.lines.every(
      (row) => row.fulfilledQuantityMilli === 0 && row.cancelledQuantityMilli === row.orderedQuantityMilli,
    ),
  )
  assert.deepEqual(await get('/v1/wholesale/funds'), funds)
  const restored = (await get('/v1/wholesale/credit-settings')).customers.find(
    (row) => row.customerId === rollbackPlan.customerId,
  ).settings
  assert.equal(restored.paymentTerm, original.paymentTerm)
  assert.equal(restored.creditLimitMinor, original.creditLimitMinor)
  evidence.push({
    name: 'Cancelled undelivered test order, restored stock and original terms; no new invoice/receipt',
    status: 200,
  })
  return evidence
}
