/* global console */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const ignoredFiles = new Set(['package-lock.json'])
const signatures = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],
  ['OpenAI secret key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['Stripe live secret', /\bsk_live_[A-Za-z0-9]{16,}\b/],
  ['Cloudflare API token assignment', /CLOUDFLARE_API_TOKEN[\t ]*=[\t ]*[^\s$<{][^\s]*/i],
  ['Supabase service-role assignment', /SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY[\t ]*=[\t ]*[^\s$<{][^\s]*/i],
  ['Postgres URL with embedded password', /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@[^\s]+/i],
]

const findings = []
for (const file of trackedFiles) {
  if (ignoredFiles.has(file)) continue
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const [name, signature] of signatures) {
    const match = content.match(signature)
    if (match) findings.push(`${file}:${content.slice(0, match.index).split('\n').length} ${name}`)
  }
}

if (findings.length) {
  console.error('Potential committed secrets detected (values withheld):')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log(`Secret scan passed across ${trackedFiles.length} tracked files.`)
