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
let saved: Map<string, { filename: string; rows: ReturnType<typeof planCatalogImport>; source: unknown }>,
  loseSaveResponse: boolean,
  detailFailure: boolean
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://import-api.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://import-auth.example.invalid')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-only')
  Workspace = (await import('./CatalogImportPreview')).CatalogImportPreview
})
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  requests = []
  owner = true
  fail = false
  wrongFilename = false
  saved = new Map()
  loseSaveResponse = false
  detailFailure = false
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
      if (path === '/v1/catalog/imports/jobs') {
        const body = JSON.parse(String(init?.body)),
          key = new Headers(init?.headers).get('idempotency-key')!
        if (!saved.has(key))
          saved.set(key, {
            filename: body.filename,
            source: body,
            rows: planCatalogImport(body.rows, { categories: [], products: [] }),
          })
        if (loseSaveResponse) {
          loseSaveResponse = false
          throw new Error('Response lost after commit')
        }
        return Response.json({ jobId: '30000000-0000-4000-8000-000000000001', status: 'saved' })
      }
      if (path.startsWith('/v1/catalog/imports/jobs/')) {
        if (detailFailure) return Response.json({ error: { message: 'History unavailable' } }, { status: 403 })
        const value = [...saved.values()][0]!
        return Response.json({
          id: '30000000-0000-4000-8000-000000000001',
          uploaderId: user,
          state: 'preview',
          rowCount: value.rows.length,
          rejectedCount: value.rows.filter((row) => row.issues.length > 0).length,
          proposedCreates: value.rows.filter(
            (row) => row.action === 'create_product' || row.action === 'create_variant',
          ).length,
          proposedUpdates: value.rows.filter((row) => row.action === 'update_variant').length,
          createdAt: '2026-10-27T00:00:00Z',
          cancelledAt: null,
          ...value,
        })
      }
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
async function previewFile() {
  await mount()
  choose()
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByRole('table')
}
it('saves a durable preview and reconciles its exact source without posting products', async () => {
  await previewFile()
  fireEvent.click(screen.getByRole('button', { name: 'Save preview' }))
  await screen.findByRole('status')
  expect(saved.size).toBe(1)
  expect(sessionStorage.length).toBe(0)
  expect(requests.filter((row) => row.path === '/v1/catalog/imports/jobs')).toHaveLength(1)
  expect(requests.every((row) => !row.path.endsWith('/process'))).toBe(true)
})
it('recovers a lost save response after remount using the original key and raw body', async () => {
  await previewFile()
  loseSaveResponse = true
  fireEvent.click(screen.getByRole('button', { name: 'Save preview' }))
  await screen.findByRole('alert')
  const before = sessionStorage.getItem(`hcs-import-save:${user}:${tenant}`)
  expect(before).toBeTruthy()
  cleanup()
  render(createElement(Workspace))
  await screen.findByRole('button', { name: 'Retry save' })
  expect((screen.getByLabelText('Catalog CSV') as HTMLInputElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
  await screen.findByRole('status')
  expect(saved.size).toBe(1)
  expect(requests.filter((row) => row.path === '/v1/catalog/imports/jobs').map((row) => row.body)).toEqual(
    [JSON.parse(before!).payload, JSON.parse(before!).payload].map((value) => JSON.stringify(value)),
  )
  expect(sessionStorage.length).toBe(0)
})
it('retains original retry identity when detail reconciliation is unavailable', async () => {
  await previewFile()
  detailFailure = true
  fireEvent.click(screen.getByRole('button', { name: 'Save preview' }))
  await screen.findByRole('alert')
  expect(sessionStorage.getItem(`hcs-import-save:${user}:${tenant}`)).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
  detailFailure = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
  await screen.findByRole('status')
  expect(saved.size).toBe(1)
})
it('does not send a save if durable pending storage fails', async () => {
  await previewFile()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage quota exceeded')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save preview' }))
  await screen.findByRole('alert')
  expect(saved.size).toBe(0)
  expect(requests.filter((row) => row.path === '/v1/catalog/imports/jobs')).toHaveLength(0)
})
it('does not save under a changed account', async () => {
  await previewFile()
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'other', user: { id: tenant } } },
    error: null,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save preview' }))
  await screen.findByRole('alert')
  expect(saved.size).toBe(0)
})
it('previews explicit grouped variants and never exposes an import/post command', async () => {
  await mount()
  choose()
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByRole('table')
  expect(screen.getAllByText('Sample shoe')).toHaveLength(2)
  fireEvent.click(screen.getAllByText('Details')[0]!)
  expect(screen.getAllByText('Details')[0]!.closest('details')?.open).toBe(true)
  expect(screen.getAllByText('Uncategorized')).toHaveLength(2)
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
