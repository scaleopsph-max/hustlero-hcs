export function nextTransferReceiptItem<T extends { requestedQuantityMilli: number; receivedQuantityMilli: number }>(
  items: readonly T[],
): T | undefined {
  return items.find((item) => item.receivedQuantityMilli < item.requestedQuantityMilli)
}
