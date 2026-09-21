# Cloudflare Compatibility Record

Last verified: 2026-09-21

## Decision

The four React applications retain ordinary Next.js scripts as a development fallback and add vinext as the Cloudflare Workers deployment path. This follows current Cloudflare guidance while containing the risk of vinext's beta status.

## Verified applications

| Application | Next.js build | vinext build | Worker name |
| --- | --- | --- | --- |
| Marketing web | Pass | Pass | `hustlero-hcs-web` |
| Back Office | Pass | Pass | `hustlero-hcs-backoffice` |
| POS | Pass | Pass | `hustlero-hcs-pos` |
| Super Admin | Pass | Pass | `hustlero-hcs-admin` |

The API Worker dry-run also passes as `hustlero-hcs-api`.

## Known beta behavior

- `next/font/google` is supported by vinext through CDN loading rather than build-time self-hosting.
- Vinext currently reports the static App Router routes as `Unknown` during classification. Bundle generation completes successfully.
- CDN cache, data cache, and image optimization adapters are intentionally disabled until a feature requires them and their cost and invalidation behavior are approved.

## Release gate

Before the first deployment, start each generated Worker locally, run route smoke tests, and verify the approved UI at desktop and POS target sizes. A deployment is not considered production-ready from build success alone.
