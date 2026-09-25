import { Topbar } from '@/components/Topbar'
import { SaleReceiptWorkspace } from '@/components/SaleReceiptWorkspace'

export default async function SaleReceiptPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params
  return (
    <>
      <Topbar title="Receipt" subtitle="Review the original sale and record linked reversals." />
      <SaleReceiptWorkspace saleId={saleId} />
    </>
  )
}
