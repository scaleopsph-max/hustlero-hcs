import { Plus } from 'lucide-react'
import { buttonClasses } from '@hcs/ui'
import Link from 'next/link'
import { StockExplorer } from '@/components/StockExplorer'
import { Topbar } from '@/components/Topbar'

/** Inventory (spec section 9). Stock is stored per location. Balance is a summary, the ledger is the truth. */
export default function InventoryPage() {
  return (
    <>
      <Topbar
        title="Inventory"
        subtitle="Stock is stored per location and changes only through recorded movements."
        actions={
          <Link href="/inventory/opening" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
            <Plus size={18} strokeWidth={2} className="mr-2" />
            Opening inventory
          </Link>
        }
      />
      <StockExplorer />
    </>
  )
}
