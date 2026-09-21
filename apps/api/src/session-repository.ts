import { tenantAccessSchema, type TenantAccess } from '@hcs/contracts'
import { Client } from 'pg'
import { z } from 'zod'

import type { Bindings } from './env'

export type SessionAccessLoader = (userId: string, bindings: Bindings) => Promise<TenantAccess[]>

const tenantRowSchema = z.object({
  tenant_id: z.string().uuid(),
  tenant_slug: z.string(),
  tenant_name: z.string(),
  is_owner: z.boolean(),
  employee_id: z.string().uuid().nullable(),
  location_ids: z.array(z.string().uuid()),
  permissions: z.array(z.string()),
  entitlements: z.array(z.string()),
})

const sessionAccessSql = `
  select
    tenant.id as tenant_id,
    tenant.slug::text as tenant_slug,
    tenant.name as tenant_name,
    membership.is_owner,
    employee.id as employee_id,
    coalesce(location_access.location_ids, array[]::uuid[]) as location_ids,
    coalesce(permission_access.permissions, array[]::text[]) as permissions,
    coalesce(entitlement_access.entitlements, array[]::text[]) as entitlements
  from app.tenant_memberships membership
  join app.tenants tenant
    on tenant.id = membership.tenant_id
   and tenant.status = 'active'
  left join app.employees employee
    on employee.tenant_id = membership.tenant_id
   and employee.user_id = membership.user_id
   and employee.status = 'active'
  left join lateral (
    select array_agg(employee_location.location_id order by employee_location.location_id) as location_ids
    from app.employee_locations employee_location
    join app.locations location
      on location.tenant_id = employee_location.tenant_id
     and location.id = employee_location.location_id
     and location.is_active
    where employee_location.tenant_id = employee.tenant_id
      and employee_location.employee_id = employee.id
  ) location_access on true
  left join lateral (
    select array_agg(distinct role_permission.permission_code order by role_permission.permission_code) as permissions
    from app.membership_roles membership_role
    join app.role_permissions role_permission
      on role_permission.tenant_id = membership_role.tenant_id
     and role_permission.role_id = membership_role.role_id
    where membership_role.tenant_id = membership.tenant_id
      and membership_role.user_id = membership.user_id
  ) permission_access on true
  left join lateral (
    select array_agg(entitlement.feature_code order by entitlement.feature_code) as entitlements
    from app.tenant_entitlements entitlement
    where entitlement.tenant_id = membership.tenant_id
      and entitlement.entitled
      and entitlement.enabled
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) entitlement_access on true
  where membership.user_id = $1::uuid
    and membership.status = 'active'
  order by tenant.name, tenant.id
`

export const loadSessionAccessFromPostgres: SessionAccessLoader = async (userId, bindings) => {
  if (!bindings.HYPERDRIVE?.connectionString) {
    throw new Error('HYPERDRIVE binding is not configured.')
  }

  const client = new Client({ connectionString: bindings.HYPERDRIVE.connectionString })

  try {
    await client.connect()
    const result = await client.query(sessionAccessSql, [userId])

    return result.rows.map((row: unknown) => {
      const parsed = tenantRowSchema.parse(row)

      return tenantAccessSchema.parse({
        tenantId: parsed.tenant_id,
        tenantSlug: parsed.tenant_slug,
        tenantName: parsed.tenant_name,
        isOwner: parsed.is_owner,
        employeeId: parsed.employee_id,
        locationIds: parsed.location_ids,
        permissions: parsed.permissions,
        entitlements: parsed.entitlements,
      })
    })
  } finally {
    await client.end()
  }
}
