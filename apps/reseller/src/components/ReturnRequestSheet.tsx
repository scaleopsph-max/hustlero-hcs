'use client'

import type { ResellerOrder } from '@hcs/contracts'
import { Button } from '@hcs/ui'
import { Camera, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { formatQuantity } from '@/lib/cart'

import { QuantityStepper } from './QuantityStepper'

type Invoice = ResellerOrder['invoices'][number]

/** Ask to return items from one invoice, with a reason and up to four photos. */
export function ReturnRequestSheet({
  invoice,
  onSubmit,
  onClose,
}: {
  invoice: Invoice
  onSubmit: (
    request: { invoiceId: string; reason: string; lines: { invoiceLineId: string; quantityMilli: number }[] },
    photos: File[],
  ) => Promise<void>
  onClose: () => void
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const previews = useMemo(() => photos.map((file) => URL.createObjectURL(file)), [photos])
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const lines = (invoice.lines ?? []).filter((line) => line.returnableMilli >= 1000)
  const chosen = lines
    .map((line) => ({ invoiceLineId: line.invoiceLineId, quantityMilli: quantities[line.invoiceLineId] ?? 0 }))
    .filter((line) => line.quantityMilli > 0)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (chosen.length === 0) return setError('Choose at least one item to return.')
    if (reason.trim().length < 5) return setError('Tell us what is wrong in a few words.')
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ invoiceId: invoice.id, reason: reason.trim(), lines: chosen }, photos)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request was not sent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-md"
        onClick={onClose}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-title"
        onSubmit={submit}
        className="glass-strong relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-sheet border-x border-t border-white/15 bg-ink-900/90 motion-safe:animate-[sheet-up_220ms_ease-out] sm:rounded-sheet sm:border-b"
      >
        <header className="flex flex-none items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            <h2 id="return-title" className="text-h4 font-semibold">
              Request a return
            </h2>
            <p className="text-small text-ink-300">{invoice.invoiceNumber}</p>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close return request"
            className="flex size-11 flex-none items-center justify-center rounded-full border border-white/15 bg-white/10"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto border-t border-white/10 px-5 py-4">
          <ul className="flex flex-col gap-3">
            {lines.map((line) => (
              <li key={line.invoiceLineId} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold leading-tight">{line.productName}</p>
                  <p className="text-caption text-ink-400">
                    {line.variantName} · up to {formatQuantity(line.returnableMilli)}
                  </p>
                </div>
                <QuantityStepper
                  label={`${line.productName} ${line.variantName}`}
                  quantityMilli={quantities[line.invoiceLineId] ?? 0}
                  onChange={(next) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.invoiceLineId]: Math.min(next, Math.floor(line.returnableMilli / 1000) * 1000),
                    }))
                  }
                />
              </li>
            ))}
          </ul>
          <label className="flex flex-col gap-2">
            <span className="text-small font-semibold">What is wrong?</span>
            <textarea
              className="field h-auto min-h-20 py-3"
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. 2 pouches arrived torn"
            />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-small font-semibold">Photos (up to 4)</span>
            <div className="flex flex-wrap gap-2">
              {previews.map((url, index) => (
                <div key={url} className="relative">
                  <img src={url} alt={`Photo ${index + 1}`} className="size-20 rounded-[12px] object-cover" />
                  <button
                    type="button"
                    aria-label={`Remove photo ${index + 1}`}
                    onClick={() => setPhotos((current) => current.filter((_, at) => at !== index))}
                    className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full bg-ink-950 text-white"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {photos.length < 4 ? (
                <label className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-white/30 text-caption text-ink-300">
                  <Camera size={20} />
                  Add
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    aria-label="Add photos"
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? [])
                      setPhotos((current) => [...current, ...files].slice(0, 4))
                      event.target.value = ''
                    }}
                  />
                </label>
              ) : null}
            </div>
          </div>
          {error ? <p className="text-small text-signal-dark-critical-fg">{error}</p> : null}
        </div>
        <footer className="flex flex-none border-t border-white/10 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-4 sm:pb-4">
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Sending…' : 'Send request'}
          </Button>
        </footer>
      </form>
    </div>
  )
}
