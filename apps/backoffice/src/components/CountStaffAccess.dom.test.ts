import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { WorkforceContext } from '@hcs/contracts'
const actor = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001',
  employee = '30000000-0000-4000-8000-000000000001',
  branch = '40000000-0000-4000-8000-000000000001'
let Component: typeof import('./CountStaffAccess').CountStaffAccess
const data: WorkforceContext = {
  canManageCountAccess: true,
  roles: [],
  registers: [],
  locations: [{ id: branch, code: 'MAIN', name: 'Main', kind: 'store', timezone: 'Asia/Manila', isActive: true }],
  employees: [
    {
      id: employee,
      employeeCode: 'EMP',
      displayName: 'Staff',
      status: 'active',
      hasPosPin: true,
      roleIds: [],
      locationIds: [branch],
      hasBackOfficeAccount: true,
      countAccessLocationIds: [],
    },
  ],
}
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://count-api.example.invalid')
  Component = (await import('./CountStaffAccess')).CountStaffAccess
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})
it('recovers a lost response using the exact original command and key', async () => {
  const calls: { key: string; body: string }[] = []
  let first = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ key: (init?.headers as Record<string, string>)['Idempotency-Key']!, body: String(init?.body) })
      if (first) {
        first = false
        throw new TypeError('lost response')
      }
      return Response.json(JSON.parse(String(init?.body)))
    }),
  )
  const refresh = vi.fn(async () => {})
  render(createElement(Component, { actor, tenant, token: 'synthetic', data, refresh }))
  fireEvent.click(screen.getByRole('button', { name: 'Grant count access' }))
  const retry = await screen.findByRole('button', { name: 'Retry access request' })
  expect((screen.getByRole('button', { name: 'Grant count access' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(retry)
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual(calls[0])
  await waitFor(() => expect(sessionStorage.length).toBe(0))
})
it('does not offer a grant without a linked Back Office account', () => {
  const unlinked = { ...data, employees: [{ ...data.employees[0]!, hasBackOfficeAccount: false }] }
  render(createElement(Component, { actor, tenant, token: 'synthetic', data: unlinked, refresh: async () => {} }))
  expect((screen.getByRole('button', { name: 'Grant count access' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(/active linked Back Office account/)).toBeTruthy()
})
