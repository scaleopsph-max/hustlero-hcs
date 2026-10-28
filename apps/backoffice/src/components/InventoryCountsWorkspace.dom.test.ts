import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/supabase-browser', () => ({ createClient: () => ({ auth: { getSession: mocks.getSession } }) }))
const user = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001',
  location = '30000000-0000-4000-8000-000000000001',
  id = '40000000-0000-4000-8000-000000000001',
  variant = '50000000-0000-4000-8000-000000000001'
let Workspace: typeof import('./InventoryCountsWorkspace').InventoryCountsWorkspace
let stale = false,
  canPost = false
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic')
  Workspace = (await import('./InventoryCountsWorkspace')).InventoryCountsWorkspace
})
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  stale = false
  canPost = false
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic' } }, error: null })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      if (path === '/v1/me')
        return Response.json({
          userId: user,
          tenants: [
            {
              tenantId: tenant,
              tenantSlug: 'synthetic',
              tenantName: 'Synthetic',
              isOwner: false,
              employeeId: null,
              locationIds: [location],
              locationCount: 1,
              permissions: [],
              entitlements: [],
            },
          ],
        })
      if (path === '/v1/inventory/stock')
        return Response.json({ error: { code: 'FORBIDDEN', message: 'Denied' } }, { status: 403 })
      if (path === '/v1/inventory/counts')
        return Response.json({
          locations: [{ id: location, name: 'Branch', canCreate: false, canEnter: true, canApprove: false, canPost }],
          counts: [{ id, locationId: location, status: 'counting', revision: 2, createdAt: '2026-10-28T00:00:00Z' }],
        })
      if (path === `/v1/inventory/counts/${id}`)
        return Response.json({
          id,
          locationId: location,
          status: 'counting',
          revision: 2,
          createdAt: '2026-10-28T00:00:00Z',
          lines: [
            {
              variantId: variant,
              productName: 'Socks',
              variantName: 'Default',
              sku: 'SOCKS',
              expectedMilli: 1000,
              balanceVersion: 1,
              countedMilli: 1000,
              currentOnHandMilli: stale ? 2000 : 1000,
              currentBalanceVersion: stale ? 2 : 1,
            },
          ],
        })
      throw new Error(`Unexpected request ${path}`)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('lets authorized staff enter counts but blocks submission until edits are saved', async () => {
  render(createElement(Workspace))
  fireEvent.click(await screen.findByRole('button', { name: /PCOUNT/ }))
  const submit = await screen.findByRole('button', { name: 'Submit count' })
  expect((submit as HTMLButtonElement).disabled).toBe(false)
  fireEvent.change(screen.getByLabelText(/Counted Socks/), { target: { value: '0' } })
  expect((submit as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('Save quantities before submitting this count.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Create PCOUNT/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Post stock adjustments' })).toBeNull()
})
it('blocks submission when stock has changed since the snapshot', async () => {
  stale = true
  render(createElement(Workspace))
  fireEvent.click(await screen.findByRole('button', { name: /PCOUNT/ }))
  expect(((await screen.findByRole('button', { name: 'Submit count' })) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(/Stock changed since this count started/)).toBeTruthy()
})
