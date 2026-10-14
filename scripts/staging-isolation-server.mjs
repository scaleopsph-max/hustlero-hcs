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
import { createSecondTenantBootstrapRequest, runSecondTenantBootstrapSuite } from './staging-second-tenant-uat.mjs'
import { createBFixtureRequest, runBFixtureSuite } from './staging-second-tenant-fixtures.mjs'
import { createCrossTenantOwnerRequest, runCrossTenantOwnerSuite } from './staging-cross-tenant-owner.mjs'
import { createCrossTenantTesterRequest, runCrossTenantTesterSuite } from './staging-cross-tenant-tester.mjs'

const key = process.env.HCS_STAGING_PUBLISHABLE_KEY
delete process.env.HCS_STAGING_PUBLISHABLE_KEY
if (!key?.startsWith('sb_publishable_')) throw new Error('Staging publishable key required')
const mode = process.env.HCS_STAGING_UAT_MODE ?? 'isolation'
delete process.env.HCS_STAGING_UAT_MODE
if (
  ![
    'isolation',
    'fund-recovery',
    'paid-replay',
    'paid-rollback',
    'approval-consumption',
    'second-tenant-bootstrap',
    'second-tenant-fixtures',
    'second-tenant-fixtures-resume',
    'cross-tenant-owner',
    'cross-tenant-tester',
  ].includes(mode)
)
  throw new Error('Unsupported Staging batch')
const fundMode = mode === 'fund-recovery'
const paidMode = mode === 'paid-replay'
const rollbackMode = mode === 'paid-rollback'
const approvalMode = mode === 'approval-consumption'
const bootstrapMode = mode === 'second-tenant-bootstrap'
const bResumeMode = mode === 'second-tenant-fixtures-resume'
const bFixtureMode = mode === 'second-tenant-fixtures' || bResumeMode
const crossOwnerMode = mode === 'cross-tenant-owner'
const crossTesterMode = mode === 'cross-tenant-tester'
const ownerMode =
  fundMode || paidMode || rollbackMode || approvalMode || bootstrapMode || bFixtureMode || crossOwnerMode
const account = ownerMode ? fundPlan : staging
const origin = 'http://127.0.0.1:3014'
const nonce = randomBytes(32).toString('hex')
let busy = false
let finished = false
let evidence = null
const completedCases = []
const title = crossTesterMode
  ? 'Staging Populated Non-Member Denials'
  : crossOwnerMode
    ? 'Staging Populated Cross-Tenant Denials'
    : bResumeMode
      ? 'Staging B Exact-Profile Resume'
      : bFixtureMode
        ? 'Staging B Synthetic Fixture'
        : bootstrapMode
          ? 'Staging Second-Tenant Bootstrap'
          : approvalMode
            ? 'Staging Approval Consumption UAT'
            : rollbackMode
              ? 'Staging Fresh Paid Rollback UAT'
              : paidMode
                ? 'Staging Paid Replay UAT'
                : fundMode
                  ? 'Staging Fund Recovery UAT'
                  : 'Staging Isolation UAT'
const description = crossTesterMode
  ? 'Existing PABL0 Branch 2 read-only tester only: 20 checks against assigned reports, forbidden Main Store and populated HCS Isolation UAT B. One confirmation POST on the real B test order under PABL0 must be denied. No successful business write or Production access. Temporary tester access is deactivated after independent reconciliation, then B is suspended.'
  : crossOwnerMode
    ? 'Existing owner of PABL0 and HCS Isolation UAT B: positive selected-business reads, then 14 exact foreign-customer/product/location/variant/price/order/invoice/payment references under PABL0. All commands must reject; no successful order, fulfillment, receipt or fund allocation is planned. Stop and reconcile if any unexpected acceptance occurs. Non-member tester matrix and B suspension follow separately. This batch may take several minutes.'
    : bResumeMode
      ? 'Resume only HCS Isolation UAT B after approved October 14 renewal. Verify and reuse the exact saved business profile without writing it again. Then enable Inventory/Customers/Advanced Wholesale and create only the originally approved one-unit/PHP 1 synthetic invoice/receipt fixture, including B-only Net 7/PHP 1 limit. Same unused fixture keys; no automatic retry of an unknown financial outcome. No PABL0 writes, real collection or Production action. Isolation matrix and B suspension remain subsequent stages.'
      : bFixtureMode
        ? 'Only HCS Isolation UAT B: enable Inventory/Customers/Advanced Wholesale, create one reseller/product/wholesale price list/synthetic cash method, one opening unit, one PHP 1 invoice and one PHP 1 receipt. B-only Net 7/PHP 1 synthetic credit limit allows the invoice before its exact receipt; no PABL0 terms change. Preserve append-only test history. No real collection or Production action. Isolation denial matrix and platform suspension follow separately.'
        : bootstrapMode
          ? 'Create only HCS Isolation UAT B (hcs-isolation-uat-b-20261013), PHP / Asia-Manila, with Main UAT B location and your owner membership. No stock, invoice, receipt, entitlement, tester grant or Production action in this stage. This is preparation, not the complete isolation test. Stop for separate platform prerequisites after creation.'
          : approvalMode
            ? 'PABL0: two mixed six-unit drafts, three exact PHP 1,400 confirmation exceptions. Test wrong-order, actual expiry and wrong-action consumption; one valid confirmation, then cancel confirmed A, retain unreserved inert draft B as UAT evidence and revoke all three approvals. No delivery, receipt or settings change. Expiry observation may take about 25 seconds.'
            : fundMode
              ? 'PABL0 synthetic receipt PHP 800: Capital PHP 500 / Operating PHP 300. One append-only test allocation, exact-key replay and duplicate denial. No real bank settlement or Production money.'
              : rollbackMode
                ? 'PABL0 test order: 2 P-00001 + 4 P-00002. Temporary COD/PHP 6,400 limit. Reject unpaid, PHP 1,599.99, PHP 1,600.01 and missing-method fulfillment. Cancel undelivered order and restore Net 7/PHP 5,000. No successful delivery or receipt planned; append-only test history remains.'
                : paidMode
                  ? 'PABL0 historical COD/Prepaid keys only. Recover existing invoice responses, reject changed-body/new-key requests and expired/nonexistent-scope approval creation. No new delivery, receipt or stock posting is planned.'
                  : 'This private local runner checks restricted reads and rejected confirmation against a nonexistent order.'
const attestation = crossOwnerMode
  ? 'I approve the reviewed populated B foreign-reference denial-only batch under PABL0, unchanged business baselines, immediate stop/reconciliation on unexpected acceptance. No new successful financial command or Production action.'
  : bResumeMode
    ? 'I approve the reviewed B-only exact-profile resume after bounded renewal, unchanged one-unit/PHP 1 synthetic invoice/receipt budget. Skip saved profile write; preserve evidence and suspend B after tests.'
    : bFixtureMode
      ? 'I approve the exact B-only one-unit/PHP 1 synthetic invoice and receipt fixture and B-only onboarding/test credit configuration. No real collection; preserve history for isolation tests and subsequent B suspension.'
      : bootstrapMode
        ? 'I approve the fixed synthetic B tenant/location/owner membership bootstrap in existing Staging, preserving its audit history. Financial fixture execution is not part of this form.'
        : approvalMode
          ? 'I approve R2: two synthetic orders, three bounded PHP 1,400 exceptions, one valid confirmation, cancel confirmed A, retain inert draft B and revoke all approvals.'
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
      cases: crossTesterMode
        ? await runCrossTenantTesterSuite(createCrossTenantTesterRequest(sensitive.token, day), day, (entry) => {
            completedCases.push(entry)
            console.log(JSON.stringify({ mode, completedCase: entry }))
          })
        : crossOwnerMode
          ? await runCrossTenantOwnerSuite(createCrossTenantOwnerRequest(sensitive.token), (entry) => {
              completedCases.push(entry)
              console.log(JSON.stringify({ mode, completedCase: entry }))
            })
          : bFixtureMode
            ? await runBFixtureSuite(
                createBFixtureRequest(sensitive.token),
                (entry) => {
                  completedCases.push(entry)
                  console.log(JSON.stringify({ mode, completedCase: entry }))
                },
                { reuseApprovedProfile: bResumeMode },
              )
            : bootstrapMode
              ? await runSecondTenantBootstrapSuite(createSecondTenantBootstrapRequest(sensitive.token), (entry) => {
                  completedCases.push(entry)
                  console.log(JSON.stringify({ mode, completedCase: entry }))
                })
              : approvalMode
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
