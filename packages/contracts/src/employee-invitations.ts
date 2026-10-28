import { z } from 'zod'
const id = z.uuid()
export const employeeInvitationCreateSchema = z.strictObject({
  employeeId: id,
  email: z
    .email()
    .max(254)
    .transform((value) => value.trim().toLowerCase()),
})
export const employeeInvitationIssuedSchema = z.object({
  invitationId: id,
  employeeId: id,
  email: z.email(),
  expiresAt: z.iso.datetime({ offset: true }),
})
export const employeeInvitationListSchema = z.array(
  z.object({
    invitationId: id,
    businessName: z.string().min(1),
    employeeName: z.string().min(1),
    expiresAt: z.iso.datetime({ offset: true }),
  }),
)
export const employeeInvitationAcceptedSchema = z.object({ invitationId: id, tenantId: id, employeeId: id })
export const employeeInvitationRevokedSchema = z.object({ invitationId: id, status: z.literal('revoked') })
export type EmployeeInvitationCreate = z.infer<typeof employeeInvitationCreateSchema>
