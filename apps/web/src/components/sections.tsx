import { Check } from 'lucide-react'
import Link from 'next/link'
import { Glass, Logo, Surface, buttonClasses, cn } from '@hcs/ui'
import { boPoints, doubts, freeCore, modules, posPoints, quotePlaceholder, receipt, steps, verbs } from '@/content'

const APP_URL = 'https://app.hustlercentral.com'
const POS_URL = 'https://pos.hustlercentral.com'
const h2 = 'font-display text-[46px] font-bold leading-[50px] tracking-tight text-balance'
const section = 'px-20 py-[104px]'

function Tick({ className }: { className: string }) {
  return <Check size={22} strokeWidth={2.2} className={cn('mt-0.5 flex-none', className)} />
}

/** Sawtooth bottom edge of the receipt. */
function Zigzag({ width, tooth = 10, depth = 12 }: { width: number; tooth?: number; depth?: number }) {
  const n = Math.round(width / tooth)
  const pts = Array.from({ length: n + 1 }, (_, i) => `${i * tooth},${i % 2 === 0 ? 0 : depth}`).join(' ')
  return (
    <svg
      viewBox={`0 0 ${width} ${depth}`}
      width={width}
      height={depth}
      aria-hidden="true"
      className="block max-w-full fill-white/[0.86]"
    >
      <polygon points={`${pts} ${width},0`} />
    </svg>
  )
}

export function Nav() {
  return (
    <header className="flex h-[88px] items-center justify-between px-20">
      <Link href="#top" className="flex items-center gap-3 text-white">
        <Logo size={40} />
        <span className="font-display text-[21px] font-bold">HUSTLERO</span>
      </Link>
      <Glass as="nav" className="flex h-[60px] items-center gap-8 rounded-full py-0 pl-8 pr-2.5">
        <a href="#product" className="text-base font-medium text-ink-100">
          Product
        </a>
        <a href="#modules" className="text-base font-medium text-ink-100">
          Free core and modules
        </a>
        <a href={APP_URL} className="text-base font-medium text-ink-100">
          Sign in
        </a>
        <a
          href="#start"
          className={buttonClasses({
            variant: 'primary',
            size: 'sm',
            className: 'rounded-full px-6 text-base font-bold',
          })}
        >
          Start free
        </a>
      </Glass>
    </header>
  )
}

export function Hero() {
  return (
    <div className="flex items-start gap-[72px] px-20 pb-24 pt-10">
      <div className="flex w-[660px] flex-none flex-col gap-7 pt-6">
        <h1 className="font-display text-[72px] font-bold leading-[74px] tracking-tight text-white text-balance">
          Know where every peso and every item went.
        </h1>
        <p className="max-w-[580px] text-xl leading-[30px] text-ink-200">
          HUSTLERO runs your counter, your stock and your books from one place. Sell at the register, restock across
          branches, and close the day knowing the numbers are true.
        </p>
        <div className="mt-2 flex items-center gap-7">
          <a
            href="#start"
            className={buttonClasses({ variant: 'primary', className: 'min-h-[60px] rounded-2xl px-[34px] text-lg' })}
          >
            Start free
          </a>
          <a href="#product" className="text-[17px] font-semibold text-white underline underline-offset-[5px]">
            See what one sale updates
          </a>
        </div>
        <span className="text-[15px] leading-[22px] text-ink-300">
          The free core plan covers POS, inventory, basic reports and daily close.
        </span>
      </div>

      <div className="flex min-w-0 flex-1 justify-end">
        <div className="flex w-[470px] flex-col">
          <div className="glass-data flex flex-col gap-[18px] rounded-t-lg border-b-0 px-[34px] pb-[22px] pt-[30px] text-ink-900">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-base font-bold">{receipt.header}</span>
                <span className="text-sm text-ink-500">Receipt {receipt.number}</span>
              </div>
              <span className="inline-flex h-[26px] items-center rounded-full bg-signal-light-attention-bg px-2.5 text-xs font-semibold text-signal-light-attention-fg">
                Sample
              </span>
            </div>
            <hr className="border-t-2 border-dashed border-ink-400" />
            <ul className="flex flex-col gap-3.5">
              {receipt.lines.map((l) => (
                <li key={l.name} className="flex justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-[15px] font-semibold">{l.name}</span>
                    <span className="text-[13px] text-ink-500">{l.qty}</span>
                  </div>
                  <span className="text-[15px] font-semibold">{l.amount}</span>
                </li>
              ))}
            </ul>
            <hr className="border-t-2 border-dashed border-ink-400" />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-xl font-bold">Total</span>
                <span className="font-display text-[28px] font-bold">{receipt.total}</span>
              </div>
              <div className="flex justify-between text-sm text-ink-700">
                <span>Cash</span>
                <span>{receipt.cash}</span>
              </div>
              <div className="flex justify-between text-sm text-ink-700">
                <span>Change</span>
                <span>{receipt.change}</span>
              </div>
            </div>
            <hr className="border-t-2 border-dashed border-ink-400" />
            <div className="flex flex-col gap-3">
              <span className="text-[15px] font-bold text-gold-800">What this one sale updated</span>
              {receipt.updates.map((u) => (
                <div key={u.label} className="flex items-start gap-2.5">
                  <Check size={20} strokeWidth={2.2} className="mt-px flex-none text-gold-700" />
                  <span className="text-sm leading-5 text-ink-700">
                    <strong className="text-ink-900">{u.label}</strong> {u.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <Zigzag width={470} />
        </div>
      </div>
    </div>
  )
}

export function Verbs() {
  return (
    <div id="product" className={cn(section, 'flex gap-24')}>
      <div className="flex w-[400px] flex-none flex-col gap-5">
        <h2 className={cn(h2, 'text-white')}>Sell, then stay in control of everything that follows.</h2>
        <p className="text-lg leading-7 text-ink-300">
          One business, one inventory, one sales truth. It holds across every branch and every channel you add.
        </p>
      </div>
      <dl className="min-w-0 flex-1 border-t-2 border-gold-500">
        {verbs.map((v) => (
          <div key={v.name} className="flex items-baseline gap-8 border-b border-white/[0.12] py-7">
            <dt className="w-[190px] flex-none font-display text-[40px] font-bold leading-[44px] tracking-tight text-gold-300">
              {v.name}
            </dt>
            <dd className="flex-1 text-lg leading-7 text-ink-100">{v.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function Apps() {
  return (
    <div className={cn(section, 'flex flex-col gap-14')}>
      <div className="flex max-w-[820px] flex-col gap-4">
        <h2 className={cn(h2, 'text-white')}>The counter and the back office share one record.</h2>
        <p className="text-lg leading-7 text-ink-300">
          Two separate apps, built for two different jobs, reading and writing the same stock and the same sales.
        </p>
      </div>
      <div className="flex gap-6">
        <Glass variant="strong" className="flex min-w-0 flex-1 flex-col gap-[22px] rounded-[28px] p-11">
          <div className="flex flex-col gap-1">
            <span className="font-display text-4xl font-bold leading-10 text-white">POS</span>
            <a href={POS_URL} className="text-[15px] text-ink-300">
              pos.hustlercentral.com
            </a>
          </div>
          <p className="text-[17px] leading-[27px] text-ink-100">
            Built for the counter. Big touch targets, PIN sign-in, and a status that always tells you whether you are
            online.
          </p>
          <ul className="flex flex-col gap-3.5">
            {posPoints.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <Tick className="text-gold-500" />
                <span className="text-base leading-6 text-ink-50">{p}</span>
              </li>
            ))}
          </ul>
        </Glass>
        <div className="glass-data flex min-w-0 flex-1 flex-col gap-[22px] rounded-[28px] p-11 text-ink-900">
          <div className="flex flex-col gap-1">
            <span className="font-display text-4xl font-bold leading-10">Back Office</span>
            <a href={APP_URL} className="text-[15px] text-ink-500">
              app.hustlercentral.com
            </a>
          </div>
          <p className="text-[17px] leading-[27px] text-ink-700">
            Built for owners and managers. See what sold, what is left, what needs approving and where the money should
            go.
          </p>
          <ul className="flex flex-col gap-3.5">
            {boPoints.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <Tick className="text-gold-700" />
                <span className="text-base leading-6">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

export function Modules() {
  return (
    <Surface
      tone="light"
      className={cn(section, 'flex flex-col gap-14')}
      glows={[
        { color: 'gold', className: '-left-24 -top-32 size-[560px] opacity-45' },
        { color: 'gray', className: '-right-36 top-[420px] size-[560px] opacity-30' },
      ]}
    >
      <div id="modules" className="flex max-w-[900px] flex-col gap-4">
        <h2 className={cn(h2, 'text-ink-900')}>
          Start with everything a small shop needs. Add the rest when you grow.
        </h2>
        <p className="text-lg leading-7 text-ink-700">
          Safety and traceability are never behind a paywall. Paid modules add automation, scale and integrations.
        </p>
      </div>
      <div className="flex items-start gap-7">
        <Glass variant="dark" className="flex w-[520px] flex-none flex-col gap-6 rounded-[28px] p-10 text-white">
          <div className="flex flex-col gap-1.5">
            <span className="font-display text-[32px] font-bold leading-9 text-gold-300">Free core</span>
            <span className="text-base leading-6 text-ink-200">
              Enough to run a real small business from the first day.
            </span>
          </div>
          <ul className="flex flex-col gap-3.5">
            {freeCore.map((f) => (
              <li key={f} className="flex items-start gap-3">
                <Tick className="text-gold-500" />
                <span className="text-base leading-6">{f}</span>
              </li>
            ))}
          </ul>
        </Glass>
        <div className="glass-data flex min-w-0 flex-1 flex-col rounded-[28px] px-9 pb-5 pt-3 text-ink-900">
          <div className="flex items-center justify-between border-b-2 border-ink-900 pb-3.5 pt-5">
            <span className="text-base font-bold">Add-on module</span>
            <span className="text-base font-bold">Price</span>
          </div>
          {modules.map((m) => (
            <div key={m.name} className="flex items-center justify-between gap-5 border-b border-ink-900/10 py-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[17px] font-semibold">{m.name}</span>
                <span className="text-sm leading-5 text-ink-500">{m.text}</span>
              </div>
              <span className="inline-flex h-8 flex-none items-center rounded-[10px] border-[1.5px] border-dashed border-ink-500 px-3 text-sm font-semibold text-ink-700">
                {m.price}
              </span>
            </div>
          ))}
          <p className="pt-[18px] text-sm leading-[22px] text-ink-700">
            If a paid module ends, your history stays available. Nothing you recorded disappears.
          </p>
        </div>
      </div>
    </Surface>
  )
}

export function Doubts() {
  return (
    <div className={cn(section, 'flex flex-col gap-14')}>
      <h2 className={cn(h2, 'max-w-[820px] text-white')}>Built for the moments when something goes wrong.</h2>
      <div className="flex gap-6">
        {doubts.map((d) => (
          <Glass key={d.q} className="flex min-w-0 flex-1 flex-col gap-3.5 rounded-panel p-8">
            <h3 className="font-display text-[26px] font-bold leading-8 text-gold-300">{d.q}</h3>
            <p className="text-[17px] leading-[27px] text-ink-100">{d.a}</p>
          </Glass>
        ))}
      </div>
      <figure className="flex flex-col gap-2 rounded-panel border-2 border-dashed border-gold-500/55 px-10 py-8">
        <blockquote className="font-display text-[28px] font-semibold leading-9 text-ink-300">
          {quotePlaceholder.quote}
        </blockquote>
        <figcaption className="text-[15px] text-ink-300">{quotePlaceholder.attribution}</figcaption>
      </figure>
    </div>
  )
}

export function Steps() {
  return (
    <div id="start" className={cn(section, 'flex flex-col gap-14')}>
      <div className="flex max-w-[820px] flex-col gap-4">
        <h2 className={cn(h2, 'text-white')}>From sign-up to your first sale.</h2>
        <p className="text-lg leading-7 text-ink-300">
          Skip anything that is not critical. It becomes a checklist you finish after you go live, and setup picks up
          where you left off.
        </p>
      </div>
      <ol className="flex gap-5">
        {steps.map((s, i) => (
          <Glass as="article" key={s.title} className="flex min-w-0 flex-1 flex-col gap-3.5 rounded-panel p-6">
            <Glass
              variant="gold"
              className="flex size-[52px] items-center justify-center rounded-full font-display text-2xl font-bold text-gold-100"
            >
              {i + 1}
            </Glass>
            <span className="text-[19px] font-bold leading-[26px] text-white">{s.title}</span>
            <span className="text-[15px] leading-[23px] text-ink-200">{s.text}</span>
          </Glass>
        ))}
      </ol>
    </div>
  )
}

export function FinalCta() {
  return (
    <div className="px-20 pb-24 pt-10">
      <Glass variant="gold" className="flex items-center justify-between gap-12 rounded-[32px] p-16">
        <div className="flex max-w-[760px] flex-col gap-3.5">
          <h2 className="font-display text-[52px] font-bold leading-[56px] tracking-tight text-white text-balance">
            Ready to sell? Set up your business and ring a test sale today.
          </h2>
          <p className="text-lg leading-7 text-ink-100">The free core plan is enough to start.</p>
        </div>
        <a
          href={APP_URL}
          className={buttonClasses({
            variant: 'primary',
            className: 'min-h-16 flex-none rounded-[18px] px-10 text-xl',
          })}
        >
          Start free
        </a>
      </Glass>
    </div>
  )
}

export function Footer() {
  return (
    <footer className="flex items-start justify-between gap-12 border-t border-white/[0.08] bg-black/50 px-20 py-14">
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <span className="font-display text-[19px] font-bold text-white">HUSTLERO (HCS)</span>
        </div>
        <p className="max-w-[420px] text-[15px] leading-[22px] text-ink-300">
          One business. One inventory. One sales truth. One command center. Many channels. Many branches.
        </p>
      </div>
      <div className="flex gap-16 text-[15px] text-ink-200">
        <div className="flex flex-col gap-3">
          <span className="font-bold text-white">Apps</span>
          <a href={APP_URL}>Back Office</a>
          <a href={POS_URL}>POS</a>
        </div>
        <div className="flex flex-col gap-3">
          <span className="font-bold text-white">Learn more</span>
          <a href="#product">Product</a>
          <a href="#modules">Free core and modules</a>
        </div>
      </div>
    </footer>
  )
}
