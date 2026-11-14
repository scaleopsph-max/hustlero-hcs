import { resellerStockIssuesSchema, type ResellerStockIssue } from '@hcs/contracts'

import { formatQuantity } from './cart'
import { PortalApiError } from './portal-api'

/** The short cart items a stock refusal named, keyed by variant; empty for any other error. */
export function readStockIssues(error: unknown): Map<string, ResellerStockIssue> {
  if (!(error instanceof PortalApiError) || !error.details) return new Map()
  const parsed = resellerStockIssuesSchema.safeParse(error.details)
  return new Map(parsed.success ? parsed.data.stockIssues.map((issue) => [issue.variantId, issue]) : [])
}

/** What to tell the reseller on the cart line. */
export function stockIssueText(issue: ResellerStockIssue): string {
  return issue.availableMilli <= 0
    ? 'Out of stock now. Remove this item to place the order.'
    : `Only ${formatQuantity(issue.availableMilli)} left. Lower the quantity to ${formatQuantity(issue.availableMilli)} or less.`
}
