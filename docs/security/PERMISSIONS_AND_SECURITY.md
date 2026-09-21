# Permissions and Security

## Security domains

- Tenant Back Office users authenticate through the tenant application.
- POS employees use a registered device plus employee PIN; PINs are hashed and rate-limited.
- HCS Super Admin uses a separate domain, session policy, role set, and MFA requirement.
- Support access requires a ticket/reason, tenant target, scope, expiry, and audit trail. It is read-only by default.

## Default roles

| Capability | Owner | Admin | Manager | Cashier | Inventory Staff | Accountant |
| --- | --- | --- | --- | --- | --- | --- |
| Tenant settings and billing | Full | Limited | None | None | None | Read |
| Employees and roles | Full | Full | Branch | None | None | Read |
| Products and prices | Full | Full | Branch | Read | Edit | Read |
| Inventory view | Full | Full | Branch | Location | Full | Read |
| Inventory adjustment | Full | Full | Approval policy | None | Request/Edit | None |
| POS sale | Full | Full | Full | Full | Optional | None |
| Discount/price override | Full | Policy | Policy | Request | None | None |
| Refund/void | Full | Policy | Policy | Request | None | Read |
| Cash movement and close | Full | Full | Branch | Own register | None | Read |
| Reports | Full | Full | Branch | Own activity | Inventory | Financial |
| Audit | Full | Full | Branch | Own activity | Own activity | Read |

Exact permissions use capability codes; role names are templates, not hardcoded business logic.

## Authorization checks

Every command verifies:

1. Authenticated principal and active session
2. Active tenant membership
3. Active employee where required
4. Location assignment/device registration
5. Capability entitlement and tenant toggle
6. Required permission
7. Record belongs to tenant and allowed location
8. Business preconditions and approval thresholds

## Authentication safeguards

- Short-lived access tokens with secure refresh handling
- Server verification for sensitive commands
- Session revocation on deactivation or suspected compromise
- MFA required for platform admins and recommended for tenant owners/admins
- Rate limits and lockout controls for PIN and authentication attempts
- No authorization decisions from user-editable metadata

## Data protection

- TLS in transit and managed encryption at rest
- Secrets stored only in platform secret stores or protected CI environments
- Sensitive values removed from logs and error payloads
- Tenant-prefixed R2 keys plus parent-record authorization
- Upload allowlists, size limits, MIME/content verification, and malware strategy before broad file support
- Audit events for authentication, permissions, money, inventory, pricing, approvals, configuration, support access, and exports

## Threat-driven test set

- Cross-tenant object ID access
- Branch/location bypass
- Direct API calls to hidden UI actions
- Stale entitlement and stale role tokens
- Duplicate sale/payment/refund submissions
- Forged device or employee identifiers
- Unsafe file names/content types
- Injection and stored XSS
- CSRF where cookie-authenticated mutations exist
- Excessive export or login requests
- Secret leakage in browser bundles, source maps, CI logs, and error reports
