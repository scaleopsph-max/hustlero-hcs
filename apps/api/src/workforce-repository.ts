import {
  employeeCreateResponseSchema,
  locationCreateResponseSchema,
  registerCreateResponseSchema,
  workforceContextSchema,
  type EmployeeCreateRequest,
  type LocationCreateRequest,
  type RegisterCreateRequest,
  type WorkforceContext,
} from '@hcs/contracts'
import { Client } from 'pg'
import type { Bindings } from './env'

export type WorkforceLoader = (userId: string, tenantId: string, bindings: Bindings) => Promise<WorkforceContext>
export type LocationCreator = (
  userId: string,
  tenantId: string,
  request: LocationCreateRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<unknown>
export type EmployeeCreator = (
  userId: string,
  tenantId: string,
  request: EmployeeCreateRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<unknown>
export type RegisterCreator = (
  userId: string,
  tenantId: string,
  request: RegisterCreateRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<unknown>
async function query(bindings: Bindings, text: string, values: unknown[]) {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  const client = new Client({ connectionString: bindings.HYPERDRIVE.connectionString })
  try {
    await client.connect()
    return await client.query(text, values)
  } finally {
    await client.end()
  }
}
export const loadWorkforceFromPostgres: WorkforceLoader = async (userId, tenantId, bindings) =>
  workforceContextSchema.parse(
    (await query(bindings, 'select app.list_workforce_context($1::uuid,$2::uuid) context', [userId, tenantId])).rows[0]
      ?.context,
  )
export const createLocationInPostgres: LocationCreator = async (
  userId,
  tenantId,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  locationCreateResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.create_location($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text) response',
        [userId, tenantId, request.code, request.name, request.kind, request.timezone, key, hash, requestId],
      )
    ).rows[0]?.response,
  )
export const createEmployeeInPostgres: EmployeeCreator = async (
  userId,
  tenantId,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  employeeCreateResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.create_employee($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::jsonb,$7::text,$8::text,$9::text,$10::text) response',
        [
          userId,
          tenantId,
          request.employeeCode,
          request.displayName,
          request.roleId,
          JSON.stringify(request.locationIds),
          request.pin,
          key,
          hash,
          requestId,
        ],
      )
    ).rows[0]?.response,
  )
export const createRegisterInPostgres: RegisterCreator = async (
  userId,
  tenantId,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  registerCreateResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.create_register($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text) response',
        [userId, tenantId, request.locationId, request.code, request.name, key, hash, requestId],
      )
    ).rows[0]?.response,
  )
