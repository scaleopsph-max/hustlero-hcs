import { z } from 'zod'

const identifierSchema = z.uuid()

export const tenantAccessSchema = z.object({
  tenantId: identifierSchema,
  tenantSlug: z.string().min(1),
  tenantName: z.string().min(1),
  isOwner: z.boolean(),
  employeeId: identifierSchema.nullable(),
  locationIds: z.array(identifierSchema),
  locationCount: z.number().int().nonnegative(),
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
    /** Extra machine-readable context for some errors, such as which cart items are short of stock. */
    details: z.record(z.string(), z.unknown()).optional(),
  }),
})

export type TenantAccess = z.infer<typeof tenantAccessSchema>
export type SessionContextResponse = z.infer<typeof sessionContextResponseSchema>
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>
