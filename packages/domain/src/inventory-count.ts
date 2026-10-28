/** Values must come from server-authorized, locked tenant/location records. */
export type InventoryCountSnapshot = {
  variantId: string
  expectedMilli: number
  balanceVersion: number
}

export type InventoryCountEntry = {
  variantId: string
  countedMilli: number
}

export type InventoryCountCurrentBalance = {
  variantId: string
  onHandMilli: number
  balanceVersion: number
}

/** This is a policy helper over verified server context, never client role claims. */
export function canPerformInventoryCountAction(
  actor: {
    tenantActive: boolean
    membershipActive: boolean
    locationAllowed: boolean
    isOwner: boolean
    activeEmployee: boolean
    activeManagerRole: boolean
    explicitCountPermission: boolean
  },
  action: 'create' | 'enter' | 'post',
): boolean {
  if (
    !actor.tenantActive ||
    !actor.membershipActive ||
    !actor.locationAllowed ||
    !['create', 'enter', 'post'].includes(action)
  )
    return false
  if (actor.isOwner) return true
  if (!actor.activeEmployee) return false
  if (actor.activeManagerRole) return true
  return action === 'enter' && actor.explicitCountPermission
}

const MAX_QUANTITY = 999_999_999_999
function quantity(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_QUANTITY)
    throw new Error('Count quantities must be nonnegative milli-units within the inventory limit.')
  return value
}
function version(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('A valid inventory balance version is required.')
  return value
}

/** Pure preview only. Neither authorizes a user nor records a stock adjustment. */
export function previewInventoryCount(
  snapshots: readonly InventoryCountSnapshot[],
  entries: readonly InventoryCountEntry[],
  currentBalances: readonly InventoryCountCurrentBalance[],
) {
  if (snapshots.length === 0 || snapshots.length > 500) throw new Error('Select between one and 500 count lines.')
  const unique = <T extends { variantId: string }>(rows: readonly T[]) => {
    const map = new Map<string, T>()
    for (const row of rows) {
      if (!row.variantId.trim() || map.has(row.variantId)) throw new Error('Count line identities must be unique.')
      map.set(row.variantId, row)
    }
    return map
  }
  const originals = unique(snapshots)
  const counts = unique(entries)
  const balances = unique(currentBalances)
  if (counts.size !== originals.size || balances.size !== originals.size)
    throw new Error('Every selected line requires a count and current inventory balance.')
  let stale = false
  const lines = snapshots.map((snapshot) => {
    const entry = counts.get(snapshot.variantId)
    const current = balances.get(snapshot.variantId)
    if (!entry || !current) throw new Error('Count lines do not match the original selection.')
    const expected = quantity(snapshot.expectedMilli)
    const counted = quantity(entry.countedMilli)
    const onHand = quantity(current.onHandMilli)
    const snapshotVersion = version(snapshot.balanceVersion)
    const currentVersion = version(current.balanceVersion)
    const changed = currentVersion !== snapshotVersion || onHand !== expected
    stale ||= changed
    return {
      variantId: snapshot.variantId,
      expectedMilli: expected,
      countedMilli: counted,
      varianceMilli: counted - expected,
      stale: changed,
    }
  })
  return { lines, stale, requiresRevalidation: stale }
}
