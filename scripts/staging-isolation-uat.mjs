/* global fetch, URL, AbortSignal */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export const runnerSecurityHeaders = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
})

export const staging = Object.freeze({
  api: 'https://hustlero-hcs-api-staging.scaleopsph.workers.dev',
  auth: 'https://sdfwdhbryjyfufgtfqmf.supabase.co',
  email: 'scaleopsph+hcs-uat@gmail.com',
  userId: '3e941a8a-0864-47a7-8fdc-4ae1a571cd8f',
  tenantId: 'b3a4f304-7d38-46fe-831e-db0370f9d0c3',
  branchId: 'e45f8325-1628-458a-8c3a-8fa6b4ce8289',
  otherBranchId: '4f195522-b451-4949-aed5-4bd6a75de229',
  foreignTenantId: '00000000-0000-4000-8000-000000000001',
  absentOrderId: '00000000-0000-4000-8000-000000000002',
})

export function validateTester(data) {
  assert.equal(data.userId, staging.userId, 'Unexpected authenticated identity')
  assert.equal(data.tenants?.length, 1, 'Expected exactly one membership')
  const tenant = data.tenants[0]
  assert.equal(tenant.tenantId, staging.tenantId, 'Unexpected tenant')
  assert.equal(tenant.isOwner, false, 'Owner accounts must not run this suite')
  assert.ok(tenant.employeeId, 'Employee linkage required')
  assert.deepEqual([...tenant.locationIds].sort(), [staging.branchId], 'Unexpected branch assignment')
  assert.deepEqual([...tenant.permissions].sort(), ['reports.read', 'wholesale_orders.read'], 'Unexpected permissions')
  assert.ok(tenant.entitlements.includes('advanced_wholesale'), 'Wholesale entitlement required')
}

export function createApiRequest(token, transport = fetch) {
  if (!token || /[\r\n]/.test(token)) throw new Error('Session required')
  return async ({ path, tenantId = staging.tenantId, method = 'GET', body }) => {
    if (!path.startsWith('/v1/') || path.includes('..') || path.includes('\\')) throw new Error('Invalid API path')
    const url = new URL(path, staging.api)
    if (url.origin !== staging.api) throw new Error('Only Staging API is allowed')
    if (method !== 'GET' && !(method === 'POST' && path === `/v1/wholesale/orders/${staging.absentOrderId}/confirm`)) {
      throw new Error('Command is not allowlisted')
    }
    const response = await transport(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
        ...(method === 'POST'
          ? { 'Content-Type': 'application/json', 'Idempotency-Key': `uat-denial-${randomUUID()}` }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json() }
  }
}

export async function runIsolationSuite(request, day, onCase = () => {}) {
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/)
  const evidence = []
  const check = async (name, input, expectedStatus, expectedCode, verify) => {
    const result = await request(input)
    assert.equal(result.status, expectedStatus, `${name}: unexpected HTTP status`)
    if (expectedCode) {
      assert.equal(result.data?.error?.code, expectedCode, `${name}: unexpected denial`)
      assert.ok(result.data.error.requestId, `${name}: missing request trace`)
      assert.deepEqual(Object.keys(result.data), ['error'], `${name}: denial leaks business payload`)
    }
    if (verify) verify(result.data)
    evidence.push({
      name,
      status: result.status,
      ...(expectedCode ? { code: expectedCode, requestId: result.data.error.requestId } : {}),
    })
    onCase(evidence.at(-1))
  }
  await check('Exact restricted identity', { path: '/v1/me' }, 200, null, validateTester)
  await check('Assigned-only wholesale context', { path: '/v1/wholesale/orders' }, 200, null, (data) => {
    assert.equal(data.canManage, false)
    assert.deepEqual(
      data.locations.map((row) => row.id),
      [staging.branchId],
    )
    for (const row of [...data.orders, ...data.inventory, ...data.invoices])
      assert.equal(row.locationId, staging.branchId)
  })
  const query = `from=${day}&to=${day}&channel=all`
  for (const report of ['sales', 'inventory', 'shifts', 'wholesale-settlement']) {
    await check(
      `${report}: assigned branch`,
      { path: `/v1/reports/${report}?${query}&locationId=${staging.branchId}` },
      200,
      null,
      (data) => {
        assert.equal(data.scope.locationId, staging.branchId)
        assert.deepEqual(
          data.locations.map((row) => row.id),
          [staging.branchId],
        )
      },
    )
    await check(
      `${report}: unauthorized Main Store`,
      { path: `/v1/reports/${report}?${query}&locationId=${staging.otherBranchId}` },
      404,
      'REPORT_LOCATION_NOT_FOUND',
    )
    await check(
      `${report}: non-member tenant`,
      { path: `/v1/reports/${report}?${query}`, tenantId: staging.foreignTenantId },
      403,
      'REPORTING_ACCESS_DENIED',
    )
  }
  await check(
    'Statement unauthorized branch',
    { path: `/v1/wholesale/statements?asOf=${day}&locationId=${staging.otherBranchId}` },
    404,
    'STATEMENT_SCOPE_ERROR',
  )
  await check(
    'Wholesale non-member tenant',
    { path: '/v1/wholesale/orders', tenantId: staging.foreignTenantId },
    403,
    'WHOLESALE_ORDER_ACCESS_DENIED',
  )
  await check(
    'Forbidden confirmation POST',
    { path: `/v1/wholesale/orders/${staging.absentOrderId}/confirm`, method: 'POST', body: {} },
    403,
    'WHOLESALE_ORDER_ACCESS_DENIED',
  )
  return evidence
}
