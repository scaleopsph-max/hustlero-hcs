# Back Office Member Landing Candidate

Status: local candidate implemented; five focused regressions, synthetic browser checks and full local `npm run check` passed (exit 0), including all standard/Cloudflare builds. No commit, push or live deployment is claimed.

## Scope

- Setup resolves the existing active membership from authenticated `/v1/me` before showing business creation. Non-owners open reports when authorized, otherwise entitled wholesale when authorized, otherwise the normal dashboard. Owners retain onboarding; accounts without memberships retain business creation.
- Existing active-tenant selection is preserved for mixed owner/member accounts. No role grant, permission escalation, server authorization change or database migration.
- Membership loading/denial cannot present the business-creation form prematurely. Password recovery is explicitly excluded from member routing.
- Replaced static Ana Reyes/Owner/AR with a neutral, accessible Account icon. The API contract does not expose an authenticated display name; the UI does not fabricate one or infer a role. This indicator remains non-interactive like the previous badge, not a new profile/settings feature.
- Vitest uses automatic JSX transform to support the new server-rendered header regression; no runtime build configuration was changed.

## Executed Verification

- Focused tests: four landing cases plus rendered header identity regression passed. Back Office typecheck passed.
- Full unit suite passed 489 cases across 23 files; lint, formatting and workspace typechecks passed. Secret scan passed 445 tracked files. New source is not yet tracked/pushed, so a staged-file secret scan remains required before a future push.
- Full `npm run check` completed with exit 0, including all standard Next.js builds, API Wrangler dry run and all Cloudflare/vinext builds. Existing non-failing route-classification, dynamic-import and plugin timing warnings remained; these are not new test failures.
- Synthetic Playwright script `tmp/account-landing-browser.mjs` passed delayed member-context loading, existing-member redirect, owner/new-account/signed-out/error contexts, mixed active member/owner selection, neutral header, desktop 1440x1000/mobile 390x844 screenshots and mobile no horizontal overflow. All API/Auth destinations were intercepted with synthetic fixtures; zero non-GET business commands or page errors.
- Screenshots `output/account-landing/desktop.png` and `mobile.png` were visually inspected. The visible Synthetic read denied report message is a deliberate fixture, not a live API failure. No real user token/password was used.
- Recovery exclusion is unit-tested; a full email/MFA/password-reset flow was not rerun. No PostgreSQL migration/database suite was rerun for these frontend-only changes.

## Release Gate

Obtain isolated CI evidence for the scoped candidate, then perform a controlled Staging app release. Authenticated live retest requires renewed narrow tester authorization because the previous tester membership/employee have been deactivated. Explicit HTTP wrong-tenant/branch/write negatives and the rest of AW3 recovery/settlement/fund UAT remain separate gates. Production is unchanged.
