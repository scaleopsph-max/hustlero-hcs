'use client'

import type { ResellerPaymentAccount, ResellerPaymentAccountSaveRequest } from '@hcs/contracts'
import { Button, Chip, Glass, preparePhoto } from '@hcs/ui'
import { Eye, EyeOff, ImagePlus, Plus, QrCode, Save } from 'lucide-react'
import { useRef, useState } from 'react'

import { accountRequest, type PaymentAccountDraft as Draft } from '@/lib/reseller-portal-admin'

import { fileUrl } from './ProductPhotos'

const control =
  'min-h-10 w-full min-w-0 rounded-control border border-ink-900/15 bg-white px-3 text-sm outline-none focus:border-ink-900'
const MAX_SHOWN = 6

/**
 * GCash and bank accounts resellers pay into, each with an optional QR code. Resellers pick GCash
 * or Bank in the portal and see the matching QR and details.
 */
export function PaymentAccountsCard({
  accounts,
  busy,
  onSave,
  onUploadQr,
}: {
  accounts: ResellerPaymentAccount[]
  busy: boolean
  onSave: (body: ResellerPaymentAccountSaveRequest, target: string) => Promise<boolean>
  onUploadQr: (accountId: string, body: FormData) => Promise<void>
}) {
  const [adding, setAdding] = useState(accounts.length === 0)
  const shown = accounts.filter((account) => account.isActive).length
  return (
    <Glass variant="light" className="flex flex-col gap-4 rounded-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h4">Payment accounts</h2>
          <p className="text-sm text-ink-500">
            Resellers choose GCash or Bank and see these QR codes and details when they pay. Up to {MAX_SHOWN} can be
            shown.
          </p>
        </div>
        {!adding ? (
          <Button size="sm" disabled={busy || shown >= MAX_SHOWN} onClick={() => setAdding(true)}>
            <Plus size={16} className="mr-2" />
            Add account
          </Button>
        ) : null}
      </div>
      {accounts.map((account) => (
        <AccountRow key={account.id} account={account} busy={busy} onSave={onSave} onUploadQr={onUploadQr} />
      ))}
      {adding ? (
        <AccountForm
          busy={busy}
          initial={{ method: 'gcash', providerName: 'GCash', accountName: '', accountNumber: '' }}
          submitLabel="Add account"
          onCancel={accounts.length ? () => setAdding(false) : undefined}
          onSubmit={async (body) => {
            if (await onSave(body, 'payment-account:new')) setAdding(false)
          }}
        />
      ) : null}
    </Glass>
  )
}

function AccountRow({
  account,
  busy,
  onSave,
  onUploadQr,
}: {
  account: ResellerPaymentAccount
  busy: boolean
  onSave: (body: ResellerPaymentAccountSaveRequest, target: string) => Promise<boolean>
  onUploadQr: (accountId: string, body: FormData) => Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const draft: Draft = {
    method: account.method,
    providerName: account.providerName,
    accountName: account.accountName,
    accountNumber: account.accountNumber,
  }
  async function upload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setProblem(null)
    try {
      const prepared = await preparePhoto(file)
      const body = new FormData()
      body.append('image', prepared.image, prepared.filename)
      await onUploadQr(account.id, body)
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'The QR code was not uploaded.')
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div
      className={`flex flex-col gap-4 rounded-control border border-ink-900/10 p-4 md:flex-row ${account.isActive ? '' : 'opacity-60'}`}
    >
      <div className="flex flex-none flex-col items-center gap-2">
        {account.qrUrl ? (
          <a href={fileUrl(account.qrUrl)} target="_blank" rel="noreferrer" aria-label="Open QR code">
            <img
              src={fileUrl(account.qrUrl)}
              alt={`${account.providerName} QR code`}
              className="size-32 rounded-control bg-white object-contain p-1 ring-1 ring-ink-900/10"
            />
          </a>
        ) : (
          <span className="flex size-32 flex-col items-center justify-center gap-1 rounded-control border border-dashed border-ink-900/20 text-xs text-ink-500">
            <QrCode size={22} />
            No QR yet
          </span>
        )}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          className="sr-only"
          id={`qr-${account.id}`}
          onChange={(event) => void upload(event.target.files?.[0])}
        />
        <Button size="sm" disabled={busy || uploading} onClick={() => input.current?.click()}>
          <ImagePlus size={16} className="mr-2" />
          {uploading ? 'Uploading…' : account.qrUrl ? 'Replace QR' : 'Upload QR'}
        </Button>
        {problem ? <p className="max-w-40 text-center text-xs text-signal-light-critical-fg">{problem}</p> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Chip surface="light" tone={account.isActive ? 'success' : 'neutral'}>
            {account.isActive ? 'Shown to resellers' : 'Hidden'}
          </Chip>
        </div>
        <AccountForm
          busy={busy}
          initial={draft}
          submitLabel="Save"
          onSubmit={(body) =>
            onSave({ ...body, id: account.id, isActive: account.isActive }, `payment-account:${account.id}`)
          }
          extra={
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void onSave(
                  { ...draft, id: account.id, isActive: !account.isActive },
                  `payment-account:${account.id}:visibility`,
                )
              }
            >
              {account.isActive ? <EyeOff size={16} className="mr-2" /> : <Eye size={16} className="mr-2" />}
              {account.isActive ? 'Hide' : 'Show'}
            </Button>
          }
        />
      </div>
    </div>
  )
}

function AccountForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  extra,
}: {
  initial: Draft
  busy: boolean
  submitLabel: string
  onSubmit: (body: ResellerPaymentAccountSaveRequest) => Promise<unknown>
  onCancel?: (() => void) | undefined
  extra?: React.ReactNode
}) {
  const [draft, setDraft] = useState(initial)
  const [problem, setProblem] = useState<string | null>(null)
  const set = (key: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }))
  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault()
        const request = accountRequest(draft)
        if (typeof request === 'string') return setProblem(request)
        setProblem(null)
        void onSubmit(request)
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Type
        <select
          className={control}
          value={draft.method}
          onChange={(event) => {
            const method = event.target.value as Draft['method']
            setDraft((current) => ({
              ...current,
              method,
              providerName:
                method === 'gcash' && !current.providerName
                  ? 'GCash'
                  : method === 'bank_transfer' && current.providerName === 'GCash'
                    ? ''
                    : current.providerName,
            }))
          }}
        >
          <option value="gcash">GCash</option>
          <option value="bank_transfer">Bank transfer</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {draft.method === 'gcash' ? 'Wallet' : 'Bank name'}
        <input
          className={control}
          maxLength={80}
          value={draft.providerName}
          onChange={set('providerName')}
          placeholder={draft.method === 'gcash' ? 'GCash' : 'BDO Savings'}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Account name
        <input
          className={control}
          maxLength={120}
          value={draft.accountName}
          onChange={set('accountName')}
          placeholder="Juan Dela Cruz"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {draft.method === 'gcash' ? 'GCash number' : 'Account number'}
        <input
          className={control}
          maxLength={40}
          inputMode="numeric"
          value={draft.accountNumber}
          onChange={set('accountNumber')}
          placeholder={draft.method === 'gcash' ? '0917 123 4567' : '0012 3456 7890'}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <Button type="submit" variant="confirm" size="sm" disabled={busy}>
          {submitLabel === 'Save' ? <Save size={16} className="mr-2" /> : <Plus size={16} className="mr-2" />}
          {submitLabel}
        </Button>
        {extra}
        {onCancel ? (
          <Button size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {problem ? <p className="text-sm text-signal-light-critical-fg">{problem}</p> : null}
      </div>
    </form>
  )
}
