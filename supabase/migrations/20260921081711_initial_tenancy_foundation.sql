begin;

create extension if not exists citext with schema extensions;

create schema if not exists app;
create schema if not exists audit;
create schema if not exists integration;
create schema if not exists reporting;

revoke all on schema app, audit, integration, reporting from public, anon, authenticated;
alter default privileges in schema app revoke all on tables from public, anon, authenticated;
alter default privileges in schema audit revoke all on tables from public, anon, authenticated;
alter default privileges in schema integration revoke all on tables from public, anon, authenticated;
alter default privileges in schema reporting revoke all on tables from public, anon, authenticated;

create table app.tenants (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  base_currency text not null default 'PHP' check (base_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Asia/Manila',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_format check (slug::text ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint tenants_name_not_blank check (btrim(name) <> '')
);

create table app.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  code extensions.citext not null,
  name text not null,
  kind text not null default 'store' check (kind in ('store', 'warehouse', 'office', 'virtual')),
  timezone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  constraint locations_code_not_blank check (btrim(code::text) <> ''),
  constraint locations_name_not_blank check (btrim(name) <> '')
);

create table app.tenant_memberships (
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'deactivated')),
  is_owner boolean not null default false,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create unique index tenant_memberships_one_owner_per_tenant
  on app.tenant_memberships (tenant_id)
  where is_owner and status = 'active';
create index tenant_memberships_user_active_idx
  on app.tenant_memberships (user_id, tenant_id)
  where status = 'active';

create table app.employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  user_id uuid,
  employee_code extensions.citext not null,
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'deactivated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, employee_code),
  foreign key (tenant_id, user_id) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint employees_code_not_blank check (btrim(employee_code::text) <> ''),
  constraint employees_display_name_not_blank check (btrim(display_name) <> '')
);
create unique index employees_tenant_user_unique_idx on app.employees (tenant_id, user_id) where user_id is not null;

create table app.employee_locations (
  tenant_id uuid not null,
  employee_id uuid not null,
  location_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, employee_id, location_id),
  foreign key (tenant_id, employee_id) references app.employees (tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict
);
create index employee_locations_location_idx on app.employee_locations (tenant_id, location_id, employee_id);

create table app.permissions (
  code text primary key,
  description text not null,
  created_at timestamptz not null default now(),
  constraint permissions_code_format check (code ~ '^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$')
);

create table app.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  code extensions.citext not null,
  name text not null,
  is_system_template boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  constraint roles_name_not_blank check (btrim(name) <> '')
);

create table app.role_permissions (
  tenant_id uuid not null,
  role_id uuid not null,
  permission_code text not null references app.permissions (code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (tenant_id, role_id, permission_code),
  foreign key (tenant_id, role_id) references app.roles (tenant_id, id) on delete restrict
);
create index role_permissions_permission_idx on app.role_permissions (permission_code, tenant_id, role_id);

create table app.membership_roles (
  tenant_id uuid not null,
  user_id uuid not null,
  role_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, role_id),
  foreign key (tenant_id, user_id) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, role_id) references app.roles (tenant_id, id) on delete restrict
);
create index membership_roles_role_idx on app.membership_roles (tenant_id, role_id, user_id);

create table app.features (
  code text primary key,
  name text not null,
  platform_available boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint features_code_format check (code ~ '^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$')
);

create table app.tenant_entitlements (
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  feature_code text not null references app.features (code) on delete restrict,
  entitled boolean not null default false,
  enabled boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature_code),
  constraint tenant_entitlements_valid_window check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint tenant_entitlements_enabled_requires_entitlement check (not enabled or entitled)
);

create table app.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  locked_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (tenant_id, operation, idempotency_key),
  constraint idempotency_operation_not_blank check (btrim(operation) <> ''),
  constraint idempotency_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint idempotency_response_status_range check (response_status is null or response_status between 100 and 599),
  constraint idempotency_expiry_after_creation check (expires_at > created_at)
);
create index idempotency_records_expiry_idx on app.idempotency_records (expires_at);

create table audit.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references app.tenants (id) on delete restrict,
  request_id text not null,
  actor_type text not null check (actor_type in ('tenant_user', 'pos_employee', 'platform_admin', 'system')),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  location_id uuid,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  constraint audit_action_not_blank check (btrim(action) <> ''),
  constraint audit_entity_type_not_blank check (btrim(entity_type) <> ''),
  constraint audit_location_requires_tenant check (location_id is null or tenant_id is not null)
);
create index audit_events_tenant_occurred_idx on audit.audit_events (tenant_id, occurred_at desc);
create index audit_events_entity_idx on audit.audit_events (tenant_id, entity_type, entity_id, occurred_at desc);

create table integration.event_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references app.tenants (id) on delete restrict,
  topic text not null,
  aggregate_type text not null,
  aggregate_id uuid,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'published', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint event_outbox_topic_not_blank check (btrim(topic) <> ''),
  constraint event_outbox_aggregate_type_not_blank check (btrim(aggregate_type) <> '')
);
create index event_outbox_claim_idx
  on integration.event_outbox (status, available_at, created_at)
  where status in ('pending', 'failed');

create function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function app.set_updated_at() from public, anon, authenticated;

create trigger tenants_set_updated_at before update on app.tenants for each row execute function app.set_updated_at();
create trigger locations_set_updated_at before update on app.locations for each row execute function app.set_updated_at();
create trigger tenant_memberships_set_updated_at before update on app.tenant_memberships for each row execute function app.set_updated_at();
create trigger employees_set_updated_at before update on app.employees for each row execute function app.set_updated_at();
create trigger roles_set_updated_at before update on app.roles for each row execute function app.set_updated_at();
create trigger features_set_updated_at before update on app.features for each row execute function app.set_updated_at();
create trigger tenant_entitlements_set_updated_at before update on app.tenant_entitlements for each row execute function app.set_updated_at();

create function audit.reject_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit events are append-only';
end;
$$;
revoke all on function audit.reject_event_mutation() from public, anon, authenticated;
create trigger audit_events_reject_update_delete
before update or delete on audit.audit_events
for each row execute function audit.reject_event_mutation();

alter table app.tenants enable row level security;
alter table app.locations enable row level security;
alter table app.tenant_memberships enable row level security;
alter table app.employees enable row level security;
alter table app.employee_locations enable row level security;
alter table app.permissions enable row level security;
alter table app.roles enable row level security;
alter table app.role_permissions enable row level security;
alter table app.membership_roles enable row level security;
alter table app.features enable row level security;
alter table app.tenant_entitlements enable row level security;
alter table app.idempotency_records enable row level security;
alter table audit.audit_events enable row level security;
alter table integration.event_outbox enable row level security;

create policy tenant_memberships_select_self
on app.tenant_memberships for select to authenticated
using (user_id = (select auth.uid()));

create policy tenants_select_active_member
on app.tenants for select to authenticated
using (
  exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = tenants.id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  )
);

create policy locations_select_active_member
on app.locations for select to authenticated
using (
  exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = locations.tenant_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  )
);

commit;
