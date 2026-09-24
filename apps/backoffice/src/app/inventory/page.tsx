import { Download, Plus } from 'lucide-react'
import { Button, buttonClasses } from '@hcs/ui'
import Link from 'next/link'
import { StockExplorer } from '@/components/StockExplorer'
import { Topbar } from '@/components/Topbar'

const tabs = ['Stock levels', 'Movement ledger', 'Adjustments', 'Counts']

/** Inventory (spec section 9). Stock is stored per location. Balance is a summary, the ledger is the truth. */
export default function InventoryPage() {
  return (
    <>
      <Topbar
        title="Inventory"
        subtitle="Stock is stored per location and changes only through recorded movements."
        actions={
          <>
            <Button className="border-ink-900/[0.14] bg-white/70 text-ink-900">
              <Download size={18} strokeWidth={1.75} className="mr-2" />
              Export CSV
            </Button>
            <Link href="/inventory/opening" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
              <Plus size={18} strokeWidth={2} className="mr-2" />
              Opening inventory
            </Link>
          </>
        }
      />
      <div className="flex gap-1.5" role="tablist" aria-label="Inventory views">
        {tabs.map((t, i) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={i === 0}
            className={
              i === 0
                ? 'h-10 rounded-full bg-ink-900 px-[18px] text-sm font-semibold text-white'
                : 'h-10 rounded-full px-[18px] text-sm font-semibold text-ink-700'
            }
          >
            {t}
          </button>
        ))}
      </div>
      <StockExplorer />
    </>
  )
}
