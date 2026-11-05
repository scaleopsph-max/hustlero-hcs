'use client'

import type { ReturnRequest } from '@hcs/contracts'
import { Button, Chip, Glass } from '@hcs/ui'
import { Check, Undo2, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { fileUrl } from './ProductPhotos'

const when = (value: string) =>
  new Date(value).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

/** Opens the Returns form for the invoice with the requested items and reason filled in. */
export function returnFormHref(request: ReturnRequest): string {
  const params = new URLSearchParams({
    invoice: request.invoiceId,
    lines: request.lines.map((line) => `${line.invoiceLineId}:${line.quantityMilli}`).join(','),
    reason: request.reason.slice(0, 200),
  })
  return `/wholesale/returns?${params.toString()}`
}

/** Return requests resellers sent from the portal, with their photos. */
export function ReturnRequestsPanel({
  requests,
  busy,
  onApprove,
  onDecline,
}: {
  requests: ReturnRequest[] | null
  busy: string | null
  onApprove: (request: ReturnRequest) => Promise<boolean>
  onDecline: (request: ReturnRequest, reason: string) => Promise<boolean>
}) {
  if (requests === null)
    return (
      <Glass variant="data" className="rounded-panel px-5 py-8 text-center text-sm text-ink-500">
        Return requests need file storage to show photos. Check the API settings.
      </Glass>
    )
  if (requests.length === 0)
    return (
      <Glass variant="data" className="rounded-panel px-5 py-8 text-center text-sm text-ink-500">
        No return requests in the last 30 days.
      </Glass>
    )
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {requests.map((request) => (
        <RequestCard
          key={request.requestId}
          request={request}
          busy={busy === `return:${request.requestId}`}
          anyBusy={busy !== null}
          onApprove={() => onApprove(request)}
          onDecline={(reason) => onDecline(request, reason)}
        />
      ))}
    </div>
  )
}

function RequestCard({
  request,
  busy,
  anyBusy,
  onApprove,
  onDecline,
}: {
  request: ReturnRequest
  busy: boolean
  anyBusy: boolean
  onApprove: () => Promise<boolean>
  onDecline: (reason: string) => Promise<boolean>
}) {
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <Glass variant="data" className="flex flex-col gap-3 rounded-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {request.customerName} · {request.invoiceNumber}
          </p>
          <p className="text-sm text-ink-500">
            {request.orderNumber ? `${request.orderNumber} · ` : ''}sent {when(request.createdAt)}
          </p>
        </div>
        <Chip
          surface="light"
          tone={request.status === 'approved' ? 'success' : request.status === 'declined' ? 'critical' : 'attention'}
        >
          {request.status === 'approved' ? 'Approved' : request.status === 'declined' ? 'Declined' : 'To review'}
        </Chip>
      </div>
      <ul className="flex flex-col gap-1 rounded-control bg-ink-900/[0.04] p-3 text-sm">
        {request.lines.map((line) => (
          <li key={line.invoiceLineId} className="flex justify-between gap-3">
            <span className="min-w-0">
              {line.productName} {line.variantName}
            </span>
            <span className="flex-none font-semibold">× {line.quantityMilli / 1000}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        <span className="font-semibold">Reason: </span>
        {request.reason}
      </p>
      {request.photos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {request.photos.map((photo, index) => (
            <a
              key={photo.url}
              href={fileUrl(photo.url)}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open photo ${index + 1}`}
            >
              <img
                src={fileUrl(photo.thumbUrl ?? photo.url)}
                alt=""
                className="size-20 rounded-[12px] border border-ink-900/10 object-cover"
              />
            </a>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-500">No photos.</p>
      )}
      {request.status === 'declined' && request.decisionReason ? (
        <p className="text-sm text-signal-light-critical-fg">Declined: {request.decisionReason}</p>
      ) : null}
      {request.status === 'approved' ? (
        <p className="flex items-center gap-2 text-sm">
          <Undo2 size={16} className="flex-none" />
          <Link className="underline underline-offset-2" href={returnFormHref(request)}>
            Record the return once the items arrive
          </Link>
        </p>
      ) : null}
      {request.status === 'pending' && !declining ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="confirm" disabled={anyBusy} onClick={() => void onApprove()}>
            <Check size={16} className="mr-2" />
            {busy ? 'Saving…' : 'Approve'}
          </Button>
          <Button disabled={anyBusy} onClick={() => setDeclining(true)}>
            <X size={16} className="mr-2" />
            Decline
          </Button>
        </div>
      ) : null}
      {request.status === 'pending' && declining ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (reason.trim().length < 2) return setProblem('Tell the reseller why.')
            setProblem(null)
            void onDecline(reason.trim())
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Why are you declining?
            <input
              className="min-h-10 rounded-control border border-ink-900/15 bg-white px-3 text-sm"
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Past the 7-day return window"
            />
          </label>
          {problem ? <p className="text-sm text-signal-light-critical-fg">{problem}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" variant="confirm" disabled={anyBusy}>
              {busy ? 'Saving…' : 'Decline request'}
            </Button>
            <Button type="button" disabled={anyBusy} onClick={() => setDeclining(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Glass>
  )
}
