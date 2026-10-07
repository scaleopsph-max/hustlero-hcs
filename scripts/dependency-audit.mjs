import { spawnSync } from 'node:child_process'

const allowedAdvisories = new Map([
  [
    'GHSA-vfj7-8cjw-p6xm',
    {
      reason: 'No patched braces release exists. HCS only reaches braces through trusted build-time glob patterns.',
      matches: (vulnerability) =>
        vulnerability.name === 'braces' && vulnerability.nodes.every((node) => node === 'node_modules/braces'),
    },
  ],
  [
    'GHSA-wq5f-xc86-pv6w',
    {
      reason:
        'Cloudflare miniflare pins sharp 0.35.4 exactly. Runtime Next and image-generation paths use patched sharp 0.35.5.',
      matches: (vulnerability) =>
        vulnerability.name === 'sharp' &&
        vulnerability.nodes.length > 0 &&
        vulnerability.nodes.every((node) => node.includes('node_modules/miniflare/node_modules/sharp')),
    },
  ],
])

const npmCli = process.env.npm_execpath
const audit = npmCli
  ? spawnSync(process.execPath, [npmCli, 'audit', '--json'], { encoding: 'utf8' })
  : spawnSync('npm', ['audit', '--json'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })

if (!audit.stdout) {
  process.stderr.write(audit.stderr || 'npm audit produced no JSON output.\n')
  process.exit(1)
}

let report
try {
  report = JSON.parse(audit.stdout)
} catch {
  process.stderr.write(audit.stdout)
  process.stderr.write(audit.stderr || '')
  process.exit(1)
}

const vulnerabilities = report.vulnerabilities ?? {}
const minimumSeverity = new Set(['high', 'critical'])
const memo = new Map()

function isAllowed(name, visiting = new Set()) {
  if (memo.has(name)) return memo.get(name)
  if (visiting.has(name)) return false

  const vulnerability = vulnerabilities[name]
  if (!vulnerability || !minimumSeverity.has(vulnerability.severity)) return true

  const nextVisiting = new Set(visiting).add(name)
  const allowed = vulnerability.via.every((cause) => {
    if (typeof cause === 'string') return isAllowed(cause, nextVisiting)

    if (!minimumSeverity.has(cause.severity)) return true
    const advisoryId = cause.url?.split('/').at(-1)
    const exception = advisoryId ? allowedAdvisories.get(advisoryId) : undefined
    return exception ? exception.matches(vulnerability) : false
  })

  memo.set(name, allowed)
  return allowed
}

const blocking = Object.keys(vulnerabilities).filter((name) => !isAllowed(name))
const accepted = Object.keys(vulnerabilities).filter(
  (name) => minimumSeverity.has(vulnerabilities[name].severity) && isAllowed(name),
)

if (blocking.length > 0) {
  process.stderr.write(`Blocking high/critical dependency findings: ${blocking.join(', ')}\n`)
  process.exit(1)
}

if (accepted.length > 0) {
  process.stdout.write(`Accepted build-time advisory chain: ${accepted.join(', ')}\n`)
  for (const [advisory, exception] of allowedAdvisories) {
    process.stdout.write(`- ${advisory}: ${exception.reason}\n`)
  }
}

process.stdout.write('No unaccepted high or critical dependency advisories found.\n')
