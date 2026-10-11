export function fundAllocationDefinitivelyRejected(code: string | undefined): boolean {
  // A receipt already allocated by another command can never be allocated again.
  // Permission and unknown failures still cannot prove the original request did not post.
  return /^WHOLESALE_FUNDS_HCFD[2345]$/.test(code ?? '')
}
