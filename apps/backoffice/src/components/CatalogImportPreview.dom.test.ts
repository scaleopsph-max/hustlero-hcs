import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { planCatalogImport } from '@hcs/domain'
import { catalogImportTemplate } from '@/lib/catalog-import-file'
const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/supabase-browser', () => ({ createClient: () => ({ auth: { getSession: mocks.getSession } }) }))
vi.mock('./Topbar', () => ({
  Topbar: ({ title, actions }: { title: string; actions: ReactNode }) =>
    createElement('header', null, createElement('h1', null, title), actions),
}))
const user = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001'
let Workspace: typeof import('./CatalogImportPreview').CatalogImportPreview
let requests: { path: string; body: string }[], owner: boolean, fail: boolean, wrongFilename: boolean
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://import-api.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://import-auth.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-only')
  Workspace = (await import('./CatalogImportPreview')).CatalogImportPreview
})
beforeEach(() => {
  localStorage.clear()
  requests = []
  owner = true
  fail = false
  wrongFilename = false
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'synthetic-only', user: { id: user } } },
    error: null,
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
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
      requests.push({ path, body: String(init?.body) })
      if (fail) return Response.json({ error: { message: 'Synthetic permission denial' } }, { status: 403 })
      const body = JSON.parse(String(init?.body))
      return Response.json({
        filename: wrongFilename ? 'other.csv' : body.filename,
        rows: planCatalogImport(body.rows, { categories: [], products: [] }),
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
async function mount() {
  render(createElement(Workspace))
  await waitFor(() => expect((screen.getByLabelText('Catalog CSV') as HTMLInputElement).disabled).toBe(false))
}
function choose(csv = catalogImportTemplate(), name = 'catalog.csv') {
  const file = new File([csv], name, { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: async () => csv })
  fireEvent.change(screen.getByLabelText('Catalog CSV'), { target: { files: [file] } })
}
it('previews explicit grouped variants and never exposes an import/post command', async () => {
  await mount()
  choose()
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByRole('table')
  expect(screen.getAllByText('Sample shoe')).toHaveLength(2)
  expect(requests).toHaveLength(1)
  expect(requests[0]?.path).toBe('/v1/catalog/imports/preview')
  expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  expect(JSON.parse(requests[0]!.body).rows[1].product_sku).toBe('SHOE-8')
})
it('rejects inventory columns locally before any preview request', async () => {
  await mount()
  choose('product_name,sku,retail_price,quantity\nShoes,SHOE-8,499,10')
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByRole('alert')
  expect(requests).toHaveLength(0)
})
it('clears the old preview on failure and when a different file is chosen', async () => {
  await mount()
  choose()
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByRole('table')
  fail = true
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('table')).toBeNull()
  choose('product_name,sku,retail_price\nOther,OTHER-8,100', 'other.csv')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('table')).toBeNull()
})
it('does not preview under another signed-in account', async () => {
  await mount()
  choose()
  mocks.getSession.mockResolvedValueOnce({
    data: { session: { access_token: 'other', user: { id: tenant } } },
    error: null,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByRole('alert')
  expect(requests).toHaveLength(0)
})
it('disables preview for readers without catalog management', async () => {
  owner = false
  render(createElement(Workspace))
  await screen.findByRole('heading', { name: 'Import preview' })
  await screen.findByRole('alert')
  expect((screen.getByLabelText('Catalog CSV') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true)
})
it('refuses a response for a different filename', async () => {
  await mount()
  choose()
  wrongFilename = true
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('table')).toBeNull()
})
