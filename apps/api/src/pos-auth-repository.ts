import {
  posDeviceContextSchema,
  type PosDeviceActivationCreateRequest,
  type PosDeviceContext,
  type PosPinLoginRequest,
} from '@hcs/contracts'
import { Client } from 'pg'
import { z } from 'zod'
import type { Bindings } from './env'

const id = z.uuid()
const timestamp = z.iso.datetime({ offset: true })

const deviceActivationRecordSchema = z.object({
  deviceId: id,
  activationExpiresAt: timestamp,
  status: z.literal('pending'),
})

const activatedDeviceRecordSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('invalid') }),
  z.object({
    status: z.literal('active'),
    device: z.object({
      id,
      name: z.string(),
      tenantName: z.string(),
      locationId: id,
      locationName: z.string(),
      registerId: id,
      registerName: z.string(),
    }),
  }),
])

const pinLoginRecordSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('invalid') }),
  z.object({ status: z.literal('locked'), lockedUntil: timestamp }),
  z.object({
    status: z.literal('authenticated'),
    expiresAt: timestamp,
    employee: z.object({ id, employeeCode: z.string(), displayName: z.string() }),
    device: z.object({
      id,
      name: z.string(),
      tenantId: id,
      tenantName: z.string(),
      locationId: id,
      locationName: z.string(),
      registerId: id,
      registerName: z.string(),
    }),
  }),
])

export type DeviceActivationRecord = z.infer<typeof deviceActivationRecordSchema>
export type ActivatedDeviceRecord = z.infer<typeof activatedDeviceRecordSchema>
export type PinLoginRecord = z.infer<typeof pinLoginRecordSchema>

export type PosDeviceLoader = (userId: string, tenantId: string, bindings: Bindings) => Promise<PosDeviceContext>
export type PosDeviceActivationCreator = (
  userId: string,
  tenantId: string,
  request: PosDeviceActivationCreateRequest,
  activationHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<DeviceActivationRecord>
export type PosDeviceActivator = (
  activationHash: string,
  deviceTokenHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<ActivatedDeviceRecord>
export type PosEmployeePinAuthenticator = (
  deviceTokenHash: string,
  request: PosPinLoginRequest,
  sessionTokenHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<PinLoginRecord>

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

export const loadPosDevicesFromPostgres: PosDeviceLoader = async (userId, tenantId, bindings) =>
  posDeviceContextSchema.parse(
    (await query(bindings, 'select app.list_pos_devices($1::uuid,$2::uuid) context', [userId, tenantId])).rows[0]
      ?.context,
  )

export const createPosDeviceActivationInPostgres: PosDeviceActivationCreator = async (
  userId,
  tenantId,
  request,
  activationHash,
  requestId,
  bindings,
) =>
  deviceActivationRecordSchema.parse(
    (
      await query(
        bindings,
        'select app.create_pos_device_activation($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text) response',
        [userId, tenantId, request.registerId, request.name, activationHash, requestId],
      )
    ).rows[0]?.response,
  )

export const activatePosDeviceInPostgres: PosDeviceActivator = async (
  activationHash,
  deviceTokenHash,
  requestId,
  bindings,
) =>
  activatedDeviceRecordSchema.parse(
    (
      await query(bindings, 'select app.activate_pos_device($1::text,$2::text,$3::text) response', [
        activationHash,
        deviceTokenHash,
        requestId,
      ])
    ).rows[0]?.response,
  )

export const authenticatePosEmployeeInPostgres: PosEmployeePinAuthenticator = async (
  deviceTokenHash,
  request,
  sessionTokenHash,
  requestId,
  bindings,
) =>
  pinLoginRecordSchema.parse(
    (
      await query(
        bindings,
        'select app.authenticate_pos_employee($1::text,$2::text,$3::text,$4::text,$5::text) response',
        [deviceTokenHash, request.employeeCode, request.pin, sessionTokenHash, requestId],
      )
    ).rows[0]?.response,
  )
