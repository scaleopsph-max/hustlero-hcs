/* global fetch, URL, AbortSignal */
import assert from 'node:assert/strict'
import { staging } from './staging-isolation-uat.mjs'
import { fundPlan } from './staging-fund-recovery-uat.mjs'

export const secondTenantPlan = Object.freeze({
  key: 'uat-second-tenant-20261013-bootstrap',
  body: Object.freeze({
    name: 'HCS Isolation UAT B',
    slug: 'hcs-isolation-uat-b-20261013',
    baseCurrency: 'PHP',
    timezone: 'Asia/Manila',
    mainLocation: Object.freeze({ code: 'UATB', name: 'Main UAT B' }),
  }),
})
const uuid = (value) =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export function createSecondTenantBootstrapRequest(token, transport = fetch) {
  assert.ok(token && !/[\r\n]/.test(token), 'Session required')
  return async ({ path, method = 'GET', body, idempotencyKey }) => {
    const url = new URL(path, staging.api)
    assert.equal(url.origin, staging.api, 'Staging only')
    assert.ok(
      (method === 'GET' && path === '/v1/me' && body === undefined && idempotencyKey === undefined) ||
        (method === 'POST' && path === '/v1/tenants'),
      'Only fixed bootstrap and identity reads allowed',
    )
    if (method === 'POST') {
      assert.deepEqual(body, secondTenantPlan.body, 'Exact approved business profile required')
      assert.equal(idempotencyKey, secondTenantPlan.key, 'Fixed creation key required')
    }
    const response = await transport(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json() }
  }
}

export async function runSecondTenantBootstrapSuite(request, onCase = () => {}) {
  const evidence = []
  const record = (entry) => {
    evidence.push(entry)
    onCase(entry)
  }
  const readIdentity = async () => {
    const result = await request({ path: '/v1/me' })
    assert.equal(result.status, 200)
    assert.equal(result.data.userId, fundPlan.ownerId, 'Exact existing Staging owner required')
    assert.ok(Array.isArray(result.data.tenants))
    return result.data
  }
  const before = await readIdentity()
  assert.equal(before.tenants.length, 1, 'Unexpected membership baseline; reconcile before bootstrap')
  assert.equal(before.tenants[0].tenantId, staging.tenantId)
  assert.equal(before.tenants[0].isOwner, true)
  assert.ok(!before.tenants.some((row) => row.tenantSlug === secondTenantPlan.body.slug))
  record({ name: 'Exact owner and single existing PABL0 membership', status: 200 })
  const created = await request({
    path: '/v1/tenants',
    method: 'POST',
    body: secondTenantPlan.body,
    idempotencyKey: secondTenantPlan.key,
  })
  assert.equal(created.status, 201, 'Bootstrap outcome must be reconciled before another attempt')
  assert.ok(uuid(created.data.tenantId) && uuid(created.data.mainLocationId))
  assert.notEqual(created.data.tenantId, staging.tenantId)
  assert.notEqual(created.data.mainLocationId, staging.otherBranchId)
  assert.notEqual(created.data.mainLocationId, staging.branchId)
  assert.equal(created.data.status, 'setup')
  record({
    name: 'Approved synthetic B business and main location created',
    status: 201,
    tenantId: created.data.tenantId,
    mainLocationId: created.data.mainLocationId,
  })
  const after = await readIdentity()
  assert.equal(after.tenants.length, 2)
  assert.deepEqual(
    after.tenants.find((row) => row.tenantId === staging.tenantId),
    before.tenants[0],
    'PABL0 access context changed',
  )
  const b = after.tenants.find((row) => row.tenantId === created.data.tenantId)
  assert.ok(b)
  assert.equal(b.tenantSlug, secondTenantPlan.body.slug)
  assert.equal(b.tenantName, secondTenantPlan.body.name)
  assert.equal(b.isOwner, true)
  assert.equal(b.locationCount, 1)
  record({
    name: 'Separate B owner membership verified; PABL0 unchanged; financial fixture stage not executed',
    status: 200,
  })
  return evidence
}
