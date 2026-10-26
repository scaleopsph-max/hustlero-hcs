import { expect, it } from 'vitest'
import { catalogCategoryCommandSchema } from '@hcs/contracts'
import {
  categoryCommandMatches,
  categoryDefinitivelyRejected,
  reconcileCategory,
  restoreCategoryCommand,
} from './category-commands'
const id = '30000000-0000-4000-8000-000000000001'
const command = { key: id, payload: { action: 'create' as const, name: 'Shoes' } }
const result = { categoryId: id, name: 'Shoes', status: 'active' as const }
const history = {
  canManage: true,
  categories: [{ id, name: 'Shoes', status: 'active' as const, productCount: 0, pricingGroupCount: 0 }],
}
it.each(['', '{', 'null', '{}'])('fails closed on corrupt saved command %s', (value) =>
  expect(() => restoreCategoryCommand(value)).toThrow(),
)
it('preserves the original key/body on restore', () =>
  expect(restoreCategoryCommand(JSON.stringify(command))).toEqual(command))
it('distinguishes no command from corrupt storage', () => expect(restoreCategoryCommand(null)).toBeNull())
it('only matches the same full saved command', () => {
  expect(categoryCommandMatches(command, command)).toBe(true)
  expect(categoryCommandMatches(command, { ...command, payload: { action: 'create', name: 'Other' } })).toBe(false)
  expect(categoryCommandMatches(command, { ...command, key: '40000000-0000-4000-8000-000000000001' })).toBe(false)
})
it('reconciles matched response and history before removing recovery', () =>
  expect(reconcileCategory(command, result, history)).toEqual(result))
it('retains recovery on missing history or mismatched identity/name/status', () => {
  expect(() => reconcileCategory(command, result, { canManage: true, categories: [] })).toThrow()
  expect(() => reconcileCategory(command, { ...result, name: 'Other' }, history)).toThrow()
  expect(() =>
    reconcileCategory({ key: id, payload: { action: 'archive', categoryId: id } }, result, history),
  ).toThrow()
  expect(() =>
    reconcileCategory(
      { key: id, payload: { action: 'rename', categoryId: '40000000-0000-4000-8000-000000000001', name: 'Shoes' } },
      result,
      history,
    ),
  ).toThrow()
})
it('does not dismiss unknown, auth or key conflicts as definite rejection', () => {
  for (const code of [undefined, 'CATALOG_ACCESS_DENIED', 'IDEMPOTENCY_KEY_CONFLICT'])
    expect(categoryDefinitivelyRejected(code)).toBe(false)
  for (const code of ['CATEGORY_DUPLICATE', 'CATEGORY_IN_USE', 'CATEGORY_ARCHIVED'])
    expect(categoryDefinitivelyRejected(code)).toBe(true)
})
it('strictly rejects client scope and invalid archive payloads', () => {
  expect(catalogCategoryCommandSchema.safeParse({ action: 'archive', categoryId: id, name: 'Other' }).success).toBe(
    false,
  )
  expect(catalogCategoryCommandSchema.safeParse({ action: 'create', name: 'Shoes', tenantId: id }).success).toBe(false)
})
