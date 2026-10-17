function fixedInput(input: string, scale: number): number | null {
  const value = input.trim()
  if (!new RegExp(`^[0-9]+(?:\\.[0-9]{1,${scale}})?$`).test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const result = BigInt(whole!) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0'))
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null
}

export function pricingAmountMinor(input: string): number | null {
  return fixedInput(input, 2)
}

export function pricingThresholdMilli(input: string): number | null {
  const value = fixedInput(input, 3)
  return value !== null && value > 0 ? value : null
}
