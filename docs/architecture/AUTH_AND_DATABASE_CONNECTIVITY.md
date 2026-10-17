# Authentication and Database Connectivity

Last verified: 2026-09-21

## Request trust boundary

The API derives the user identity from a verified Supabase access token. Tenant, branch, role, permission, and entitlement access are loaded from the private PostgreSQL schemas using that verified user ID.

Client-provided tenant IDs, location IDs, roles, permissions, and entitlements are never treated as authorization evidence. A later tenant-scoped middleware may accept a requested tenant or location selector, but it must match the server-resolved session context before a request is allowed to continue.

## Supabase JWT verification

- The Worker validates access tokens against the project's Supabase JWKS endpoint.
- Issuer, audience, expiry, signature, and subject are verified by `jose`.
- Invalid or expired credentials fail closed with the standard API error envelope.
- The Supabase project must use an asymmetric signing key before this path is deployed. Legacy shared-secret verification is intentionally unsupported by the Worker.
- `SUPABASE_URL` is a non-secret environment variable. It must be configured independently for development, staging, and production.

## Private database access

- The `app`, `audit`, `integration`, and `reporting` schemas remain unavailable through the browser-facing Data API.
- The API Worker connects to PostgreSQL through a Cloudflare Hyperdrive binding named `HYPERDRIVE`.
- The database connection is opened and closed inside each request. No connection or transaction is shared across requests.
- Session-context SQL uses parameterized queries and returns only active tenants, active memberships, active employees, active locations, effective role permissions, and currently enabled entitlements.
- Database credentials belong in Cloudflare/Supabase secret storage and must never be added to Wrangler configuration, source files, CI logs, or GitHub.

## Deployment prerequisites

1. Confirm or migrate the development Supabase project to asymmetric JWT signing.
2. Enable the versioned `hcs_hyperdrive` role with a generated password. It inherits only the column-level `hcs_api_context_reader` grants required by `GET /v1/me` and cannot bypass RLS.
3. Create the development Hyperdrive resource using the Supabase direct or pooler connection details.
4. Add the resulting Hyperdrive binding ID and `SUPABASE_URL` to the development Worker environment.
5. Repeat with isolated resources for staging and production; never reuse development credentials.
6. Run an authenticated smoke test against `GET /v1/me` before enabling tenant-scoped routes.

The project must not be deployed with a placeholder Hyperdrive ID or a database password embedded in source control.
