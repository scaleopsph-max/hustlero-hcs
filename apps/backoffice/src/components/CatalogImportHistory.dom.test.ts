import { createElement, StrictMode, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest'
import { planCatalogImport } from '@hcs/domain'
const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/supabase-browser', () => ({ createClient: () => ({ auth: { getSession: mocks.getSession } }) }))
vi.mock('./Topbar', () => ({
  Topbar: ({ title, actions }: { title: string; actions: ReactNode }) =>
    createElement('header', null, createElement('h1', null, title), actions),
}))
const user = '18000000-0000-4000-8000-000000000001',
  tenant = '28000000-0000-4000-8000-000000000001',
  id = '38000000-0000-4000-8000-000000000001'
const source = { filename: 'catalog.csv', rows: [{ product_name: 'Shoes', sku: 'SHOE-8', retail_price: '499.99' }] }
const fixture = {
  id,
  filename: source.filename,
  uploaderId: user,
  state: 'preview',
  rowCount: 1,
  rejectedCount: 0,
  proposedCreates: 1,
  proposedUpdates: 0,
  createdAt: '2026-10-27T00:00:00Z',
  cancelledAt: null,
  source,
  rows: planCatalogImport(source.rows, { categories: [], products: [] }),
}
let History: typeof import('./CatalogImportHistory').CatalogImportHistory
let deny: boolean,
  owner: boolean,
  cancelled: boolean,
  wrongId: boolean,
  requests: { path: string; method: string; body: unknown }[]
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://jobs-api.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://jobs-auth.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic')
  History = (await import('./CatalogImportHistory')).CatalogImportHistory
})
beforeEach(() => {
  localStorage.clear()
  deny = false
  owner = true
  cancelled = false
  wrongId = false
  requests = []
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'synthetic', user: { id: user } } },
    error: null,
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname,
        method = init?.method ?? 'GET'
      if (path === '/v1/me')
        return Response.json({
          userId: user,
          tenants: [
            {
              tenantId: tenant,
              tenantSlug: 'synthetic',
              tenantName: 'Synthetic',
              isOwner: owner,
              employeeId: null,
              locationIds: [],
              locationCount: 1,
              permissions: [],
              entitlements: [],
            },
          ],
        })
      requests.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      expect(new Headers(init?.headers).get('x-tenant-id')).toBe(tenant)
      if (deny) return Response.json({ error: { message: 'Access revoked' } }, { status: 403 })
      if (path.endsWith('/execution')) return Response.json({ execution: null })
      if (path.endsWith('/jobs'))
        return Response.json({
          jobs: [
            {
              ...fixture,
              state: cancelled ? 'cancelled' : 'preview',
              cancelledAt: cancelled ? '2026-10-27T01:00:00Z' : null,
            },
          ],
        })
      if (method === 'POST') cancelled = true
      return Response.json({
        ...fixture,
        id: wrongId ? tenant : id,
        state: cancelled ? 'cancelled' : 'preview',
        cancelledAt: cancelled ? '2026-10-27T01:00:00Z' : null,
      })
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
afterAll(() => vi.unstubAllEnvs())
async function mount(strict = false) {
  render(strict ? createElement(StrictMode, null, createElement(History)) : createElement(History))
  await screen.findByRole('button', { name: 'View catalog.csv' })
}
it('loads history and original exact-money rows without any posting control', async () => {
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'View catalog.csv' }))
  await screen.findByText('SHOE-8')
  expect(screen.getByText(/499\.99/)).toBeTruthy()
  expect(requests.every((row) => row.method === 'GET')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
})
it('requires explicit cancellation and retains history', async () => {
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'View catalog.csv' }))
  await screen.findByText('SHOE-8')
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel preview' }))
  expect(requests.every((row) => row.method === 'GET')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }))
  await waitFor(() => expect(requests.filter((row) => row.method === 'POST')).toHaveLength(1))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel preview' })).toBeNull())
  expect(screen.getByText('SHOE-8')).toBeTruthy()
  expect(screen.getByText('cancelled')).toBeTruthy()
})
it('clears stale job rows on refresh denial', async () => {
  await mount()
  deny = true
  fireEvent.click(screen.getByRole('button', { name: 'Refresh import history' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'View catalog.csv' })).toBeNull()
})
it('rejects a detail response for another job', async () => {
  await mount()
  wrongId = true
  fireEvent.click(screen.getByRole('button', { name: 'View catalog.csv' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('SHOE-8')).toBeNull()
})
it('does not issue job reads for an unauthorized role', async () => {
  owner = false
  render(createElement(History))
  await screen.findByRole('alert')
  expect(requests).toHaveLength(0)
})
it('does not strand loading under StrictMode effect replay', async () => {
  await mount(true)
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Refresh import history' }) as HTMLButtonElement).disabled).toBe(false),
  )
})
it('does not cancel after an account switch', async () => {
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'View catalog.csv' }))
  await screen.findByText('SHOE-8')
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel preview' }))
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'other', user: { id: tenant } } },
    error: null,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }))
  await screen.findByRole('alert')
  expect(requests.filter((row) => row.method === 'POST')).toHaveLength(0)
})
