import { z } from 'zod'

const identifierSchema = z.uuid()

export const tenantAccessSchema = z.object({
  tenantId: identifierSchema,
  tenantSlug: z.string().min(1),
  tenantName: z.string().min(1),
  isOwner: z.boolean(),
  employeeId: identifierSchema.nullable(),
  locationIds: z.array(identifierSchema),
  permissions: z.array(z.string().min(1)),
  entitlements: z.array(z.string().min(1)),
})

export const sessionContextResponseSchema = z.object({
  userId: identifierSchema,
  tenants: z.array(tenantAccessSchema),
})

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
})

export type TenantAccess = z.infer<typeof tenantAccessSchema>
export type SessionContextResponse = z.infer<typeof sessionContextResponseSchema>
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>
