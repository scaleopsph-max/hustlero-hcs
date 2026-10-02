# Staging Subscription and Support Access UAT - 2026-10-02

## Scope

Controlled platform-administration validation against the isolated `HUSTLERO HCS Staging` environment. The test used the owner-confirmed staging platform operator, a generated pilot subscription plan, and a short-lived read-only support grant. No production resource or real customer data was involved.

## Test Record

- Platform operator: `HUSTLERO Staging Owner`
- Operator role: `super_admin`
- MFA: verified TOTP / AAL2 session
- Tenant: `PABL0`
- Plan: `HUSTLERO Pilot Full` (`pilot-full`)
- Plan ID: `93d469f6-3377-4f24-aa9c-608687075cb2`
- Subscription ID: `c580aee0-2c06-4523-a540-a1efcaae2e65`
- Support ticket: `UAT-20261002-001`
- Support grant ID: `30910ba9-9ed2-4b0e-b048-0aabad3e7842`

## Verification Results

| Check | Result |
| --- | --- |
| Platform authentication | Passed: the isolated Super Admin session required and displayed verified MFA |
| Platform allowlist | Passed: exactly one active staging `super_admin` is provisioned |
| Plan creation | Passed: one active generated plan with a 14-day default trial and all 8 available modules |
| Core modules | Passed: catalog, reports, and sales remained included |
| Optional included modules | Passed: customers, employees, finance, inventory, and purchasing were included |
| Tenant assignment | Passed: one active `PABL0` subscription was created with the recorded UAT reason |
| Entitlement materialization | Passed: all 8 platform-available modules are entitled and enabled with no end date |
| Access preservation | Passed: assignment did not remove any previously enabled module |
| Support grant | Passed: one 30-minute self-scoped grant was created for ticket `UAT-20261002-001` |
| Support scope | Passed: access level is `read_only` and scope is only `tenant_overview` |
| Overview data boundary | Passed: the UI exposed aggregate operational totals and location rows only, without customer, receipt, credential, or record-level data |
| Overview audit | Passed: opening the overview produced exactly one `platform.support_access.viewed` audit event |
| Immediate revoke | Passed: the grant was revoked with a reason, history was preserved, and active support grant count returned to 0 |
| Platform audit | Passed: plan creation, subscription assignment, support grant, overview view, and support revoke each exist exactly once |

## Conclusion

The Staging subscription and support-access paths passed from MFA-gated platform entry through dynamic plan creation, tenant assignment, entitlement preservation, time-boxed read-only support access, audited overview viewing, and immediate revocation.

This report does not sign off the complete pilot. Backup restore, Worker rollback, final secret scan, and final owner release approval remain separate gates.
