import { Glass } from '@hcs/ui'
import { salesChart } from '@/mock/dashboard'

const W = 660
const H = 250
const X0 = 40
const X1 = 640
const Y0 = 10
const Y1 = 210

/** Hourly line chart, today against yesterday. Pure SVG, no chart library. Swap for a library if interaction is needed. */
export function SalesChart() {
  const { labels, today, yesterday, yMax } = salesChart
  const n = labels.length
  const x = (i: number) => X0 + (i * (X1 - X0)) / (n - 1)
  const y = (v: number) => Y1 - (v / yMax) * (Y1 - Y0)
  const pts = (series: number[]) => series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const ticks = [0, 1, 2, 3].map((t) => (yMax * t) / 3)
  const k = (v: number) => (v === 0 ? '₱0' : `₱${Math.round(v / 100000)}k`)

  return (
    <Glass variant="light" className="flex flex-col gap-4 rounded-panel p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold leading-[22px]">Sales performance</h2>
        <div
          className="flex gap-0.5 rounded-control bg-ink-900/[0.08] p-[3px]"
          role="group"
          aria-label="Chart resolution"
        >
          {['Hourly', 'Daily', 'Weekly'].map((r, i) => (
            <button
              key={r}
              type="button"
              aria-pressed={i === 0}
              className={
                i === 0
                  ? 'h-[34px] rounded-[9px] bg-ink-900 px-3.5 text-[13px] font-semibold text-white'
                  : 'h-[34px] rounded-[9px] px-3.5 text-[13px] font-semibold text-ink-700'
              }
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-5 text-[13px] text-ink-700">
        <span className="flex items-center gap-2">
          <span className="h-[3px] w-5 rounded-sm bg-ink-900" />
          Today, net sales
        </span>
        <span className="flex items-center gap-2">
          <span className="w-5 border-t-2 border-dashed border-ink-500" />
          Yesterday
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Net sales by hour today compared with yesterday"
        className="h-auto w-full"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={X0} x2={X1} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-ink-400' : 'stroke-ink-900/10'} />
            <text x={32} y={y(t) + 4} textAnchor="end" className="fill-ink-500 text-xs">
              {k(t)}
            </text>
          </g>
        ))}
        <polygon points={`${pts(today)} ${X1},${Y1} ${X0},${Y1}`} className="fill-gold-500/30" />
        <polyline
          points={pts(yesterday)}
          fill="none"
          strokeWidth={2}
          strokeDasharray="6 5"
          strokeLinejoin="round"
          className="stroke-ink-500"
        />
        <polyline
          points={pts(today)}
          fill="none"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-ink-900"
        />
        {labels.map((l, i) =>
          i % 2 === 0 ? (
            <text key={l} x={x(i)} y={236} textAnchor="middle" className="fill-ink-500 text-xs">
              {l}
            </text>
          ) : null,
        )}
      </svg>
    </Glass>
  )
}
