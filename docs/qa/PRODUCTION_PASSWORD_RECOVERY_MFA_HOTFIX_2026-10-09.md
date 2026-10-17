# Production Password Recovery MFA Hotfix - 2026-10-09

## Incident

The Production owner recovery link created a valid recovery session, but password update failed with `AAL2 session is required to update email or password when MFA is enabled`. The account has a verified TOTP factor while an email recovery session initially has AAL1 assurance.

## Correction

The Back Office recovery screen now checks the session assurance level and enrolled factors. When AAL2 is required, it asks for the existing authenticator code and completes Supabase MFA challenge-and-verify before exposing the password update form. Recovery remains fail-closed when no verified factor can satisfy the required assurance level.

Regression coverage verifies AAL1-to-AAL2 challenge selection, an already-AAL2 session, an account that does not require MFA, and the missing-factor fail-closed state.

## Verification

- Full `npm run check` passed: secret scan, formatting, lint, strict typecheck, 100 Vitest cases, standard builds, and Cloudflare builds.
- The Production bundle contains the Production Supabase and API references and no Staging references. Generated `.dev.vars` was removed before deployment.
- Production Back Office Worker version `b91fc400-6639-426e-8ad0-978ebb459f05` was deployed.
- Back Office root returned 200.
- `/setup?recovery=1` returned 200.
- API health returned 200.
- Unauthenticated `/v1/me` returned 401.
- Production Back Office CORS preflight returned 204 with the exact Production origin.

## Remaining owner step

Use only the newest Production recovery email. Complete the authenticator challenge with the existing TOTP factor, enter the new password, and submit the final password change. No password, authenticator code, recovery token, or session token is stored in the repository.
