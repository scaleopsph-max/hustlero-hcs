import {
  resellerApplicationDecisionRequestSchema,
  resellerOrderReviewRequestSchema,
  type ResellerApplicationDecisionRequest,
  type ResellerOrderReviewRequest,
  type ResellerReviewReason,
} from '@hcs/contracts'
import { parsePeso } from '@hcs/ui'

export const reviewReasonText: Record<ResellerReviewReason, string> = {
  manual_review: 'Manual review is on for every portal order.',
  credit_settings_missing: 'The reseller has no credit settings yet.',
  credit_review: 'Historical invoices for this reseller need classification.',
  stock_insufficient: 'Available stock at the portal branch was short when the order arrived.',
  credit_limit: 'The order would exceed the reseller credit limit.',
}

export type ApprovalForm = {
  customerId: string
  priceListId: string
  paymentTerm: string
  creditLimit: string
  note: string
}

/** Builds an approval payload, or an error message the owner can act on. */
export function approvalRequest(form: ApprovalForm): ResellerApplicationDecisionRequest | string {
  if (!form.priceListId) return 'Choose the price list this reseller will order from.'
  if (!form.paymentTerm) return 'Choose payment terms.'
  if (!/^\d[\d,]*(\.\d{0,2})?$/.test(form.creditLimit.trim()))
    return 'Enter a credit limit in pesos, for example 15000.'
  const parsed = resellerApplicationDecisionRequestSchema.safeParse({
    decision: 'approve',
    priceListId: form.priceListId,
    paymentTerm: form.paymentTerm,
    creditLimitMinor: parsePeso(form.creditLimit),
    ...(form.customerId ? { customerId: form.customerId } : {}),
    ...(form.note.trim() ? { reason: form.note.trim() } : {}),
  })
  return parsed.success ? parsed.data : 'Check the approval details.'
}

export function rejectionRequest(reason: string): ResellerApplicationDecisionRequest | string {
  const parsed = resellerApplicationDecisionRequestSchema.safeParse({ decision: 'reject', reason: reason.trim() })
  return parsed.success ? parsed.data : 'Give a reason of at least 2 characters.'
}

export function orderReviewRequest(
  decision: 'approve' | 'reject',
  reason: string,
): ResellerOrderReviewRequest | string {
  const trimmed = reason.trim()
  const parsed = resellerOrderReviewRequestSchema.safeParse(
    decision === 'approve' ? { decision, ...(trimmed ? { reason: trimmed } : {}) } : { decision, reason: trimmed },
  )
  if (parsed.success) return parsed.data
  return decision === 'reject' ? 'Tell the reseller why the order is rejected.' : 'Notes must be 2 to 500 characters.'
}

/** The public link resellers use to apply; the portal origin is configured per environment. */
export function applicationLink(portalOrigin: string | undefined, tenantSlug: string): string | null {
  if (!portalOrigin) return null
  return `${portalOrigin.replace(/\/$/, '')}/apply?b=${encodeURIComponent(tenantSlug)}`
}

/** One key per pending command target; reused until the command succeeds so retries stay idempotent. */
export function commandKey(keys: Map<string, string>, target: string): string {
  const existing = keys.get(target)
  if (existing) return existing
  const key = `reseller-portal-${crypto.randomUUID()}`
  keys.set(target, key)
  return key
}
