import {
  Activity,
  ArrowLeftRight,
  Bell,
  ChartColumn,
  CircleCheck,
  CircleDollarSign,
  LayoutDashboard,
  Gift,
  LockKeyhole,
  MapPin,
  Monitor,
  Package,
  Percent,
  Receipt,
  ShoppingBag,
  SlidersHorizontal,
  Smartphone,
  Store,
  Truck,
  User,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'

/**
 * Back Office navigation (spec section 30). The UI must NOT show every module at once.
 * Visibility is layered (spec section 7):
 *   platform available -> tenant entitled -> tenant enabled -> employee permitted
 * resolveNav() applies the last three. Replace NAV_CONTEXT with data from the entitlements API.
 */
export type NavItem = {
  label: string
  href: string
  icon: LucideIcon
  badge?: number
  /** Capability code. Not entitled: shown locked. Entitled but switched off: hidden. */
  feature?: string
  /** Permission code. Missing: hidden. */
  permission?: string
}
export type NavGroup = { heading: string; items: NavItem[] }
export type ResolvedNavItem = NavItem & { locked: boolean }
export type ResolvedNavGroup = { heading: string; items: ResolvedNavItem[] }

export type NavContext = {
  entitled: ReadonlySet<string>
  enabled: ReadonlySet<string>
  permissions: ReadonlySet<string>
}

export const navGroups: NavGroup[] = [
  {
    heading: 'Run the business',
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard },
      { label: 'Sales', href: '/sales', icon: Receipt },
      { label: 'Products', href: '/products', icon: Package },
      { label: 'Inventory', href: '/inventory', icon: Warehouse },
      { label: 'Purchasing', href: '/purchasing', icon: Truck },
      { label: 'Transfers and restock', href: '/transfers', icon: ArrowLeftRight },
      { label: 'Customers', href: '/customers', icon: Users },
      { label: 'Loyalty', href: '/loyalty', icon: Gift },
    ],
  },
  {
    heading: 'Money and control',
    items: [
      { label: 'Finance', href: '/finance', icon: Wallet },
      { label: 'Approvals', href: '/approvals', icon: CircleCheck },
      { label: 'Alerts', href: '/alerts', icon: Bell, badge: 5 },
      { label: 'Reports', href: '/reports', icon: ChartColumn },
      { label: 'Audit and activity', href: '/audit', icon: Activity },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { label: 'Business setup', href: '/setup', icon: Store },
      { label: 'Employees', href: '/employees', icon: User },
      { label: 'Locations', href: '/locations', icon: MapPin },
      { label: 'Registers', href: '/registers', icon: Monitor },
      { label: 'POS devices', href: '/devices', icon: Smartphone },
      { label: 'Register sessions', href: '/register-sessions', icon: LockKeyhole },
      { label: 'Payment methods', href: '/payment-methods', icon: CircleDollarSign },
      { label: 'Settings', href: '/settings', icon: SlidersHorizontal },
    ],
  },
  {
    heading: 'Add-on modules',
    items: [
      { label: 'Online store', href: '/online-store', icon: ShoppingBag, feature: 'online_store' },
      { label: 'Advanced wholesale', href: '/wholesale', icon: Percent, feature: 'advanced_wholesale' },
    ],
  },
]

export function resolveNav(groups: NavGroup[], ctx: NavContext): ResolvedNavGroup[] {
  return groups
    .map((g) => ({
      heading: g.heading,
      items: g.items.flatMap((item): ResolvedNavItem[] => {
        if (item.permission && !ctx.permissions.has(item.permission)) return []
        if (!item.feature) return [{ ...item, locked: false }]
        if (!ctx.entitled.has(item.feature)) return [{ ...item, locked: true }]
        if (!ctx.enabled.has(item.feature)) return []
        return [{ ...item, locked: false }]
      }),
    }))
    .filter((g) => g.items.length > 0)
}

/** MOCK: free core plan, owner role. */
export const NAV_CONTEXT: NavContext = {
  entitled: new Set<string>(),
  enabled: new Set<string>(),
  permissions: new Set<string>(),
}
