import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSecondTenantBootstrapRequest,
  runSecondTenantBootstrapSuite,
  secondTenantPlan,
} from './staging-second-tenant-uat.mjs'
import { staging } from './staging-isolation-uat.mjs'
import { fundPlan } from './staging-fund-recovery-uat.mjs'

const bId = '81000000-0000-4000-8000-000000000001'
const locationId = '81000000-0000-4000-8000-000000000002'
const a = { tenantId: staging.tenantId, tenantName: 'PABL0', tenantSlug: 'pabl0', isOwner: true, locationCount: 2 }
const b = {
  tenantId: bId,
  tenantName: secondTenantPlan.body.name,
  tenantSlug: secondTenantPlan.body.slug,
  isOwner: true,
  locationCount: 1,
}

function mock({ userId = fundPlan.ownerId, existing = false, changedA = false, unknown = false } = {}) {
  let created = existing
  let posts = 0
  return {
    get posts() {
      return posts
    },
    request: async (input) => {
      if (input.method !== 'POST')
        return {
          status: 200,
          data: { userId, tenants: created ? [{ ...a, ...(changedA ? { isOwner: false } : {}) }, b] : [a] },
        }
      assert.deepEqual(input, {
        path: '/v1/tenants',
        method: 'POST',
        body: secondTenantPlan.body,
        idempotencyKey: secondTenantPlan.key,
      })
      posts++
      created = true
      if (unknown) throw Error('Response lost after commit')
      return { status: 201, data: { tenantId: bId, mainLocationId: locationId, status: 'setup' } }
    },
  }
}

test('fixed bootstrap creates one business and verifies distinct owner context, without financial writes', async () => {
  const fixture = mock()
  const progress = []
  const result = await runSecondTenantBootstrapSuite(fixture.request, (entry) => progress.push(entry))
  assert.equal(fixture.posts, 1)
  assert.equal(result.length, 3)
  assert.deepEqual(progress, result)
  assert.equal(result[1].tenantId, bId)
})

test('wrong owner or existing second business stops before a creation request', async () => {
  for (const fixture of [mock({ userId: staging.userId }), mock({ existing: true })]) {
    await assert.rejects(() => runSecondTenantBootstrapSuite(fixture.request))
    assert.equal(fixture.posts, 0)
  }
})

test('unknown committed result is not retried and preserves completed preflight evidence', async () => {
  const fixture = mock({ unknown: true })
  const progress = []
  await assert.rejects(
    () => runSecondTenantBootstrapSuite(fixture.request, (entry) => progress.push(entry)),
    /Response lost/,
  )
  assert.equal(fixture.posts, 1)
  assert.equal(progress.length, 1)
})

test('PABL0 context drift after bootstrap fails rather than claiming isolation passed', async () => {
  const fixture = mock({ changedA: true })
  await assert.rejects(() => runSecondTenantBootstrapSuite(fixture.request), /PABL0 access context changed/)
  assert.equal(fixture.posts, 1)
})

test('transport blocks Production, path aliases, unrelated writes, altered profile and creation keys', async () => {
  let calls = 0
  const request = createSecondTenantBootstrapRequest('synthetic-test-token', async () => {
    calls++
    return { status: 200, json: async () => ({}) }
  })
  const post = {
    path: '/v1/tenants',
    method: 'POST',
    body: secondTenantPlan.body,
    idempotencyKey: secondTenantPlan.key,
  }
  for (const input of [
    { path: 'https://hustlero-hcs-api.scaleopsph.workers.dev/v1/me' },
    { path: '//hustlero-hcs-api.scaleopsph.workers.dev/v1/me' },
    { path: '/v1/tenants/../me' },
    { ...post, path: '/v1/wholesale/payments' },
    { ...post, body: { ...secondTenantPlan.body, name: 'Unapproved' } },
    { ...post, idempotencyKey: `${secondTenantPlan.key}-retry` },
    { path: '/v1/me', body: {} },
  ])
    await assert.rejects(() => request(input))
  assert.equal(calls, 0)
})

test('transport sends fixed Staging request without client actor or tenant context', async () => {
  const request = createSecondTenantBootstrapRequest('synthetic-test-token', async (url, init) => {
    assert.equal(url.origin, staging.api)
    assert.equal(init.redirect, 'error')
    assert.equal(init.headers['X-Tenant-Id'], undefined)
    assert.deepEqual(JSON.parse(init.body), secondTenantPlan.body)
    assert.equal(init.headers['Idempotency-Key'], secondTenantPlan.key)
    return { status: 201, json: async () => ({ tenantId: bId }) }
  })
  assert.equal(
    (
      await request({
        path: '/v1/tenants',
        method: 'POST',
        body: secondTenantPlan.body,
        idempotencyKey: secondTenantPlan.key,
      })
    ).status,
    201,
  )
})
