'use client'

import { createClient } from '@/lib/supabase-browser'
import { ChevronDown, Lock } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { sessionContextResponseSchema, type TenantAccess } from '@hcs/contracts'
import { Glass, Logo, cn } from '@hcs/ui'
import { formatLocationCount, saveActiveTenant, selectActiveTenant } from '@/lib/active-tenant'
import { NAV_CONTEXT, navGroups, resolveNav } from '@/mock/nav'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const apiUrl = process.env.NEXT_PUBLIC_API_URL

/** Floating black-glass sidebar. Adaptive: see mock/nav.ts. */
export function Sidebar({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const pathname = usePathname()
  const menuRef = useRef<HTMLDivElement>(null)
  const [tenants, setTenants] = useState<TenantAccess[]>([])
  const [activeTenant, setActiveTenant] = useState<TenantAccess | null>(null)
  const [businessMenuOpen, setBusinessMenuOpen] = useState(false)
  const groups = resolveNav(navGroups, NAV_CONTEXT)
  const lockedCount = groups.flatMap((g) => g.items).filter((i) => i.locked).length

  useEffect(() => {
    if (!supabaseUrl || !supabaseKey || !apiUrl) return
    const auth = createClient(supabaseUrl, supabaseKey)

    void auth.auth.getSession().then(async ({ data }) => {
      if (!data.session) return
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/me`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: 'no-store',
      })
      if (!response.ok) return
      const session = sessionContextResponseSchema.parse(await response.json())
      setTenants(session.tenants)
      setActiveTenant(selectActiveTenant(session.tenants) ?? null)
    })
  }, [])

  useEffect(() => {
    if (!businessMenuOpen) return
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setBusinessMenuOpen(false)
    }
    document.addEventListener('mousedown', closeMenu)
    return () => document.removeEventListener('mousedown', closeMenu)
  }, [businessMenuOpen])

  function changeBusiness(tenant: TenantAccess) {
    if (tenant.tenantId === activeTenant?.tenantId) {
      setBusinessMenuOpen(false)
      return
    }
    saveActiveTenant(tenant.tenantId)
    setActiveTenant(tenant)
    setBusinessMenuOpen(false)
    window.location.reload()
  }

  return (
    <Glass
      variant="dark"
      as="aside"
      className={cn('flex w-[248px] flex-none flex-col gap-4 rounded-[24px] px-3.5 py-5 text-ink-200', className)}
    >
      <div className="flex h-11 items-center gap-3 px-1.5">
        <Logo size={36} />
        <span className="font-display text-[19px] font-bold text-white">HUSTLERO</span>
      </div>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={businessMenuOpen}
          disabled={!activeTenant}
          onClick={() => setBusinessMenuOpen((open) => !open)}
          className="flex h-14 w-full items-center justify-between gap-2 rounded-[14px] border border-white/[0.12] bg-white/[0.08] px-3.5 text-left text-white disabled:cursor-wait disabled:opacity-60"
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">{activeTenant?.tenantName ?? 'Loading business...'}</span>
            <span className="text-xs text-ink-300">
              {activeTenant ? formatLocationCount(activeTenant) : 'Please wait'}
            </span>
          </span>
          <ChevronDown
            size={18}
            strokeWidth={1.75}
            className={cn('flex-none text-ink-300 transition-transform', businessMenuOpen && 'rotate-180')}
          />
        </button>

        {businessMenuOpen ? (
          <div
            role="menu"
            aria-label="Select business"
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-[10px] border border-white/15 bg-ink-900 p-1.5 shadow-xl"
          >
            {tenants.map((tenant) => (
              <button
                key={tenant.tenantId}
                type="button"
                role="menuitemradio"
                aria-checked={tenant.tenantId === activeTenant?.tenantId}
                onClick={() => changeBusiness(tenant)}
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm hover:bg-white/10',
                  tenant.tenantId === activeTenant?.tenantId ? 'bg-white/10 text-gold-200' : 'text-white',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{tenant.tenantName}</span>
                  <span className="block text-xs text-ink-300">{formatLocationCount(tenant)}</span>
                </span>
                {tenant.tenantId === activeTenant?.tenantId ? <span className="text-xs">Active</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <nav aria-label="Main" className="flex flex-col">
        {groups.map((g) => (
          <div key={g.heading} className="flex flex-col">
            <div className="px-3 pb-1.5 pt-[18px] text-xs font-semibold text-ink-400">{g.heading}</div>
            {g.items.map(({ label, href, icon: Icon, badge, locked }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  {...(onNavigate ? { onClick: onNavigate } : {})}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-10 items-center gap-3 rounded-control px-3 text-sm font-medium',
                    active
                      ? 'bg-gold-500/[0.16] text-gold-100'
                      : locked
                        ? 'text-ink-400'
                        : 'text-ink-200 hover:bg-white/[0.06]',
                  )}
                >
                  <Icon size={20} strokeWidth={1.75} className="flex-none" />
                  <span className="flex-1">{label}</span>
                  {badge ? (
                    <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-gold-500 px-[7px] text-xs font-bold text-ink-950">
                      {badge}
                    </span>
                  ) : null}
                  {locked ? <Lock size={16} strokeWidth={1.75} aria-label="Locked module" /> : null}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 rounded-[16px] border border-white/10 bg-white/[0.06] p-3.5">
        <span className="text-sm font-semibold text-white">Free core plan</span>
        <span className="text-[13px] leading-[18px] text-ink-300">
          {lockedCount} module{lockedCount === 1 ? ' is' : 's are'} locked. Unlock them any time.
        </span>
        <Link href="/settings" className="mt-1.5 text-[13px] font-semibold text-gold-300">
          See modules
        </Link>
      </div>
    </Glass>
  )
}
