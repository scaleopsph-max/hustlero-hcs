export function nextWholesaleOrderNumber(orderNumbers: string[], date = new Date()) {
  const dateToken = date.toISOString().slice(0, 10).replaceAll('-', '')
  const prefix = `SO-${dateToken}-`
  const highestOrdinal = orderNumbers.reduce((highest, orderNumber) => {
    if (!orderNumber.startsWith(prefix)) return highest
    const ordinal = Number(orderNumber.slice(prefix.length))
    return Number.isSafeInteger(ordinal) && ordinal > highest ? ordinal : highest
  }, 0)

  return `${prefix}${String(highestOrdinal + 1).padStart(3, '0')}`
}
