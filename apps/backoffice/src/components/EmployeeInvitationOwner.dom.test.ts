import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { WorkforceContext } from '@hcs/contracts'
const actor = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001',
  employee = '30000000-0000-4000-8000-000000000001',
  invitation = '40000000-0000-4000-8000-000000000001'
let Component: typeof import('./EmployeeInvitationOwner').EmployeeInvitationOwner
const data: WorkforceContext = {
  canManageCountAccess: true,
  roles: [],
  registers: [],
  locations: [],
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
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://invite-api.example.invalid')
  Component = (await import('./EmployeeInvitationOwner')).EmployeeInvitationOwner
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})
it('recovers an interrupted invitation with the original key and clearly states that no email is sent', async () => {
  const calls: { key: string; body: string }[] = []
  let first = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === '/v1/workforce')
        return Response.json({
          ...data,
          pendingEmployeeInvitations: [
            {
              invitationId: invitation,
              employeeId: employee,
              email: 'staff@example.invalid',
              expiresAt: '2026-11-01T00:00:00Z',
            },
          ],
        })
      calls.push({ key: (init?.headers as Record<string, string>)['Idempotency-Key']!, body: String(init?.body) })
      if (first) {
        first = false
        throw new TypeError('lost response')
      }
      return Response.json({
        ...JSON.parse(String(init?.body)),
        invitationId: invitation,
        expiresAt: '2026-11-01T00:00:00Z',
      })
    }),
  )
  const refresh = vi.fn(async () => {})
  render(createElement(Component, { actor, tenant, token: 'synthetic', data, refresh }))
  fireEvent.change(screen.getByLabelText('Employee'), { target: { value: employee } })
  fireEvent.change(screen.getByLabelText('Employee email'), { target: { value: 'staff@example.invalid' } })
  fireEvent.click(screen.getByRole('button', { name: 'Record invitation' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry invitation request' }))
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual(calls[0])
  expect(await screen.findByText(/No email was sent/)).toBeTruthy()
})
it('does not report success when the invitation is no longer pending during reconciliation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === '/v1/workforce')
        return Response.json({ ...data, pendingEmployeeInvitations: [] })
      return Response.json({
        ...JSON.parse(String(init?.body)),
        invitationId: invitation,
        expiresAt: '2026-11-01T00:00:00Z',
      })
    }),
  )
  const refresh = vi.fn(async () => {})
  render(createElement(Component, { actor, tenant, token: 'synthetic', data, refresh }))
  fireEvent.change(screen.getByLabelText('Employee'), { target: { value: employee } })
  fireEvent.change(screen.getByLabelText('Employee email'), { target: { value: 'staff@example.invalid' } })
  fireEvent.click(screen.getByRole('button', { name: 'Record invitation' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Invitation status changed')
  expect(screen.getByRole('button', { name: 'Retry invitation request' })).toBeTruthy()
  expect(refresh).not.toHaveBeenCalled()
  expect(sessionStorage.length).toBe(1)
})
