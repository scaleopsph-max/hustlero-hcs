'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, Play, Pause, RotateCcw, RefreshCw } from 'lucide-react'
import {
  catalogImportReviewSchema,
  type CatalogImportJob,
  type CatalogImportExecution,
  type CatalogImportReview,
} from '@hcs/contracts'
import {
  pendingImportExecutionSchema,
  restoreImportExecution,
  reconcileImportExecution,
  type PendingImportExecution,
} from '@/lib/catalog-import-execution'
type Props = {
  job: CatalogImportJob
  user: string
  tenant: string
  call: (path: string, body?: unknown, key?: string) => Promise<unknown>
  onChecked: (hasExecution: boolean) => void
}
export function CatalogImportExecutionPanel({ job, user, tenant, call, onChecked }: Props) {
  const [execution, setExecution] = useState<CatalogImportExecution | null>(null),
    [review, setReview] = useState<CatalogImportReview | null>(null)
  const [pending, setPending] = useState<PendingImportExecution | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null),
    [rejected, setRejected] = useState(false)
  const lock = useRef(false),
    sequence = useRef(0),
    paused = useRef(false)
  const storage = `hcs-import-run:${user}:${tenant}:${job.id}`
  function persist(command: PendingImportExecution) {
    const parsed = pendingImportExecutionSchema.parse(command)
    sessionStorage.setItem(storage, JSON.stringify(parsed))
    setPending(parsed)
    return parsed
  }
  function clear(command: PendingImportExecution) {
    if (JSON.stringify(restoreImportExecution(sessionStorage.getItem(storage))) !== JSON.stringify(command))
      throw new Error('Pending import command changed. Keep the original request.')
    sessionStorage.removeItem(storage)
    setPending(null)
  }
  async function load() {
    const result = reconcileImportExecution(job, await call(`/${job.id}/execution`))
    return result
  }
  async function run(action: 'load' | 'review' | 'start' | 'process' | 'retry') {
    if (lock.current) return
    lock.current = true
    paused.current = false
    const request = ++sequence.current
    setBusy(true)
    setError(null)
    setRejected(false)
    try {
      if (action === 'load') {
        const restored = restoreImportExecution(sessionStorage.getItem(storage))
        setPending(restored)
        const current = await load()
        if (request === sequence.current) {
          setExecution(current)
          onChecked(current !== null)
        }
      } else if (action === 'review') {
        const result = catalogImportReviewSchema.parse(await call(`/${job.id}/review`))
        if (result.jobId !== job.id) throw new Error('Review does not match the selected job.')
        if (request === sequence.current) setReview(result)
      } else {
        let command = pending,
          current = execution
        if (action === 'retry' && !command) throw new Error('No pending import command to retry.')
        if (action === 'start') {
          if (!review || command) throw new Error('Review the saved preview first.')
          command = persist({ kind: 'start', key: crypto.randomUUID(), reviewHash: review.hash })
        }
        if (command?.kind === 'start') {
          const reply = reconcileImportExecution(
            job,
            await call(`/${job.id}/execution`, { action: 'start', reviewHash: command.reviewHash }, command.key),
          )
          current = await load()
          if (
            !reply ||
            !current ||
            reply.id !== current.id ||
            current.requestKey !== command.key ||
            current.reviewHash !== command.reviewHash ||
            current.confirmedBy !== user
          )
            throw new Error('Import confirmation could not be reconciled. Retry the original command.')
          if (request !== sequence.current) return
          clear(command)
          setExecution(current)
          setReview(null)
          onChecked(true)
        } else {
          if (!current) current = await load()
          if (!current) throw new Error('Confirm the import before processing groups.')
          for (let step = 0; step < 25; step++) {
            if (!current || (current.state !== 'running' && !command) || paused.current) break
            const attempt = command ?? persist({ kind: 'step', executionId: current.id, groupIndex: current.nextGroup })
            if (attempt.kind !== 'step' || attempt.executionId !== current.id)
              throw new Error('Pending group belongs to another execution.')
            const reply = reconcileImportExecution(
              job,
              await call(`/${job.id}/execution`, { action: 'step', groupIndex: attempt.groupIndex }),
            )
            const next = await load()
            if (
              !reply ||
              !next ||
              reply.id !== current.id ||
              next.id !== current.id ||
              next.nextGroup <= attempt.groupIndex ||
              !next.results.some((row) => row.groupIndex === attempt.groupIndex)
            )
              throw new Error('Import group could not be reconciled. Retry the original group.')
            if (request !== sequence.current) return
            clear(attempt)
            setExecution(next)
            onChecked(true)
            current = next
            command = null
            if (
              action === 'retry' ||
              next.results.some((row) => row.groupIndex === attempt.groupIndex && row.outcome === 'failed')
            )
              break
          }
        }
      }
    } catch (cause) {
      if (request === sequence.current) {
        setError(cause instanceof Error ? cause.message : 'Could not process import.')
        const code = (cause as { code?: string })?.code
        if (code === 'CATALOG_CHANGED' || code === 'IMPORT_STATE_CONFLICT') {
          try {
            const stored = restoreImportExecution(sessionStorage.getItem(storage)),
              current = await load()
            if (request !== sequence.current) return
            if (stored?.kind === 'start' && !current) setRejected(true)
            else if (
              stored?.kind === 'start' &&
              current &&
              current.requestKey === stored.key &&
              current.reviewHash === stored.reviewHash &&
              current.confirmedBy === user
            ) {
              clear(stored)
              setExecution(current)
              setReview(null)
              onChecked(true)
              setError(null)
            }
          } catch {
            /* Keep the original command if independent recovery is unavailable. */
          }
        }
      }
    } finally {
      if (request === sequence.current) {
        lock.current = false
        setBusy(false)
      }
    }
  }
  useEffect(() => {
    void run('load')
    return () => {
      sequence.current++
      lock.current = false
      paused.current = true
    }
  }, [])
  function discard() {
    try {
      if (pending?.kind !== 'start' || !rejected) return
      clear(pending)
      setReview(null)
      setError(null)
      setRejected(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reconcile pending request.')
    }
  }
  return (
    <section className="my-4 border-y border-ink-900/15 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Import execution</h3>
        <button
          type="button"
          title="Refresh import execution"
          aria-label="Refresh import execution"
          onClick={() => void run('load')}
          disabled={busy}
          className="inline-flex h-10 w-10 items-center justify-center rounded border border-ink-900/20"
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {error && (
        <p role="alert" className="my-3 border-l-2 border-red-500 bg-red-50 p-3">
          {error}
        </p>
      )}
      {execution && (
        <div className="my-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ['State', execution.state],
            ['Groups', `${execution.nextGroup} / ${execution.groupCount}`],
            ['Created', execution.results.filter((row) => row.outcome === 'created').length],
            ['Updated', execution.results.filter((row) => row.outcome === 'updated').length],
            ['Failed', execution.results.filter((row) => row.outcome === 'failed').length],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-ink-500">{label}</div>
              <strong className="break-words">{value}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="my-3 flex flex-wrap gap-3">
        {!execution && !pending && job.state === 'preview' && (
          <button
            type="button"
            disabled={busy || job.rejectedCount > 0}
            onClick={() => void run('review')}
            className="inline-flex min-h-10 items-center gap-2 rounded border border-ink-900/20 px-3 disabled:opacity-50"
          >
            <Check size={17} />
            Review import
          </button>
        )}
        {review && !pending && !execution && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('start')}
            className="inline-flex min-h-10 items-center gap-2 rounded bg-ink-900 px-3 text-white"
          >
            <Check size={17} />
            Confirm import · {review.groupCount} groups
          </button>
        )}
        {pending && (
          <button
            type="button"
            disabled={busy || rejected}
            onClick={() => void run('retry')}
            className="inline-flex min-h-10 items-center gap-2 rounded border border-ink-900/20 px-3 disabled:opacity-50"
          >
            <RotateCcw size={17} />
            {pending.kind === 'start' ? 'Retry confirmation' : 'Retry group'}
          </button>
        )}
        {pending?.kind === 'start' && rejected && (
          <button type="button" onClick={discard} className="min-h-10 rounded border border-ink-900/20 px-3">
            Discard rejected confirmation
          </button>
        )}
        {execution?.state === 'running' && !pending && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('process')}
            className="inline-flex min-h-10 items-center gap-2 rounded bg-ink-900 px-3 text-white"
          >
            <Play size={17} />
            Continue import
          </button>
        )}
        {busy && execution?.state === 'running' && (
          <button
            type="button"
            onClick={() => {
              paused.current = true
            }}
            className="inline-flex min-h-10 items-center gap-2 rounded border border-ink-900/20 px-3"
          >
            <Pause size={17} />
            Pause
          </button>
        )}
      </div>
      {execution && execution.results.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {['Row', 'Result', 'Product ID', 'Variant ID', 'Error'].map((label) => (
                  <th key={label} className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {execution.results.map((row) => (
                <tr key={row.rowNumber} className="border-t border-ink-900/10">
                  <td className="p-3">{row.rowNumber}</td>
                  <td className="p-3">{row.outcome}</td>
                  <td className="p-3 font-mono text-xs">{row.productId ?? '-'}</td>
                  <td className="p-3 font-mono text-xs">{row.variantId ?? '-'}</td>
                  <td className="p-3">{row.errorCode ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
