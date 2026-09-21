# Environments and Deployment

## Environment model

| Environment | Purpose | Data policy | Deployment policy |
| --- | --- | --- | --- |
| Local | Development and automated tests | Synthetic only | No shared cloud dependency by default |
| Development | Shared integration | Synthetic/test tenants | Automatic from approved development branch if enabled |
| Staging | Release candidate and UAT | Sanitized or generated | Immutable candidate from `main` |
| Production | Live business operations | Real tenant data | Manual promotion after QA gate |

The current Supabase project becomes the Development environment. Staging and Production projects are created only after migrations and environment bootstrap are reproducible.

## Resource naming

```text
Supabase: HUSTLERO HCS Development / Staging / Production
Workers:  hustlero-hcs-{app}-{environment}
R2:       hustlero-hcs-files-{environment}
Queues:   hustlero-hcs-{purpose}-{environment}
```

Production names may omit the environment suffix only after naming is reviewed consistently.

## Cloudflare deployment model

- One Worker project per deployable application.
- One `wrangler.jsonc` per deployment root.
- Separate staging and production environments.
- Root directories and build watch paths isolate monorepo deployments.
- Preview branches upload versions without promoting production.
- Custom domains are attached only after verified `workers.dev` smoke tests.
- Runtime variables and secrets are distinct from build-time variables.

No HUSTLERO Worker is created until its source, configuration, dry run, and rollback notes pass review.

## Supabase model

- Migrations are committed and replayed in order.
- RLS and grants ship in the same migration as the protected object.
- Production changes flow through CI; no untracked dashboard schema edits.
- Database pooling/direct URLs are separated by use case.
- Backups, point-in-time recovery availability, and restore tests are verified before live tenants.
- Data API exposure is explicit and minimal.

## Secret classes

| Secret | Browser | API Worker | CI only |
| --- | --- | --- | --- |
| Supabase publishable key | Allowed | Allowed | Allowed |
| Supabase secret/service key | Never | Secret binding only | Protected environment |
| Database pooled URL | Never | Secret binding only | Protected environment |
| Database direct URL | Never | Avoid runtime | Migration job only |
| Cloudflare API token | Never | Never | Protected environment |
| Email/payment secrets | Never | Secret binding only | Protected environment |

## Release flow

```text
feature branch
-> pull request
-> static checks and tests
-> migration validation
-> preview deployment
-> review
-> merge main
-> staging deployment and E2E
-> owner release approval
-> production promotion
-> smoke test and monitoring
```

## Recovery

- Keep the previous Worker version deployable for rollback.
- Never rely on application rollback to reverse destructive database migrations.
- Use expand/migrate/contract changes for incompatible schema transitions.
- Record database restore procedures and execute scheduled restore drills.
- Queue consumers must tolerate retries and replay without duplicate business effects.
