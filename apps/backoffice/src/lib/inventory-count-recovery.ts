import { z } from 'zod'
import {
  inventoryCountCreateSchema,
  inventoryCountEntrySchema,
  inventoryCountSubmitSchema,
  inventoryCountDecisionSchema,
  inventoryCountPostSchema,
  inventoryCountCancelSchema,
} from '@hcs/contracts'

const id = z.uuid()
const schemas = {
  create: inventoryCountCreateSchema,
  entries: inventoryCountEntrySchema,
  submit: inventoryCountSubmitSchema,
  approval: inventoryCountDecisionSchema,
  post: inventoryCountPostSchema,
  cancel: inventoryCountCancelSchema,
}
export const pendingCountSchema = z
  .strictObject({
    version: z.literal(1),
    actorId: id,
    tenantId: id,
    key: id,
    action: z.enum(['create', 'entries', 'submit', 'approval', 'post', 'cancel']),
    countId: id.nullable(),
    body: z
      .string()
      .min(1)
      .max(64 * 1024),
  })
  .superRefine((command, ctx) => {
    if ((command.action === 'create') !== (command.countId === null))
      ctx.addIssue({ code: 'custom', message: 'Invalid count command scope.' })
    try {
      const parsed = schemas[command.action].parse(JSON.parse(command.body))
      if (JSON.stringify(parsed) !== command.body)
        ctx.addIssue({ code: 'custom', message: 'Count command body is not canonical.' })
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Count command body is invalid.' })
    }
  })
export type PendingCount = z.infer<typeof pendingCountSchema>
export function countStorage(tenantId: string, actorId: string) {
  return `hcs-inventory-count-v1:${tenantId}:${actorId}`
}
export function decodePendingCount(raw: string, tenantId: string, actorId: string) {
  const value = pendingCountSchema.parse(JSON.parse(raw))
  if (value.tenantId !== tenantId || value.actorId !== actorId || JSON.stringify(value) !== raw)
    throw new Error('Saved count command scope is inconsistent; reconciliation is required.')
  return value
}
export function countQuantityToMilli(value: string): number {
  if (!/^\d+(\.\d{1,3})?$/.test(value)) throw new Error('Enter a quantity with up to three decimal places.')
  const [whole, fraction = ''] = value.split('.'),
    milli = BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'))
  if (milli > 999_999_999_999n) throw new Error('Quantity exceeds the inventory limit.')
  return Number(milli)
}
export function countQuantity(value: number): string {
  const sign = value < 0 ? '-' : '',
    n = BigInt(Math.abs(value)),
    fraction = String(n % 1000n)
      .padStart(3, '0')
      .replace(/0+$/, '')
  return `${sign}${n / 1000n}${fraction ? '.' + fraction : ''}`
}
export class CountCommandError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
  }
}
export function canDiscardCountCommand(error: unknown) {
  return (
    error instanceof CountCommandError &&
    ['INVALID_INVENTORY_COUNT', 'INVENTORY_COUNT_CHANGED', 'INVENTORY_COUNT_CONFLICT'].includes(error.code)
  )
}
