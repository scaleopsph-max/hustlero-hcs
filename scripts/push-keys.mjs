#!/usr/bin/env node
// Creates the Web Push sender keys for one API environment and stores them straight into Cloudflare Worker
// secrets. The private key is never printed, written to disk, or put in the repository.
//
//   npm run push:keys -- development
//   npm run push:keys -- development --rotate   (replaces existing keys; every browser must turn push on again)
import { spawnSync } from 'node:child_process'
import { webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const environments = new Set(['development', 'staging', 'production'])
const [environment, ...flags] = process.argv.slice(2)
const rotate = flags.includes('--rotate')
const apiDir = fileURLToPath(new URL('../apps/api/', import.meta.url))
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

if (!environments.has(environment ?? '')) {
  console.error('Usage: npm run push:keys -- <development|staging|production> [--rotate]')
  process.exit(2)
}

const list = spawnSync(npx, ['wrangler', 'secret', 'list', '--env', environment], {
  cwd: apiDir,
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
if (list.status !== 0) {
  console.error('Could not read the Worker secrets. Sign in with "npx wrangler login" and try again.')
  process.exit(1)
}
if (list.stdout.includes('VAPID_PRIVATE_KEY') && !rotate) {
  console.log(`Push keys already exist for ${environment}. Nothing changed.`)
  console.log('Use --rotate only if you must replace them; every browser will need to turn notifications on again.')
  process.exit(0)
}

const toBase64Url = (bytes) => Buffer.from(bytes).toString('base64url')
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicKey = toBase64Url(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)))
const privateKey = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)).d

for (const [name, value] of [
  ['VAPID_PRIVATE_KEY', privateKey],
  ['VAPID_PUBLIC_KEY', publicKey],
]) {
  const put = spawnSync(npx, ['wrangler', 'secret', 'put', name, '--env', environment], {
    cwd: apiDir,
    input: value,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (put.status !== 0) {
    console.error(`Could not save ${name}. Nothing was printed; run the command again.`)
    process.exit(1)
  }
}

console.log(`Push keys saved for the ${environment} API.`)
console.log(`Public key (safe to share): ${publicKey}`)
