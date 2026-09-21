begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select has_schema('app', 'app schema exists');
select has_schema('audit', 'audit schema exists');
select has_schema('integration', 'integration schema exists');
select has_schema('reporting', 'reporting schema exists');

select has_table('app', 'tenants', 'tenants table exists');
select has_table('app', 'locations', 'locations table exists');
select has_table('app', 'tenant_memberships', 'tenant memberships table exists');
select has_table('app', 'employees', 'employees table exists');
select has_table('app', 'roles', 'roles table exists');
select has_table('audit', 'audit_events', 'audit events table exists');
select has_table('integration', 'event_outbox', 'event outbox table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'app.tenants'::regclass),
  'tenants has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app.locations'::regclass),
  'locations has RLS enabled'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'app'),
  11,
  'only the reviewed browser and API context policies are present'
);

select * from finish();

rollback;
