/* global fetch, URL, AbortSignal */
import assert from 'node:assert/strict'
import { runIsolationSuite, staging } from './staging-isolation-uat.mjs'
import { foreignFixture } from './staging-cross-tenant-owner.mjs'

export const testerDenialKey = 'uat-cross-tenant-tester-20261014-confirm'
const confirmationPath = `/v1/wholesale/orders/${foreignFixture.orderId}/confirm`
const extraReads = [
  ['/v1/wholesale/receivables', 'WHOLESALE_RECEIVABLE_ACCESS_DENIED'],
  ['/v1/wholesale/payments', 'WHOLESALE_PAYMENT_ACCESS_DENIED'],
  ['/v1/wholesale/statements', 'STATEMENT_ACCESS_DENIED'],
]

function approvedReads(day) {
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(day, '2026-10-14', 'Reviewed populated batch is bounded to October 14')
  const reads = new Set([`${staging.tenantId} /v1/me`, `${staging.tenantId} /v1/wholesale/orders`])
  const query = `from=${day}&to=${day}&channel=all`
  for (const report of ['sales', 'inventory', 'shifts', 'wholesale-settlement']) {
    for (const location of [staging.branchId, staging.otherBranchId])
      reads.add(`${staging.tenantId} /v1/reports/${report}?${query}&locationId=${location}`)
    reads.add(`${foreignFixture.tenantId} /v1/reports/${report}?${query}`)
  }
  reads.add(`${staging.tenantId} /v1/wholesale/statements?asOf=${day}&locationId=${staging.otherBranchId}`)
  reads.add(`${foreignFixture.tenantId} /v1/wholesale/orders`)
  for (const [path] of extraReads) reads.add(`${foreignFixture.tenantId} ${path}`)
  return reads
}

export function createCrossTenantTesterRequest(token, day, transport = fetch) {
  if (!token || /[\r\n]/.test(token)) throw new Error('Session required')
  const reads = approvedReads(day)
  return async ({ path, tenantId = staging.tenantId, method = 'GET', body }) => {
    if (method === 'GET') {
      assert.ok(reads.has(`${tenantId} ${path}`), 'Read is outside reviewed matrix')
      assert.equal(body, undefined, 'Read body not allowed')
    } else {
      assert.equal(method, 'POST', 'Only rejected confirmation is allowed')
      assert.equal(tenantId, staging.tenantId, 'Confirmation must select PABL0')
      assert.equal(path, confirmationPath, 'Only the real B test order is allowed')
      assert.deepEqual(body, {}, 'Confirmation body must be empty')
    }
    const url = new URL(path, staging.api)
    assert.equal(url.origin, staging.api)
    const response = await transport(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
        ...(method === 'POST' ? { 'Content-Type': 'application/json', 'Idempotency-Key': testerDenialKey } : {}),
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
    })
    return { status: response.status, data: await response.json() }
  }
}

export async function runCrossTenantTesterSuite(request, day, onCase = () => {}) {
  // Reuse the verified branch matrix, but resolve its sentinels to reconciled real B references.
  const mappedRequest = async (input) => {
    const mapped = {
      ...input,
      ...(input.tenantId === staging.foreignTenantId ? { tenantId: foreignFixture.tenantId } : {}),
      ...(input.path === `/v1/wholesale/orders/${staging.absentOrderId}/confirm` ? { path: confirmationPath } : {}),
    }
    const response = await request(mapped)
    if (response.status === 200) {
      const serialized = JSON.stringify(response.data)
      for (const id of Object.values(foreignFixture))
        assert.ok(!serialized.includes(id), 'Assigned read leaked populated B reference')
    }
    if (response.data?.error)
      assert.match(response.data.error.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    return response
  }
  const evidence = await runIsolationSuite(mappedRequest, day, (entry) => {
    if (entry.name === 'Forbidden confirmation POST')
      entry.name = 'Forbidden confirmation POST on real B order under PABL0'
    onCase(entry)
  })
  for (const [path, code] of extraReads) {
    const response = await mappedRequest({ path, tenantId: foreignFixture.tenantId })
    assert.equal(response.status, 403, 'Populated B read must be forbidden')
    assert.deepEqual(Object.keys(response.data), ['error'], 'Denial must not leak business data')
    assert.equal(response.data.error.code, code)
    const entry = {
      name: `Populated non-member B: ${path}`,
      status: 403,
      code,
      requestId: response.data.error.requestId,
    }
    evidence.push(entry)
    onCase(entry)
  }
  return evidence
}
