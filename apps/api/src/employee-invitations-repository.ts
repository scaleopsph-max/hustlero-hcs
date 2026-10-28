import { Client } from 'pg'
import {
  employeeInvitationIssuedSchema,
  employeeInvitationListSchema,
  employeeInvitationAcceptedSchema,
  employeeInvitationRevokedSchema,
  type EmployeeInvitationCreate,
} from '@hcs/contracts'
import type { Bindings } from './env'

export type EmployeeInvitationRepository = {
  create: (
    actor: string,
    tenant: string,
    command: EmployeeInvitationCreate,
    key: string,
    requestId: string,
    bindings: Bindings,
  ) => Promise<unknown>
  list: (actor: string, bindings: Bindings) => Promise<unknown>
  accept: (actor: string, id: string, key: string, requestId: string, bindings: Bindings) => Promise<unknown>
  revoke: (
    actor: string,
    tenant: string,
    id: string,
    key: string,
    requestId: string,
    bindings: Bindings,
  ) => Promise<unknown>
}
async function query(bindings: Bindings, sql: string, values: unknown[]) {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('Database connection is unavailable.')
  const client = new Client({ connectionString: bindings.HYPERDRIVE.connectionString })
  try {
    await client.connect()
    return (await client.query(sql, values)).rows[0]?.response
  } finally {
    await client.end()
  }
}
export const employeeInvitationsInPostgres: EmployeeInvitationRepository = {
  create: async (actor, tenant, command, key, requestId, bindings) =>
    employeeInvitationIssuedSchema.parse(
      await query(
        bindings,
        'select app.create_employee_membership_invitation($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text) response',
        [actor, tenant, command.employeeId, command.email, key, requestId],
      ),
    ),
  list: async (actor, bindings) =>
    employeeInvitationListSchema.parse(
      await query(bindings, 'select app.list_employee_membership_invitations($1::uuid) response', [actor]),
    ),
  accept: async (actor, id, key, requestId, bindings) =>
    employeeInvitationAcceptedSchema.parse(
      await query(
        bindings,
        'select app.accept_employee_membership_invitation($1::uuid,$2::uuid,$3::text,$4::text) response',
        [actor, id, key, requestId],
      ),
    ),
  revoke: async (actor, tenant, id, key, requestId, bindings) =>
    employeeInvitationRevokedSchema.parse(
      await query(
        bindings,
        'select app.revoke_employee_membership_invitation($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text) response',
        [actor, tenant, id, key, requestId],
      ),
    ),
}
