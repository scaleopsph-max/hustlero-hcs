/**
 * MOCK DATA for the Dashboard (spec section 28). Replace with the reporting API.
 * All money is integer centavos. Filters (date, location, channel) are query params.
 */
import type { Centavos } from '@hcs/ui'
import type { ChipTone } from '@hcs/ui'

export type Kpi = { label: string; value: Centavos | number; kind: 'money' | 'count'; delta: string; tone: ChipTone }

// Estimated net profit = gross profit - expenses. Gross profit = net sales - COGS.
export const kpis: Kpi[] = [
  { label: 'Net sales', value: 18432000, kind: 'money', delta: '+8.4%', tone: 'success' },
  { label: 'Gross profit', value: 6174000, kind: 'money', delta: '+5.1%', tone: 'success' },
  { label: 'Est. net profit', value: 3821000, kind: 'money', delta: '+3.2%', tone: 'success' },
  { label: 'Transactions', value: 412, kind: 'count', delta: '−2.4%', tone: 'attention' },
  { label: 'COGS', value: 12258000, kind: 'money', delta: '+9.6%', tone: 'neutral' },
  { label: 'Expenses', value: 2353000, kind: 'money', delta: '+1.0%', tone: 'neutral' },
]

export const salesChart = {
  labels: ['8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM'],
  today: [
    300000, 700000, 1300000, 1700000, 1400000, 1100000, 1200000, 1800000, 2200000, 2400000, 2000000, 1400000, 900000,
  ],
  yesterday: [
    300000, 600000, 1200000, 1600000, 1300000, 1000000, 1200000, 1600000, 2000000, 2200000, 1900000, 1400000, 900000,
  ],
  yMax: 3000000,
}

export type Severity = 'critical' | 'warning' | 'attention' | 'info'
export const severityTone: Record<Severity, ChipTone> = {
  critical: 'critical',
  warning: 'warning',
  attention: 'attention',
  info: 'info',
}
export const severityLabel: Record<Severity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  attention: 'Attention',
  info: 'Info',
}

export const alerts: { severity: Severity; title: string; meta: string; action: string; href: string }[] = [
  {
    severity: 'critical',
    title: 'Register 2 is short by ₱120.00 and needs approval',
    meta: 'Main Branch, closed 2:05 PM',
    action: 'Review',
    href: '/approvals',
  },
  {
    severity: 'warning',
    title: 'Cold brew 500 ml is below reorder level at 2 locations',
    meta: 'Inventory',
    action: 'View stock',
    href: '/inventory',
  },
  {
    severity: 'attention',
    title: '3 refunds are waiting for a manager',
    meta: 'Approvals',
    action: 'Open approvals',
    href: '/approvals',
  },
  {
    severity: 'info',
    title: 'Transfer TR-000231 arrived 2 units short',
    meta: 'Cavite Branch',
    action: 'Resolve',
    href: '/transfers',
  },
]

export const branches = [
  { name: 'Main Branch', sales: 9240000, grossProfit: 3102000, txns: 198 },
  { name: 'Cavite Branch', sales: 5891000, grossProfit: 1924000, txns: 131 },
  { name: 'Market Stall', sales: 3301000, grossProfit: 1148000, txns: 83 },
]

export const inventoryHealth = {
  total: 1302,
  segments: [
    { label: 'Healthy stock', count: 1184, bar: 'bg-ink-900' },
    { label: 'Low stock', count: 46, bar: 'bg-gold-500' },
    { label: 'Out of stock', count: 12, bar: 'bg-signal-light-critical-solid' },
    { label: 'Slow-moving', count: 60, bar: 'bg-ink-400' },
  ],
}

export type RegisterState = 'open' | 'variance' | 'closed'
export const registerTone: Record<RegisterState, ChipTone> = {
  open: 'success',
  variance: 'critical',
  closed: 'neutral',
}
export const registerLabel: Record<RegisterState, string> = { open: 'Open', variance: 'Variance', closed: 'Closed' }
export const registers: { name: string; meta: string; state: RegisterState }[] = [
  { name: 'Register 1, Main Branch', meta: 'Ana R., since 7:58 AM', state: 'open' },
  { name: 'Register 2, Main Branch', meta: 'Closed 2:05 PM, short ₱120.00', state: 'variance' },
  { name: 'Register 1, Cavite Branch', meta: 'Jun M., since 8:30 AM', state: 'open' },
  { name: 'Market Stall', meta: 'Not opened today', state: 'closed' },
]

// Fund balance is a SUMMARY. The fund movement ledger is the truth (spec section 18.4).
export const funds = [
  { name: 'Capital/COGS Fund', balance: 21240000 },
  { name: 'Operating Fund', balance: 4685000 },
]
// HCS recommends. The user confirms. No real bank transfer is made in early versions.
export const suggestedAllocation = { fund: 'Capital/COGS Fund', amount: 12258000 }
