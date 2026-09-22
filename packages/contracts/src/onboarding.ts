import { z } from 'zod'

const nameSchema = z.string().trim().min(2).max(120)

export const tenantBootstrapRequestSchema = z.strictObject({
  name: nameSchema,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60),
  baseCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('PHP'),
  timezone: z
    .string()
    .min(1)
    .max(80)
    .default('Asia/Manila')
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value })
        return true
      } catch {
        return false
      }
    }),
  mainLocation: z.strictObject({
    code: z.string().trim().min(1).max(24),
    name: nameSchema,
  }),
})

export const tenantBootstrapResponseSchema = z.object({
  tenantId: z.uuid(),
  mainLocationId: z.uuid(),
  status: z.literal('setup'),
})

export const onboardingStepCodeSchema = z.enum([
  'business',
  'main_location',
  'business_questions',
  'feature_selection',
  'products',
  'opening_inventory',
  'payment_methods',
  'basic_fund_setup',
  'employees',
  'register',
  'pos_activation',
  'test_sale',
])

export const onboardingResponseSchema = z.object({
  tenantId: z.uuid(),
  readyToSell: z.boolean(),
  steps: z.array(
    z.object({
      code: onboardingStepCodeSchema,
      status: z.enum(['complete', 'pending']),
    }),
  ),
})

export type TenantBootstrapRequest = z.infer<typeof tenantBootstrapRequestSchema>
export type TenantBootstrapResponse = z.infer<typeof tenantBootstrapResponseSchema>
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>
