import { z } from 'zod'

const id = z.uuid()
export const workforceContextSchema = z.object({
  locations: z.array(
    z.object({
      id,
      code: z.string(),
      name: z.string(),
      kind: z.enum(['store', 'warehouse', 'office', 'virtual']),
      timezone: z.string().nullable(),
      isActive: z.boolean(),
    }),
  ),
  roles: z.array(
    z.object({
      id,
      code: z.string(),
      name: z.string(),
      isSystemTemplate: z.boolean(),
      permissions: z.array(z.string()),
    }),
  ),
  employees: z.array(
    z.object({
      id,
      employeeCode: z.string(),
      displayName: z.string(),
      status: z.enum(['active', 'suspended', 'deactivated']),
      hasPosPin: z.boolean(),
      roleIds: z.array(id),
      locationIds: z.array(id),
    }),
  ),
  registers: z.array(
    z.object({
      id,
      locationId: id,
      locationName: z.string(),
      code: z.string(),
      name: z.string(),
      status: z.enum(['active', 'inactive']),
    }),
  ),
})
export const locationCreateRequestSchema = z.strictObject({
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(2).max(160),
  kind: z.enum(['store', 'warehouse', 'office', 'virtual']),
  timezone: z.string().trim().min(1).max(80).default('Asia/Manila'),
})
export const locationCreateResponseSchema = z.object({ locationId: id, status: z.literal('created') })
export const employeeCreateRequestSchema = z.strictObject({
  employeeCode: z.string().trim().min(2).max(32),
  displayName: z.string().trim().min(2).max(160),
  roleId: id,
  locationIds: z.array(id).min(1).max(100),
  pin: z.string().regex(/^\d{4,6}$/),
})
export const employeeCreateResponseSchema = z.object({ employeeId: id, status: z.literal('created') })
export const registerCreateRequestSchema = z.strictObject({
  locationId: id,
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(2).max(160),
})
export const registerCreateResponseSchema = z.object({ registerId: id, status: z.literal('created') })
export type WorkforceContext = z.infer<typeof workforceContextSchema>
export type LocationCreateRequest = z.infer<typeof locationCreateRequestSchema>
export type EmployeeCreateRequest = z.infer<typeof employeeCreateRequestSchema>
export type RegisterCreateRequest = z.infer<typeof registerCreateRequestSchema>
