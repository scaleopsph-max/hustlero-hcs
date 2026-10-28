import { z } from 'zod'
const id = z.uuid(),
  name = z.string().trim().min(1).max(80),
  revision = z.number().int().min(1).max(2147483647)
const value = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fixed'), amountMinor: z.number().int().min(1).max(99_999_999_999) }),
  z.strictObject({ kind: z.literal('percent'), rateBps: z.number().int().min(1).max(9999) }),
])
export const retailDiscountValueSchema = value
const fields = { name, value, status: z.enum(['active', 'inactive']) }
export const retailDiscountCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('create'), ...fields }),
  z.strictObject({ action: z.literal('update'), discountId: id, expectedRevision: revision, ...fields }),
  z.strictObject({ action: z.literal('archive'), discountId: id, expectedRevision: revision }),
])
export const retailDiscountSchema = z.object({
  id,
  name,
  value,
  status: z.enum(['active', 'inactive', 'archived']),
  revision,
  scope: z.literal('retail_ticket'),
  updatedAt: z.iso.datetime({ offset: true }),
})
export const retailDiscountContextSchema = z.object({ discounts: z.array(retailDiscountSchema) })
export const retailDiscountVersionsSchema = z
  .object({
    discountId: id,
    versions: z.array(retailDiscountSchema).min(1).max(100),
  })
  .refine(
    ({ discountId, versions }) =>
      versions.every((version) => version.id === discountId) &&
      new Set(versions.map((version) => version.revision)).size === versions.length,
    { message: 'Versions must belong to one discount with distinct revisions.' },
  )
export type RetailDiscount = z.infer<typeof retailDiscountSchema>
export type RetailDiscountCommand = z.infer<typeof retailDiscountCommandSchema>
export type RetailDiscountContext = z.infer<typeof retailDiscountContextSchema>
export type RetailDiscountVersions = z.infer<typeof retailDiscountVersionsSchema>
