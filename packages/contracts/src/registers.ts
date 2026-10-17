import { z } from 'zod'

const id = z.uuid()
const centavos = z.number().int().min(0).max(900_000_000_000)

export const paymentMethodTypeSchema = z.enum(['cash', 'e_wallet', 'bank_transfer', 'card_terminal', 'other'])
export const registerOperationsContextSchema = z.object({
  paymentMethods: z.array(
    z.object({
      id,
      code: z.string(),
      name: z.string(),
      methodType: paymentMethodTypeSchema,
      isActive: z.boolean(),
      isSystemDefault: z.boolean(),
    }),
  ),
  employees: z.array(z.object({ id, employeeCode: z.string(), displayName: z.string(), locationIds: z.array(id) })),
  registers: z.array(
    z.object({
      id,
      code: z.string(),
      name: z.string(),
      locationId: id,
      locationName: z.string(),
      status: z.enum(['active', 'inactive']),
      currentSession: z
        .object({
          id,
          employeeId: id,
          employeeName: z.string(),
          openingCashCentavos: centavos,
          openedAt: z.iso.datetime({ offset: true }),
        })
        .nullable(),
    }),
  ),
  recentSessions: z.array(
    z.object({
      id,
      registerId: id,
      registerName: z.string(),
      locationName: z.string(),
      employeeName: z.string(),
      status: z.enum(['open', 'closed', 'exception']),
      openingCashCentavos: centavos,
      expectedCashCentavos: centavos.nullable(),
      countedCashCentavos: centavos.nullable(),
      varianceCentavos: z.number().int().nullable(),
      openedAt: z.iso.datetime({ offset: true }),
      closedAt: z.iso.datetime({ offset: true }).nullable(),
    }),
  ),
})

export const paymentMethodCreateRequestSchema = z.strictObject({
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(2).max(80),
  methodType: paymentMethodTypeSchema,
})
export const paymentMethodCreateResponseSchema = z.object({ paymentMethodId: id, status: z.literal('created') })

export const registerSessionOpenRequestSchema = z.strictObject({
  registerId: id,
  employeeId: id,
  openingCashCentavos: centavos,
})
export const registerSessionOpenResponseSchema = z.object({ registerSessionId: id, status: z.literal('open') })

export const registerSessionCloseRequestSchema = z.strictObject({ countedCashCentavos: centavos })
export const registerSessionCloseResponseSchema = z.object({
  registerSessionId: id,
  status: z.enum(['closed', 'exception']),
  expectedCashCentavos: centavos,
  countedCashCentavos: centavos,
  varianceCentavos: z.number().int(),
})

export type RegisterOperationsContext = z.infer<typeof registerOperationsContextSchema>
export type PaymentMethodCreateRequest = z.infer<typeof paymentMethodCreateRequestSchema>
export type RegisterSessionOpenRequest = z.infer<typeof registerSessionOpenRequestSchema>
export type RegisterSessionCloseRequest = z.infer<typeof registerSessionCloseRequestSchema>
