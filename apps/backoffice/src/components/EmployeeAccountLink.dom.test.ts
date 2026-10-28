import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { WorkforceContext } from '@hcs/contracts'
const actor = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001',
  employee = '30000000-0000-4000-8000-000000000001',
  member = '40000000-0000-4000-8000-000000000001'
let Component: typeof import('./EmployeeAccountLink').EmployeeAccountLink
const data: WorkforceContext = {
  canManageCountAccess: true,
  roles: [],
  registers: [],
  locations: [],
  unlinkedAccounts: [{ userId: member, email: 'staff@example.invalid' }],
  employees: [
    {
      id: employee,
      employeeCode: 'EMP',
      displayName: 'Staff',
      status: 'active',
      hasPosPin: true,
      roleIds: [],
      locationIds: [],
      hasBackOfficeAccount: false,
      accountLinked: false,
    },
  ],
}
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://link-api.example.invalid')
  Component = (await import('./EmployeeAccountLink')).EmployeeAccountLink
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})
it('retries an uncertain account link with the original key and payload', async () => {
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
  fireEvent.change(screen.getByLabelText('Employee'), { target: { value: employee } })
  fireEvent.change(screen.getByLabelText('Existing business account'), { target: { value: member } })
  fireEvent.click(screen.getByRole('button', { name: 'Link account to employee' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry account link' }))
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual(calls[0])
  await waitFor(() => expect(sessionStorage.length).toBe(0))
})
