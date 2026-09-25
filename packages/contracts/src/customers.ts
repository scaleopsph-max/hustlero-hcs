import { z } from 'zod'

const id = z.uuid()
const timestamp = z.iso.datetime({ offset: true })
const optionalContact = z.string().trim().max(160).nullable()

export const customerGroupSchema = z.object({
  id,
  code: z.string(),
  name: z.string(),
  kind: z.enum(['standard', 'vip', 'reseller', 'wholesale']),
  isActive: z.boolean(),
})

export const customerSummarySchema = z.object({
  id,
  customerNumber: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  customerType: z.enum(['standard', 'reseller']),
  groupName: z.string().nullable(),
  status: z.enum(['active', 'inactive']),
  origin: z.enum(['backoffice', 'pos']),
  totalSpendCentavos: z.number().int().nonnegative(),
  visitCount: z.number().int().nonnegative(),
  lastVisitAt: timestamp.nullable(),
  createdAt: timestamp,
})

export const customersContextSchema = z.object({
  canManage: z.boolean(),
  groups: z.array(customerGroupSchema),
  customers: z.array(customerSummarySchema),
})

export const customerDetailSchema = z.object({
  id,
  customerNumber: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  customerGroupId: id,
  customerType: z.enum(['standard', 'reseller']),
  emailMarketingConsent: z.boolean(),
  smsMarketingConsent: z.boolean(),
  consentUpdatedAt: timestamp.nullable(),
  status: z.enum(['active', 'inactive']),
  origin: z.enum(['backoffice', 'pos']),
  createdAt: timestamp,
  updatedAt: timestamp,
  canManage: z.boolean(),
  totalSpendCentavos: z.number().int().nonnegative(),
  visitCount: z.number().int().nonnegative(),
  purchases: z.array(
    z.object({
      saleId: id,
      receiptNumber: z.string(),
      status: z.enum(['completed', 'voided', 'partially_refunded', 'refunded']),
      locationName: z.string(),
      totalCentavos: z.number().int().nonnegative(),
      refundedCentavos: z.number().int().nonnegative(),
      completedAt: timestamp,
    }),
  ),
  notes: z.array(z.object({ id, note: z.string(), actorName: z.string(), createdAt: timestamp })),
})

const customerFields = {
  fullName: z.string().trim().min(2).max(160),
  email: optionalContact,
  phone: z.string().trim().max(40).nullable(),
  customerGroupId: id.nullable(),
  customerType: z.enum(['standard', 'reseller']),
  emailMarketingConsent: z.boolean(),
  smsMarketingConsent: z.boolean(),
}

export const customerCreateRequestSchema = z
  .strictObject(customerFields)
  .refine((value) => Boolean(value.email || value.phone), 'Email or phone is required')
export const customerUpdateRequestSchema = z
  .strictObject({ ...customerFields, customerGroupId: id, status: z.enum(['active', 'inactive']) })
  .refine((value) => Boolean(value.email || value.phone), 'Email or phone is required')
export const customerCreateResponseSchema = z.object({
  customerId: id,
  customerNumber: z.string(),
  status: z.literal('created'),
})
export const customerUpdateResponseSchema = z.object({ customerId: id, status: z.literal('updated') })
export const customerNoteRequestSchema = z.strictObject({ note: z.string().trim().min(2).max(1000) })
export const customerNoteResponseSchema = z.object({ noteId: id, customerId: id, status: z.literal('created') })

export const posCustomerSchema = z.object({
  id,
  customerNumber: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  customerType: z.enum(['standard', 'reseller']),
})
export const posCustomerSearchResponseSchema = z.object({ customers: z.array(posCustomerSchema) })
export const posCustomerCreateRequestSchema = z
  .strictObject({
    fullName: z.string().trim().min(2).max(160),
    email: optionalContact,
    phone: z.string().trim().max(40).nullable(),
    emailMarketingConsent: z.boolean(),
    smsMarketingConsent: z.boolean(),
  })
  .refine((value) => Boolean(value.email || value.phone), 'Email or phone is required')
export const posCustomerCreateResponseSchema = z.object({
  customerId: id,
  customerNumber: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  customerType: z.enum(['standard', 'reseller']),
  status: z.literal('created'),
})

export type CustomersContext = z.infer<typeof customersContextSchema>
export type CustomerDetail = z.infer<typeof customerDetailSchema>
export type CustomerCreateRequest = z.infer<typeof customerCreateRequestSchema>
export type CustomerUpdateRequest = z.infer<typeof customerUpdateRequestSchema>
export type CustomerNoteRequest = z.infer<typeof customerNoteRequestSchema>
export type PosCustomer = z.infer<typeof posCustomerSchema>
export type PosCustomerCreateRequest = z.infer<typeof posCustomerCreateRequestSchema>
