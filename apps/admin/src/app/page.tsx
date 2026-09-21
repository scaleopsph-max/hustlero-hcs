import { ShieldCheck } from 'lucide-react'
import { Button, Chip, Glass, Logo, Surface, cn } from '@hcs/ui'
import { adminNav, healthLabel, healthTone, jobs, metrics, services, supportRequests, tenants } from '@/mock/platform'

const h2 = 'font-display text-lg font-bold leading-[22px] text-white'
const metricColor = {
  warning: 'text-signal-dark-warning-fg',
  attention: 'text-signal-dark-attention-fg',
  critical: 'text-signal-dark-critical-fg',
} as const

/**
 * HCS Super Admin: platform dashboard (spec section 32 and 33).
 * TODO: a separate deployment and auth domain from the tenant Back Office, with MFA and platform-admin roles.
 */
export default function PlatformDashboard() {
  return (
    <Surface
      tone="dark"
      className="flex min-h-screen gap-4 p-4"
      glows={[
        { color: 'gold', className: '-left-40 -top-36 size-[560px] opacity-25' },
        { color: 'gray', className: '-right-32 top-[120px] size-[560px] opacity-30' },
        { color: 'gold', className: 'left-[560px] top-[700px] size-[520px] opacity-15' },
      ]}
    >
      <Glass
        as="aside"
        className="flex w-[248px] flex-none flex-col gap-[18px] rounded-[24px] px-3.5 py-5 text-ink-200"
      >
        <div className="flex items-center gap-3 px-1.5">
          <Logo size={36} />
          <div className="flex flex-col">
            <span className="font-display text-lg font-bold leading-5 text-white">HCS Super Admin</span>
            <span className="text-xs text-ink-300">Platform operators only</span>
          </div>
        </div>
        <nav aria-label="Platform" className="flex flex-col gap-0.5">
          {adminNav.map((label, i) => (
            <a
              key={label}
              href="#"
              aria-current={i === 0 ? 'page' : undefined}
              className={cn(
                'flex h-10 items-center rounded-control px-3 text-sm font-medium',
                i === 0 ? 'bg-gold-500/[0.16] text-gold-100' : 'text-ink-200 hover:bg-white/[0.06]',
              )}
            >
              <span className="flex-1">{label}</span>
              {label === 'Support access' || label === 'Incidents' ? (
                <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-signal-dark-critical-solid px-[7px] text-xs font-bold text-white">
                  {label === 'Incidents' ? 1 : 2}
                </span>
              ) : null}
            </a>
          ))}
        </nav>
      </Glass>

      <main className="flex min-w-0 flex-1 flex-col gap-4">
        <Glass
          variant="gold"
          role="note"
          className="flex min-h-14 items-center gap-3 rounded-[18px] px-5 py-2.5 text-sm leading-5 text-gold-100"
        >
          <ShieldCheck size={20} strokeWidth={1.9} className="flex-none" />
          <span>
            You are in the platform console. Tenant data opens only through Support access with a reason or ticket. It
            is read-only by default and every view is audited.
          </span>
        </Glass>

        <Glass as="header" className="flex h-16 flex-none items-center justify-between rounded-[20px] px-5">
          <h1 className="font-display text-2xl font-bold leading-7 text-white">Platform dashboard</h1>
          <div className="flex items-center gap-3.5">
            <span className="inline-flex h-7 items-center rounded-full bg-gold-500 px-3 text-[13px] font-bold text-ink-950">
              Production
            </span>
            <div className="flex items-center gap-2.5">
              <span className="flex size-10 items-center justify-center rounded-full bg-white/[0.12] text-sm font-bold text-white">
                PA
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-white">Platform admin</span>
                <span className="text-xs text-ink-300">MFA verified</span>
              </div>
            </div>
          </div>
        </Glass>

        <div className="flex items-center justify-between px-1 pt-1">
          <h2 className="font-display text-xl font-bold leading-6 text-white">System health</h2>
          <Chip tone="info">Sample data</Chip>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {services.map((s) => (
            <Glass
              key={s.name}
              className="flex min-h-[76px] items-center justify-between gap-3 rounded-[18px] px-4 py-3.5"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-[15px] font-semibold text-white">{s.name}</span>
                <span className="text-[13px] text-ink-300">{s.metric}</span>
              </div>
              <Chip tone={healthTone[s.health]} className="flex-none">
                {healthLabel[s.health]}
              </Chip>
            </Glass>
          ))}
        </div>

        <div className="grid grid-cols-6 gap-3">
          {metrics.map((m) => (
            <Glass key={m.label} className="flex min-w-0 flex-col gap-1 rounded-[18px] px-4 py-3.5">
              <span className="text-[13px] text-ink-300">{m.label}</span>
              <span
                className={cn(
                  'font-display text-2xl font-bold leading-[30px]',
                  m.tone ? metricColor[m.tone] : 'text-white',
                )}
              >
                {m.value}
              </span>
            </Glass>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.3fr)]">
          <Glass className="flex flex-col gap-1 rounded-panel p-5">
            <h2 className={`${h2} mb-2`}>Jobs by state</h2>
            {jobs.map((j) => (
              <div
                key={j.state}
                className="flex min-h-11 items-center justify-between border-t border-white/[0.08] text-sm"
              >
                <Chip tone={j.tone}>{j.state}</Chip>
                <span className="font-bold text-white">{j.count}</span>
              </div>
            ))}
          </Glass>

          <Glass className="flex flex-col gap-1 rounded-panel p-5">
            <h2 className={`${h2} mb-2`}>Tenants needing attention</h2>
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_96px] gap-3 border-t border-white/[0.12] py-2 text-xs font-semibold text-ink-300">
              <span>Tenant</span>
              <span>Issue</span>
              <span>Status</span>
            </div>
            {tenants.map((t) => (
              <div
                key={t.name}
                className="grid min-h-[60px] grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_96px] items-center gap-3 border-t border-white/[0.08] text-sm"
              >
                <div className="flex flex-col">
                  <span className="font-semibold text-white">{t.name}</span>
                  <span className="text-xs text-ink-300">{t.plan}</span>
                </div>
                <span className="leading-5 text-ink-100">{t.issue}</span>
                <Chip tone={t.tone} className="h-6 justify-self-start text-xs">
                  {t.status}
                </Chip>
              </div>
            ))}
          </Glass>

          <Glass className="flex flex-col gap-1 rounded-panel p-5">
            <h2 className={`${h2} mb-2`}>Support access requests</h2>
            {supportRequests.map((r) => (
              <div key={r.reason} className="flex flex-col gap-2.5 border-t border-white/[0.08] py-3.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-white">{r.tenant}</span>
                  <span className="text-[13px] leading-[19px] text-ink-100">{r.reason}</span>
                  <span className="text-xs text-ink-300">{r.scope}</span>
                </div>
                <div className="flex gap-2">
                  {/* TODO: granting access creates an audited, time-boxed, read-only session. Elevated access needs a stronger permission. */}
                  <Button variant="confirm" size="sm" className="rounded-[10px] text-[13px]">
                    Grant read-only
                  </Button>
                  <Button size="sm" className="rounded-[10px] text-[13px]">
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </Glass>
        </div>
      </main>
    </Surface>
  )
}
