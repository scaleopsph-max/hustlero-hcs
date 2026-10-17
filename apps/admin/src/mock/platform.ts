/**
 * MOCK DATA for the Super Admin console (spec sections 32 and 33). Replace with the platform-ops API.
 * Super Admin and the tenant Back Office are SEPARATE security domains. Never share sessions, routes or components that expose tenant data.
 */
import type { ChipTone } from '@hcs/ui'

export type Health = 'healthy' | 'degraded' | 'incident'
export const healthTone: Record<Health, ChipTone> = { healthy: 'success', degraded: 'attention', incident: 'critical' }
export const healthLabel: Record<Health, string> = { healthy: 'Healthy', degraded: 'Degraded', incident: 'Incident' }

export const services: { name: string; metric: string; health: Health }[] = [
  { name: 'API', metric: 'p95 182 ms', health: 'healthy' },
  { name: 'Database', metric: '142 of 400 connections', health: 'healthy' },
  { name: 'Redis', metric: '1.2 ms round trip', health: 'healthy' },
  { name: 'Queue', metric: '1,840 jobs waiting', health: 'degraded' },
  { name: 'Object storage', metric: 'Reads and writes normal', health: 'healthy' },
  { name: 'Email', metric: 'No failures in the last hour', health: 'healthy' },
  { name: 'Back Office', metric: 'Error rate 0.2%', health: 'healthy' },
  { name: 'POS', metric: 'Error rate 0.1%', health: 'healthy' },
  { name: 'Marketplace connectors', metric: 'Shopee sync failing since 1:40 PM', health: 'incident' },
]

export const metrics: { label: string; value: string; tone?: 'warning' | 'attention' | 'critical' }[] = [
  { label: 'API latency, p95', value: '182 ms' },
  { label: 'Error rate', value: '0.21%' },
  { label: 'DB connections', value: '142 / 400' },
  { label: 'Failed jobs', value: '37', tone: 'warning' },
  { label: 'Queue backlog', value: '1,840', tone: 'attention' },
  { label: 'Sync failures', value: '18', tone: 'critical' },
]

/** Job states from spec section 33. */
export const jobs: { state: string; count: string; tone: ChipTone }[] = [
  { state: 'Pending', count: '1,840', tone: 'neutral' },
  { state: 'Processing', count: '64', tone: 'info' },
  { state: 'Failed', count: '37', tone: 'warning' },
  { state: 'Retrying', count: '21', tone: 'attention' },
  { state: 'Dead letter', count: '4', tone: 'critical' },
]

export const tenants: { name: string; plan: string; issue: string; status: string; tone: ChipTone }[] = [
  {
    name: 'Kape Kalye Co.',
    plan: 'Free core, Shopee',
    issue: 'Shopee order sync failing since 1:40 PM',
    status: 'Incident',
    tone: 'critical',
  },
  {
    name: 'Bayan Hardware',
    plan: 'Free core, Warehouse trial',
    issue: 'Warehouse trial ends in 3 days',
    status: 'Trial',
    tone: 'attention',
  },
  {
    name: 'Luntian Mart',
    plan: 'Free core, Finance Pro',
    issue: 'Invoice unpaid. History stays available.',
    status: 'Suspended',
    tone: 'neutral',
  },
]

/** Support access: requires a reason or ticket, read-only by default, fully audited (spec section 32). */
export const supportRequests = [
  {
    tenant: 'Bayan Hardware',
    reason: 'Ticket SUP-2041: sales report does not match the daily close.',
    scope: 'Read-only, 24 hours',
  },
  { tenant: 'Kape Kalye Co.', reason: 'Ticket SUP-2044: Shopee orders are not syncing.', scope: 'Read-only, 24 hours' },
]

export const adminNav = [
  'Platform dashboard',
  'Tenants',
  'Subscriptions and add-ons',
  'Billing',
  'Feature management',
  'Support access',
  'Platform admins',
  'Usage and limits',
  'System health',
  'Integration health',
  'Jobs and queues',
  'Incidents',
  'Platform audit',
  'Announcements',
] as const
