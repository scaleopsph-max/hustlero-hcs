'use client'

import type { ResellerOrder } from '@hcs/contracts'
import { Button, Chip, formatPeso, parsePeso, preparePhoto, useToast, type ChipTone } from '@hcs/ui'
import { FileText, Upload } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'

import { formatDateTime, paymentLabel } from '@/lib/labels'
import { fileUrl, newIdempotencyKey } from '@/lib/portal-api'

const PDF_MAX_BYTES = 5 * 1024 * 1024
const proofStatus: Record<'pending' | 'accepted' | 'rejected', { text: string; tone: ChipTone }> = {
  pending: { text: 'Checking', tone: 'attention' },
  accepted: { text: 'Verified', tone: 'success' },
  rejected: { text: 'Not accepted', tone: 'critical' },
}

/** Lists an order's payment proofs and lets the reseller send a GCash or bank screenshot or PDF. */
export function PaymentProofs({
  order,
  onUpload,
  startOpen = false,
}: {
  order: ResellerOrder
  /** Opens the upload form right away, e.g. for an order waiting for payment. */
  startOpen?: boolean
  onUpload: (orderId: string, body: FormData, idempotencyKey: string) => Promise<void>
}) {
  const proofs = order.paymentProofs ?? []
  const verifiedMinor = proofs
    .filter((proof) => proof.status === 'accepted')
    .reduce((sum, proof) => sum + proof.amountMinor, 0)
  // Returns lower what is owed on the order.
  const dueMinor = Math.max(
    0,
    order.totalMinor - (order.returns ?? []).reduce((sum, entry) => sum + entry.amountMinor, 0),
  )
  const remainingMinor = Math.max(0, dueMinor - verifiedMinor)
  const [open, setOpen] = useState(startOpen)
  const [amount, setAmount] = useState((remainingMinor / 100).toFixed(2))
  const [reference, setReference] = useState('')
  const [method, setMethod] = useState<'gcash' | 'bank_transfer'>(order.paymentPreference ?? 'gcash')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempt = useRef<{ key: string; fingerprint: string } | null>(null)
  const toast = useToast()
  const pendingMinor = proofs
    .filter((proof) => proof.status === 'pending')
    .reduce((sum, proof) => sum + proof.amountMinor, 0)
  // Once verified payments cover the order, the proof form closes.
  const paidInFull = verifiedMinor >= dueMinor
  const accepting = order.status !== 'cancelled' && !paidInFull && verifiedMinor + pendingMinor < dueMinor

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) return setError('Choose a screenshot or PDF of your payment.')
    const amountMinor = parsePeso(amount)
    if (!/^\d[\d,]*(\.\d{0,2})?$/.test(amount.trim()) || amountMinor < 1)
      return setError('Enter the amount you paid, e.g. 3510.00.')
    if (reference.trim().length < 4) return setError('Enter the reference number from GCash or your bank.')
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    if (isPdf && file.size > PDF_MAX_BYTES) return setError('The PDF is too large. The limit is 5 MB.')
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      if (isPdf) body.append('file', file, file.name)
      else {
        const prepared = await preparePhoto(file)
        body.append('file', prepared.image, prepared.filename)
        body.append('thumb', prepared.thumb, `thumb-${prepared.filename}`)
      }
      body.append('method', method)
      body.append('amountMinor', String(amountMinor))
      body.append('reference', reference.trim())
      const fingerprint = `${file.name}:${file.size}:${file.lastModified}:${amountMinor}:${reference.trim()}:${method}`
      if (attempt.current?.fingerprint !== fingerprint)
        attempt.current = { key: newIdempotencyKey('proof'), fingerprint }
      await onUpload(order.id, body, attempt.current.key)
      attempt.current = null
      toast.success('Payment proof sent. The team will check it and confirm your order.')
      setOpen(false)
      setFile(null)
      setReference('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The proof was not sent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-control border border-white/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-small font-semibold">Proof of payment</p>
        {verifiedMinor > 0 ? (
          <span className="text-caption text-signal-dark-success-fg">
            Verified: {formatPeso(verifiedMinor)}
            {remainingMinor > 0 ? (
              <span className="text-signal-dark-warning-fg"> · Balance {formatPeso(remainingMinor)}</span>
            ) : (
              ' · Paid in full'
            )}
          </span>
        ) : null}
      </div>
      {proofs.length ? (
        <ul className="flex flex-col gap-2">
          {proofs.map((proof) => (
            <li key={proof.id} className="flex items-center gap-3">
              <a
                href={fileUrl(proof.url)}
                target="_blank"
                rel="noreferrer"
                className="flex-none"
                aria-label={`View proof ${proof.reference}`}
              >
                {proof.thumbUrl ? (
                  <img src={fileUrl(proof.thumbUrl)} alt="" className="size-11 rounded-[10px] object-cover" />
                ) : (
                  <span className="flex size-11 items-center justify-center rounded-[10px] bg-white/10">
                    <FileText size={18} />
                  </span>
                )}
              </a>
              <div className="min-w-0 flex-1 text-small">
                <p className="font-semibold">
                  {formatPeso(proof.amountMinor)} · {paymentLabel[proof.method]}
                </p>
                <p className="truncate text-ink-400">
                  Ref {proof.reference} · {formatDateTime(proof.createdAt)}
                </p>
                {proof.status === 'rejected' && proof.reviewReason ? (
                  <p className="text-signal-dark-critical-fg">{proof.reviewReason}</p>
                ) : null}
              </div>
              <Chip tone={proofStatus[proof.status].tone} className="flex-none">
                {proofStatus[proof.status].text}
              </Chip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-ink-400">No payment proof sent for this order yet.</p>
      )}

      {accepting && !open ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Upload size={16} className="mr-2" />
          Upload payment proof
        </Button>
      ) : null}
      {open ? (
        <form className="flex flex-col gap-3 pt-1" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-2">
            {(['gcash', 'bank_transfer'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={method === option}
                onClick={() => setMethod(option)}
                className={
                  method === option
                    ? 'min-h-touch rounded-control border border-gold-500 bg-gold-500/15 text-small font-semibold text-gold-200'
                    : 'min-h-touch rounded-control border border-white/20 bg-white/5 text-small font-semibold'
                }
              >
                {paymentLabel[option]}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5 text-small font-semibold" htmlFor={`proof-amount-${order.id}`}>
            Amount paid (₱)
            <input
              id={`proof-amount-${order.id}`}
              className="field"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-small font-semibold" htmlFor={`proof-ref-${order.id}`}>
            Reference number
            <input
              id={`proof-ref-${order.id}`}
              className="field"
              maxLength={64}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="e.g. 1029 384 556 7"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-small font-semibold" htmlFor={`proof-file-${order.id}`}>
            Screenshot or PDF
            <input
              id={`proof-file-${order.id}`}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              className="text-small file:mr-3 file:rounded-control file:border-0 file:bg-white/15 file:px-3 file:py-2 file:font-semibold file:text-ink-50"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {error ? <p className="text-small text-signal-dark-critical-fg">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy} className="flex-1">
              {busy ? 'Uploading…' : 'Send proof'}
            </Button>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
