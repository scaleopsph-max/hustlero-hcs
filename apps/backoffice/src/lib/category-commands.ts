import { z } from 'zod'
import {
  catalogCategoryCommandSchema,
  catalogCategoryCommandResponseSchema,
  type CatalogCategoriesContext,
} from '@hcs/contracts'

export const pendingCategorySchema = z.strictObject({ key: z.uuid(), payload: catalogCategoryCommandSchema })
export type PendingCategory = z.infer<typeof pendingCategorySchema>
export function restoreCategoryCommand(value: string | null): PendingCategory | null {
  return value === null ? null : pendingCategorySchema.parse(JSON.parse(value))
}
export function categoryCommandMatches(a: PendingCategory, b: PendingCategory | null) {
  return b !== null && a.key === b.key && JSON.stringify(a.payload) === JSON.stringify(b.payload)
}
export function reconcileCategory(command: PendingCategory, value: unknown, history: CatalogCategoriesContext) {
  const result = catalogCategoryCommandResponseSchema.parse(value)
  const payload = command.payload
  if (
    (payload.action !== 'create' && result.categoryId !== payload.categoryId) ||
    (payload.action !== 'archive' && result.name !== payload.name) ||
    result.status !== (payload.action === 'archive' ? 'archived' : 'active') ||
    !history.categories.some(
      (row) => row.id === result.categoryId && row.name === result.name && row.status === result.status,
    )
  )
    throw new Error('Category result could not be reconciled. Retry the original command.')
  return result
}
export function categoryDefinitivelyRejected(code: string | undefined) {
  return code === 'CATEGORY_DUPLICATE' || code === 'CATEGORY_ARCHIVED' || code === 'CATEGORY_IN_USE'
}
