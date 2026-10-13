/* global console, fetch, AbortSignal */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { URLSearchParams } from 'node:url'
import process from 'node:process'
import { createApiRequest, runIsolationSuite, runnerSecurityHeaders, staging } from './staging-isolation-uat.mjs'
import { createFundRequest, fundPlan, runFundRecoverySuite } from './staging-fund-recovery-uat.mjs'
import { createPaidReplayRequest, runPaidReplaySuite } from './staging-paid-replay-uat.mjs'
import { createRollbackRequest, runPaidRollbackSuite } from './staging-paid-rollback-uat.mjs'
import { createApprovalRequest, runApprovalConsumptionSuite } from './staging-approval-consumption-uat.mjs'

const key = process.env.HCS_STAGING_PUBLISHABLE_KEY
delete process.env.HCS_STAGING_PUBLISHABLE_KEY
if (!key?.startsWith('sb_publishable_')) throw new Error('Staging publishable key required')
const mode = process.env.HCS_STAGING_UAT_MODE ?? 'isolation'
delete process.env.HCS_STAGING_UAT_MODE
if (!['isolation', 'fund-recovery', 'paid-replay', 'paid-rollback', 'approval-consumption'].includes(mode))
  throw new Error('Unsupported Staging batch')
const fundMode = mode === 'fund-recovery'
const paidMode = mode === 'paid-replay'
const rollbackMode = mode === 'paid-rollback'
const approvalMode = mode === 'approval-consumption'
const ownerMode = fundMode || paidMode || rollbackMode || approvalMode
const account = ownerMode ? fundPlan : staging
const origin = 'http://127.0.0.1:3014'
const nonce = randomBytes(32).toString('hex')
let busy = false
let finished = false
let evidence = null
const completedCases = []
const title = approvalMode
  ? 'Staging Approval Consumption UAT'
  : rollbackMode
    ? 'Staging Fresh Paid Rollback UAT'
    : paidMode
      ? 'Staging Paid Replay UAT'
      : fundMode
        ? 'Staging Fund Recovery UAT'
        : 'Staging Isolation UAT'
const description = approvalMode
  ? 'PABL0: two mixed six-unit drafts, three exact PHP 1,400 confirmation exceptions. Test wrong-order, actual expiry and wrong-action consumption; one valid confirmation, then cancel both orders and revoke all three approvals. No delivery, receipt or settings change. Expiry observation may take about 25 seconds.'
  : fundMode
    ? 'PABL0 synthetic receipt PHP 800: Capital PHP 500 / Operating PHP 300. One append-only test allocation, exact-key replay and duplicate denial. No real bank settlement or Production money.'
    : rollbackMode
      ? 'PABL0 test order: 2 P-00001 + 4 P-00002. Temporary COD/PHP 6,400 limit. Reject unpaid, PHP 1,599.99, PHP 1,600.01 and missing-method fulfillment. Cancel undelivered order and restore Net 7/PHP 5,000. No successful delivery or receipt planned; append-only test history remains.'
      : paidMode
        ? 'PABL0 historical COD/Prepaid keys only. Recover existing invoice responses, reject changed-body/new-key requests and expired/nonexistent-scope approval creation. No new delivery, receipt or stock posting is planned.'
        : 'This private local runner checks restricted reads and rejected confirmation against a nonexistent order.'
const attestation = approvalMode
  ? 'I approve the two synthetic orders, three bounded PHP 1,400 exceptions, one valid confirmation and cancellation/revocation cleanup.'
  : rollbackMode
    ? 'I approve the synthetic mixed-variant order/reservation, temporary terms and cancellation/restoration test.'
    : paidMode
      ? 'I approve historical replay and denial checks only; no new delivery or collection.'
      : 'I approve the synthetic settled-receipt test and exact PHP 500 / PHP 300 split.'
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:16px system-ui;margin:40px auto;padding:0 20px;max-width:620px;color:#222}label,input,button{display:block}input,button{box-sizing:border-box;width:100%;padding:12px;margin:12px 0 24px}input[type=checkbox]{display:inline;width:auto;margin:0 8px 0 0}button{background:#222;color:white;border:0}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>${title}</h1><p>Account: ${account.email}</p><p>Staging only. ${description}</p><p>Credentials stay in process memory; no browser-session extraction.</p><form method="post" action="/run"><input type="hidden" name="nonce" value="${nonce}"><label for="password">${ownerMode ? 'Staging owner' : 'Tester'} password</label><input id="password" name="password" type="password" required autocomplete="off" maxlength="512">${ownerMode ? `<label><input type="checkbox" name="confirmed" value="yes" required>${attestation}</label>` : ''}<button>Sign in and run approved tests</button></form></html>`
const server = createServer(async (req, res) => {
  const reply = (status, content, type = 'text/plain') => {
    res.writeHead(status, { ...runnerSecurityHeaders, 'Content-Type': `${type}; charset=utf-8` })
    res.end(content)
  }
  if (req.headers.host !== '127.0.0.1:3014') return reply(403, 'Local host required')
  if (req.method === 'GET' && req.url === '/')
    return reply(200, finished ? 'Batch finished. Close this page.' : page, 'text/html')
  if (req.method === 'GET' && req.url === '/result')
    return reply(200, JSON.stringify(evidence ?? { status: 'pending' }), 'application/json')
  if (req.method !== 'POST' || req.url !== '/run') return reply(404, 'Not found')
  if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))
    return reply(403, 'Private local form required')
  if (busy || finished) return reply(409, 'One batch only; restart for another approved batch')
  const sensitive = { raw: '', password: '', token: '', form: null }
  busy = true
  try {
    for await (const chunk of req) {
      sensitive.raw += chunk.toString('utf8')
      if (Buffer.byteLength(sensitive.raw) > 8192) throw new Error('Input too large')
    }
    sensitive.form = new URLSearchParams(sensitive.raw)
    if (sensitive.form.get('nonce') !== nonce) throw new Error('Invalid local form')
    if (ownerMode && sensitive.form.get('confirmed') !== 'yes')
      throw new Error('Exact owner batch attestation required')
    sensitive.password = sensitive.form.get('password') ?? ''
    if (!sensitive.password || sensitive.password.length > 512) throw new Error('Private password required')
    const auth = await fetch(`${staging.auth}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.email, password: sensitive.password }),
    })
    sensitive.password = ''
    sensitive.raw = ''
    sensitive.form = null
    if (!auth.ok) throw new Error('Staging sign-in failed; no tests executed')
    const session = await auth.json()
    sensitive.token = session.access_token ?? ''
    session.access_token = ''
    session.refresh_token = ''
    if (session.user?.id !== (ownerMode ? fundPlan.ownerId : staging.userId) || !sensitive.token)
      throw new Error('Unexpected Staging identity')
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    evidence = {
      status: 'passed',
      day,
      mode,
      cases: approvalMode
        ? await runApprovalConsumptionSuite(createApprovalRequest(sensitive.token), undefined, (entry) => {
            completedCases.push(entry)
            console.log(JSON.stringify({ mode, completedCase: entry }))
          })
        : rollbackMode
          ? await runPaidRollbackSuite(createRollbackRequest(sensitive.token))
          : paidMode
            ? await runPaidReplaySuite(createPaidReplayRequest(sensitive.token), day)
            : fundMode
              ? await runFundRecoverySuite(createFundRequest(sensitive.token), day)
              : await runIsolationSuite(createApiRequest(sensitive.token), day),
    }
    console.log(JSON.stringify(evidence))
    reply(200, JSON.stringify(evidence, null, 2))
  } catch {
    evidence = {
      status: 'failed',
      mode,
      completedCases,
      message: 'Batch stopped. Check account scope and endpoint expectations; no success claimed.',
    }
    console.log(JSON.stringify(evidence))
    reply(409, JSON.stringify(evidence))
  } finally {
    if (sensitive.token) {
      try {
        const logout = await fetch(`${staging.auth}/auth/v1/logout?scope=local`, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: { apikey: key, Authorization: `Bearer ${sensitive.token}` },
        })
        console.log(JSON.stringify({ harnessSessionLogout: logout.ok ? 'passed' : 'failed' }))
      } catch {
        console.log(JSON.stringify({ harnessSessionLogout: 'failed' }))
      }
    }
    sensitive.token = ''
    sensitive.password = ''
    sensitive.raw = ''
    sensitive.form = null
    busy = false
    finished = true
  }
})
server.requestTimeout = 15000
server.listen(3014, '127.0.0.1', () => console.log(`Private Staging runner: ${origin}`))
