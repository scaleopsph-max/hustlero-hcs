# Register Operations Scope Review

Review candidate base: `4c3f6f83bdfda453f68e501a05eca8e373cc0644`.

The latest `list_register_operations` definition was still the September 24 foundation. Its active-member capability check admitted payment-method-only readers, then returned all tenant employees, registers/current cash and the latest 50 tenant sessions. API/repository supplied authenticated tenant context but no additional branch filtering. This conflicts with the locked allowed-location and capability checks. This is a source finding, not a live exploit.

Correction `20261017103705_register_operations_branch_scope` retains the original membership check behind a private core. Non-owners without register read/operate capability receive payment-method configuration only, with empty employee/register/history arrays. Register-capable non-owners receive only their existing allowed branches; shared employees disclose only allowed assignment IDs. Session history is rebuilt with branch authorization before the 50-row limit. Owners retain the original tenant-wide historical projection, including inactive locations. The patch changes no cash movement, register command or reconciliation computation.

Disposable SQL coverage includes payment-only access, assigned and multiple branches, exact opening amounts, private assignment IDs, a permitted older session behind 55 forbidden newer rows, inactive employee/location, suspended membership, foreign tenant and private-core/API ACLs. The independent fixture reuses existing reporting setup; all fixture writes are rolled back. Exact candidate CI must pass before any release claim.

This bounded correction does not establish completion of the broader capability/role audit or cashier-own-register policy. Existing role names are templates, not authorization rules; no role-name shortcut or new tenant-wide grant is introduced. Authenticated populated UI UAT and reviewed-main release gates remain open.

Rollback must not expose the old private unscoped reader. Keep business ledgers intact and use a reviewed forward correction or pause affected reads. No migration/deployment, credential/access grant, financial command or paid resource was applied to a shared environment.
