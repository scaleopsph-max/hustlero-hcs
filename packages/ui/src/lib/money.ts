/**
 * Money rule (spec section 8): never use floating point for financial values.
 * The UI works in integer centavos. Only the last step, formatting, divides by 100.
 * The API should send NUMERIC/DECIMAL as strings or integer centavos. Never JS floats.
 */
export type Centavos = number

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

/** 198632 -> "₱1,986.32". Negative values use a true minus sign: "−₱45.00". */
export function formatPeso(centavos: Centavos): string {
  const sign = centavos < 0 ? '−' : ''
  return sign + peso.format(Math.abs(centavos) / 100)
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
