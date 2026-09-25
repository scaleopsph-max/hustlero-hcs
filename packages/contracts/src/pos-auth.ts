import { z } from 'zod'

const id = z.uuid()
const timestamp = z.iso.datetime({ offset: true })

export const posDeviceStatusSchema = z.enum(['pending', 'active', 'revoked'])

export const posDeviceContextSchema = z.object({
  registers: z.array(
    z.object({
      id,
      code: z.string(),
      name: z.string(),
      locationId: id,
      locationName: z.string(),
      status: z.enum(['active', 'inactive']),
    }),
  ),
  devices: z.array(
    z.object({
      id,
      name: z.string(),
      registerId: id,
      registerName: z.string(),
      locationId: id,
      locationName: z.string(),
      status: posDeviceStatusSchema,
      activationExpiresAt: timestamp.nullable(),
      activatedAt: timestamp.nullable(),
      lastSeenAt: timestamp.nullable(),
      createdAt: timestamp,
    }),
  ),
})

export const posDeviceActivationCreateRequestSchema = z.strictObject({
  registerId: id,
  name: z.string().trim().min(2).max(80),
})

export const posDeviceActivationCreateResponseSchema = z.object({
  deviceId: id,
  activationCode: z.string().regex(/^[A-F0-9]{12}$/),
  activationExpiresAt: timestamp,
  status: z.literal('pending'),
})

export const posDeviceActivateRequestSchema = z.strictObject({
  activationCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-F0-9]{12}$/),
})

export const posDeviceActivateResponseSchema = z.object({
  deviceToken: z.string().regex(/^[a-f0-9]{64}$/),
  device: z.object({
    id,
    name: z.string(),
    tenantName: z.string(),
    locationId: id,
    locationName: z.string(),
    registerId: id,
    registerName: z.string(),
  }),
})

export const posPinLoginRequestSchema = z.strictObject({
  employeeCode: z.string().trim().min(1).max(40),
  pin: z.string().regex(/^[0-9]{4,6}$/),
})

export const posPinLoginResponseSchema = z.object({
  sessionToken: z.string().regex(/^[a-f0-9]{64}$/),
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
})

export type PosDeviceContext = z.infer<typeof posDeviceContextSchema>
export type PosDeviceActivationCreateRequest = z.infer<typeof posDeviceActivationCreateRequestSchema>
export type PosDeviceActivateRequest = z.infer<typeof posDeviceActivateRequestSchema>
export type PosPinLoginRequest = z.infer<typeof posPinLoginRequestSchema>
