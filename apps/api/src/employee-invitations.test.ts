import { expect, it, vi } from 'vitest'
import { createApp } from './app'
const actor = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001',
  employee = '30000000-0000-4000-8000-000000000001',
  invitation = '40000000-0000-4000-8000-000000000001'
const headers = {
  authorization: 'Bearer synthetic',
  'x-tenant-id': tenant,
  'content-type': 'application/json',
  'idempotency-key': 'invite-api-test-key-001',
}
function setup() {
  const repository = {
    create: vi.fn(async () => ({
      invitationId: invitation,
      employeeId: employee,
      email: 'staff@example.invalid',
      expiresAt: '2026-11-01T00:00:00Z',
    })),
    list: vi.fn(async () => []),
    accept: vi.fn(async () => ({ invitationId: invitation, tenantId: tenant, employeeId: employee })),
    revoke: vi.fn(async () => ({ invitationId: invitation, status: 'revoked' as const })),
  }
  const app = createApp({
    verifyAccessToken: async (token) => (token === 'synthetic' ? { userId: actor } : null),
    loadSessionAccess: async () => [
      {
        tenantId: tenant,
        tenantSlug: 'synthetic',
        tenantName: 'Synthetic',
        isOwner: true,
        employeeId: null,
        locationIds: [],
        locationCount: 1,
        permissions: [],
        entitlements: [],
      },
    ],
    employeeInvitations: repository,
  })
  return { repository, request: (path: string, init?: RequestInit) => app.request(path, init, { ENVIRONMENT: 'test' }) }
}
it('requires authentication and binds creation to the verified business', async () => {
  const { request, repository } = setup()
  expect((await request('/v1/employee-invitations', { method: 'POST' })).status).toBe(401)
  expect(
    (
      await request('/v1/employee-invitations', {
        method: 'POST',
        headers: { ...headers, 'x-tenant-id': invitation },
        body: JSON.stringify({ employeeId: employee, email: 'staff@example.invalid' }),
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await request('/v1/employee-invitations', {
        method: 'POST',
        headers,
        body: JSON.stringify({ employeeId: employee, email: 'staff@example.invalid', tenantId: tenant }),
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await request('/v1/employee-invitations', {
        method: 'POST',
        headers,
        body: JSON.stringify({ employeeId: employee, email: 'staff@example.invalid' }),
      })
    ).status,
  ).toBe(201)
  expect(repository.create).toHaveBeenCalledWith(
    actor,
    tenant,
    { employeeId: employee, email: 'staff@example.invalid' },
    headers['idempotency-key'],
    expect.any(String),
    expect.anything(),
  )
})
it('lists and accepts only through the authenticated actor', async () => {
  const { request, repository } = setup()
  expect((await request('/v1/employee-invitations', { headers })).status).toBe(200)
  expect((await request(`/v1/employee-invitations/${invitation}/accept`, { method: 'POST', headers })).status).toBe(200)
  expect(repository.accept).toHaveBeenCalledWith(
    actor,
    invitation,
    headers['idempotency-key'],
    expect.any(String),
    expect.anything(),
  )
})
