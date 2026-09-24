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

export const businessTypeSchema = z.enum(['retail', 'food_and_beverage', 'services', 'mixed'])
export const salesChannelSchema = z.enum(['in_store', 'online', 'wholesale'])
export const productSetupMethodSchema = z.enum(['manual', 'csv', 'later'])
export const selectableFeatureCodeSchema = z.enum(['inventory', 'purchasing', 'customers', 'employees', 'finance'])

export const businessSetupQuestionsSchema = z.strictObject({
  step: z.literal('business_questions'),
  businessType: businessTypeSchema,
  salesChannels: z.array(salesChannelSchema).min(1).max(3),
  tracksInventory: z.boolean(),
  productSetupMethod: productSetupMethodSchema,
})

export const featureSelectionSchema = z.strictObject({
  step: z.literal('feature_selection'),
  enabledFeatures: z.array(selectableFeatureCodeSchema).max(5),
})

export const onboardingUpdateRequestSchema = z.discriminatedUnion('step', [
  businessSetupQuestionsSchema,
  featureSelectionSchema,
])

export const onboardingUpdateResponseSchema = z.object({
  step: z.enum(['business_questions', 'feature_selection']),
  status: z.literal('complete'),
  enabledFeatures: z.array(selectableFeatureCodeSchema).optional(),
})

const businessProfileSchema = z.object({
  businessType: businessTypeSchema,
  salesChannels: z.array(salesChannelSchema),
  tracksInventory: z.boolean(),
  productSetupMethod: productSetupMethodSchema,
})

const featureOptionSchema = z.object({
  code: z.enum(['catalog', 'sales', 'reports', 'inventory', 'purchasing', 'customers', 'employees', 'finance']),
  name: z.string(),
  enabled: z.boolean(),
  required: z.boolean(),
})

export const onboardingResponseSchema = z.object({
  tenantId: z.uuid(),
  readyToSell: z.boolean(),
  businessProfile: businessProfileSchema.nullable(),
  featureOptions: z.array(featureOptionSchema),
  steps: z.array(
    z.object({
      code: onboardingStepCodeSchema,
      status: z.enum(['complete', 'pending']),
    }),
  ),
})

export type TenantBootstrapRequest = z.infer<typeof tenantBootstrapRequestSchema>
export type TenantBootstrapResponse = z.infer<typeof tenantBootstrapResponseSchema>
export type BusinessSetupQuestions = z.infer<typeof businessSetupQuestionsSchema>
export type FeatureSelection = z.infer<typeof featureSelectionSchema>
export type OnboardingUpdateRequest = z.infer<typeof onboardingUpdateRequestSchema>
export type OnboardingUpdateResponse = z.infer<typeof onboardingUpdateResponseSchema>
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>
