begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

select ok(
  exists (select 1 from pg_roles where rolname = 'hcs_api_context_reader'),
  'API context reader role exists'
);
select ok(
  exists (select 1 from pg_roles where rolname = 'hcs_hyperdrive'),
  'Hyperdrive login role exists'
);
select is(
  (select rolcanlogin from pg_roles where rolname = 'hcs_hyperdrive'),
  false,
  'Hyperdrive role cannot log in until provisioned outside migrations'
);
select is(
  (select rolsuper from pg_roles where rolname = 'hcs_hyperdrive'),
  false,
  'Hyperdrive role is not a superuser'
);
select is(
  (select rolbypassrls from pg_roles where rolname = 'hcs_hyperdrive'),
  false,
  'Hyperdrive role cannot bypass RLS'
);
select ok(
  pg_has_role('hcs_hyperdrive', 'hcs_api_context_reader', 'member'),
  'Hyperdrive role inherits API context reader access'
);
select ok(
  has_schema_privilege('hcs_hyperdrive', 'app', 'USAGE'),
  'Hyperdrive role can use the private app schema'
);
select ok(
  has_column_privilege('hcs_hyperdrive', 'app.tenants', 'id', 'SELECT'),
  'Hyperdrive role can read an approved tenant column'
);
select ok(
  has_column_privilege('hcs_hyperdrive', 'app.tenant_memberships', 'user_id', 'SELECT'),
  'Hyperdrive role can resolve membership by verified user ID'
);
select ok(
  not has_table_privilege('hcs_hyperdrive', 'app.tenants', 'INSERT'),
  'Hyperdrive role cannot insert tenants'
);
select ok(
  not has_table_privilege('hcs_hyperdrive', 'audit.audit_events', 'SELECT'),
  'Hyperdrive role cannot read audit events'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'app'
      and roles @> array['hcs_api_context_reader']::name[]
  ),
  8,
  'all eight API context tables have explicit reader policies'
);

set local role hcs_hyperdrive;
select is(
  (select count(id) from app.tenants),
  0::bigint,
  'Hyperdrive role can execute an RLS-protected approved-column query'
);
reset role;

select * from finish();

rollback;
