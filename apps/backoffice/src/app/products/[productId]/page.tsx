import { ProductDetail } from '@/components/ProductDetail'

export default async function ProductDetailPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params
  return <ProductDetail productId={productId} />
}
