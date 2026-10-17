import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createApiRequest,
  runIsolationSuite,
  runnerSecurityHeaders,
  staging,
  validateTester,
} from './staging-isolation-uat.mjs'

test('private form policy preserves same-origin POST Origin without external referrer disclosure', () => {
  assert.equal(runnerSecurityHeaders['Referrer-Policy'], 'same-origin')
  assert.equal(runnerSecurityHeaders['Cache-Control'], 'no-store')
  assert.ok(runnerSecurityHeaders['Content-Security-Policy'].includes("form-action 'self'"))
  assert.ok(runnerSecurityHeaders['Content-Security-Policy'].includes("frame-ancestors 'none'"))
})

const membership = () => ({
  userId: staging.userId,
  tenants: [
    {
      tenantId: staging.tenantId,
      isOwner: false,
      employeeId: 'employee',
      locationIds: [staging.branchId],
      permissions: ['reports.read', 'wholesale_orders.read'],
      entitlements: ['advanced_wholesale'],
    },
  ],
})
test('rejects owner, broad permissions, additional branches and wrong identity before commands', () => {
  validateTester(membership())
  for (const mutate of [
    (data) => {
      data.tenants[0].isOwner = true
    },
    (data) => {
      data.userId = 'owner'
    },
    (data) => {
      data.tenants[0].permissions.push('wholesale_orders.manage')
    },
    (data) => {
      data.tenants[0].locationIds.push(staging.otherBranchId)
    },
    (data) => {
      data.tenants = []
    },
  ]) {
    const data = membership()
    mutate(data)
    assert.throws(() => validateTester(data))
  }
})
test('transport cannot target Production or arbitrary mutation routes; disables redirects', async () => {
  let seen
  const request = createApiRequest('synthetic-token', async (url, init) => {
    seen = { url, init }
    return { status: 200, json: async () => ({}) }
  })
  await assert.rejects(request({ path: 'https://production.example/v1/me' }))
  await assert.rejects(request({ path: '/v1/../../other' }))
  await assert.rejects(request({ path: '/v1/wholesale/orders', method: 'POST', body: {} }))
  await request({ path: '/v1/me' })
  assert.equal(seen.url.origin, staging.api)
  assert.equal(seen.init.redirect, 'error')
})
const deny = (status, code) => ({ status, data: { error: { code, requestId: 'synthetic-request' } } })
async function passingRequest(input) {
  if (input.path === '/v1/me') return { status: 200, data: membership() }
  if (input.tenantId === staging.foreignTenantId)
    return deny(403, input.path.includes('/reports/') ? 'REPORTING_ACCESS_DENIED' : 'WHOLESALE_ORDER_ACCESS_DENIED')
  if (input.method === 'POST') return deny(403, 'WHOLESALE_ORDER_ACCESS_DENIED')
  if (input.path.includes(staging.otherBranchId))
    return deny(404, input.path.includes('/statements') ? 'STATEMENT_SCOPE_ERROR' : 'REPORT_LOCATION_NOT_FOUND')
  if (input.path === '/v1/wholesale/orders')
    return {
      status: 200,
      data: { canManage: false, locations: [{ id: staging.branchId }], orders: [], inventory: [], invoices: [] },
    }
  return { status: 200, data: { scope: { locationId: staging.branchId }, locations: [{ id: staging.branchId }] } }
}
test('runs 17 explicit cases and emits only sanitized trace evidence', async () => {
  const cases = await runIsolationSuite(passingRequest, '2026-10-13')
  assert.equal(cases.length, 17)
  assert.equal(cases.at(-1).status, 403)
  assert.ok(!JSON.stringify(cases).includes('synthetic-token'))
})
test('invalid account stops before any additional request', async () => {
  let calls = 0
  await assert.rejects(
    runIsolationSuite(async () => {
      calls++
      return { status: 200, data: { ...membership(), userId: 'owner' } }
    }, '2026-10-13'),
  )
  assert.equal(calls, 1)
})
test('400 validation errors, wrong denial codes and leaked payload are not authorization passes', async () => {
  for (const bad of [
    deny(400, 'INVALID_REPORT_FILTERS'),
    deny(404, 'WRONG'),
    { ...deny(404, 'REPORT_LOCATION_NOT_FOUND'), data: { ...deny(404, 'REPORT_LOCATION_NOT_FOUND').data, rows: [] } },
  ]) {
    await assert.rejects(
      runIsolationSuite(
        (input) => (input.path.includes(staging.otherBranchId) ? bad : passingRequest(input)),
        '2026-10-13',
      ),
    )
  }
})
