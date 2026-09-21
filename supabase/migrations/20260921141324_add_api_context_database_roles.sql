begin;

do $$
begin
  create role hcs_api_context_reader nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create role hcs_hyperdrive nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
exception
  when duplicate_object then null;
end
$$;

alter role hcs_hyperdrive set statement_timeout = '5s';
alter role hcs_hyperdrive set idle_in_transaction_session_timeout = '10s';
alter role hcs_hyperdrive set search_path = pg_catalog;

grant hcs_api_context_reader to hcs_hyperdrive;
grant connect on database postgres to hcs_hyperdrive;
grant usage on schema app to hcs_api_context_reader;

grant select (id, slug, name, status)
  on app.tenants to hcs_api_context_reader;
grant select (tenant_id, user_id, status, is_owner)
  on app.tenant_memberships to hcs_api_context_reader;
grant select (id, tenant_id, user_id, status)
  on app.employees to hcs_api_context_reader;
grant select (tenant_id, employee_id, location_id)
  on app.employee_locations to hcs_api_context_reader;
grant select (id, tenant_id, is_active)
  on app.locations to hcs_api_context_reader;
grant select (tenant_id, user_id, role_id)
  on app.membership_roles to hcs_api_context_reader;
grant select (tenant_id, role_id, permission_code)
  on app.role_permissions to hcs_api_context_reader;
grant select (tenant_id, feature_code, entitled, enabled, starts_at, ends_at)
  on app.tenant_entitlements to hcs_api_context_reader;

create policy tenants_api_context_select
on app.tenants for select to hcs_api_context_reader
using (true);

create policy tenant_memberships_api_context_select
on app.tenant_memberships for select to hcs_api_context_reader
using (true);

create policy employees_api_context_select
on app.employees for select to hcs_api_context_reader
using (true);

create policy employee_locations_api_context_select
on app.employee_locations for select to hcs_api_context_reader
using (true);

create policy locations_api_context_select
on app.locations for select to hcs_api_context_reader
using (true);

create policy membership_roles_api_context_select
on app.membership_roles for select to hcs_api_context_reader
using (true);

create policy role_permissions_api_context_select
on app.role_permissions for select to hcs_api_context_reader
using (true);

create policy tenant_entitlements_api_context_select
on app.tenant_entitlements for select to hcs_api_context_reader
using (true);

commit;
