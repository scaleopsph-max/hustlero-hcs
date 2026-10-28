import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { PurchasingContext } from '@hcs/contracts'
const actor = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001',
  supplier = '30000000-0000-4000-8000-000000000001'
let Component: typeof import('./SupplierManagement').SupplierManagement
const data: PurchasingContext = {
  locations: [],
  variants: [],
  orders: [],
  suppliers: [
    {
      id: supplier,
      name: 'Supplier',
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      status: 'active',
      revision: 1,
    },
  ],
}
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://supplier-api.example.invalid')
  Component = (await import('./SupplierManagement')).SupplierManagement
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})
it('retries an uncertain update with the original request and verifies supplier state', async () => {
  let lost = true
  const calls: { key: string; body: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === '/v1/purchasing')
        return Response.json({ ...data, suppliers: [{ ...data.suppliers[0], name: 'New supplier', revision: 2 }] })
      calls.push({ key: (init?.headers as Record<string, string>)['Idempotency-Key']!, body: String(init?.body) })
      if (lost) {
        lost = false
        throw new TypeError('lost response')
      }
      return Response.json({
        supplierId: supplier,
        revision: 2,
        name: 'New supplier',
        contactName: null,
        contactPhone: null,
        contactEmail: null,
        status: 'active',
      })
    }),
  )
  const refresh = vi.fn(async () => {})
  render(createElement(Component, { actor, tenant, token: 'synthetic', data, refresh }))
  fireEvent.click(screen.getByRole('button', { name: 'Supplier · active' }))
  fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'New supplier' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save supplier' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry supplier request' }))
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual(calls[0])
  expect(sessionStorage.length).toBe(0)
})
it('archives the saved supplier without applying unsaved field edits', async () => {
  let sent: unknown
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === '/v1/purchasing')
        return Response.json({ ...data, suppliers: [{ ...data.suppliers[0], status: 'archived', revision: 2 }] })
      sent = JSON.parse(String(init?.body))
      return Response.json({
        supplierId: supplier,
        revision: 2,
        name: 'Supplier',
        contactName: null,
        contactPhone: null,
        contactEmail: null,
        status: 'archived',
      })
    }),
  )
  const refresh = vi.fn(async () => {})
  render(createElement(Component, { actor, tenant, token: 'synthetic', data, refresh }))
  fireEvent.click(screen.getByRole('button', { name: 'Supplier · active' }))
  fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'Unsaved name' } })
  fireEvent.click(screen.getByRole('button', { name: 'Archive supplier' }))
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(sent).toMatchObject({ name: 'Supplier', archive: true })
})
