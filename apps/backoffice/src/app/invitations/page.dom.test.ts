import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
const actor = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001',
  employee = '30000000-0000-4000-8000-000000000001',
  invitation = '40000000-0000-4000-8000-000000000001'
const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/supabase-browser', () => ({ createClient: () => ({ auth: { getSession: mocks.getSession } }) }))
let Page: typeof import('./page').default
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://invite-api.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic')
  Page = (await import('./page')).default
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})
it('retries the same acceptance and verifies membership after a lost response', async () => {
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'synthetic', user: { id: actor } } },
    error: null,
  })
  let lost = true,
    completed = false
  const keys: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/v1/employee-invitations')
        return Response.json(
          completed
            ? []
            : [
                {
                  invitationId: invitation,
                  businessName: 'Business',
                  employeeName: 'Staff',
                  expiresAt: '2026-11-01T00:00:00Z',
                },
              ],
        )
      if (path.endsWith('/accept')) {
        keys.push((init?.headers as Record<string, string>)['Idempotency-Key']!)
        completed = true
        if (lost) {
          lost = false
          throw new TypeError('lost response')
        }
        return Response.json({ invitationId: invitation, tenantId: tenant, employeeId: employee })
      }
      if (path === '/v1/me')
        return Response.json({
          userId: actor,
          tenants: [
            {
              tenantId: tenant,
              tenantSlug: 'test',
              tenantName: 'Business',
              isOwner: false,
              employeeId: employee,
              locationIds: [],
              locationCount: 0,
              permissions: [],
              entitlements: [],
            },
          ],
        })
      throw new Error('Unexpected request')
    }),
  )
  render(createElement(Page))
  fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry acceptance' }))
  await waitFor(() => expect(screen.getByText(/Invitation accepted/)).toBeTruthy())
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(sessionStorage.length).toBe(0)
})
