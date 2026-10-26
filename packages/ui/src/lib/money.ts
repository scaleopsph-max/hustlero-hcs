/**
 * Money rule (spec section 8): never use floating point for financial values.
 * The UI works in integer centavos. Formatting preserves every cent without float division.
 * The API should send NUMERIC/DECIMAL as strings or integer centavos. Never JS floats.
 */
export type Centavos = number

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

/** 198632 -> "₱1,986.32". Negative values use a true minus sign: "−₱45.00". */
export function formatPeso(centavos: Centavos): string {
  const sign = centavos < 0 ? '−' : ''
  // Preserve legacy preview/non-money input behavior; command validation belongs upstream.
  if (!Number.isSafeInteger(centavos)) return sign + peso.format(Math.abs(centavos) / 100)
  const minor = BigInt(centavos)
  const magnitude = minor < 0n ? -minor : minor
  const fraction = String(magnitude % 100n).padStart(2, '0')
  return (
    sign +
    peso
      .formatToParts(magnitude / 100n)
      .map((part) => (part.type === 'fraction' ? fraction : part.value))
      .join('')
  )
}

/** "+₱18,240.00" or "−₱310.00". For ledger and reconciliation rows. */
export function formatPesoSigned(centavos: Centavos): string {
  return (centavos > 0 ? '+' : '') + formatPeso(centavos)
}

/** "₱2,000.50" or "2000.5" -> 200050. Parses text without ever creating a float. */
export function parsePeso(input: string): Centavos {
  const cleaned = input.replace(/[^0-9.]/g, '')
  const [whole = '0', frac = ''] = cleaned.split('.')
  return parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10)
}
