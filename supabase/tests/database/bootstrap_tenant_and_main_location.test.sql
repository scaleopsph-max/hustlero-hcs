begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_table('app', 'onboarding_requests', 'onboarding requests are stored privately');
select ok(
  (select relrowsecurity from pg_class where oid = 'app.onboarding_requests'::regclass),
  'onboarding request records have RLS enabled'
);
select ok(
  not has_table_privilege('hcs_hyperdrive', 'app.tenants', 'INSERT'),
  'API login cannot insert tenants directly'
);
select ok(
  not has_function_privilege(
    'anon',
    'app.bootstrap_tenant(uuid,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'anonymous database role cannot bootstrap a tenant'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'app.bootstrap_tenant(uuid,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'browser database role cannot bootstrap a tenant'
);
select ok(
  has_function_privilege(
    'hcs_hyperdrive',
    'app.bootstrap_tenant(uuid,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'restricted API login can invoke the bootstrap command'
);

insert into auth.users (id, email, aud, role, email_confirmed_at)
values (
  '11000000-0000-4000-8000-000000000001',
  'bootstrap-test@example.invalid',
  'authenticated',
  'authenticated',
  now()
);

select lives_ok(
  $$select app.bootstrap_tenant(
    '11000000-0000-4000-8000-000000000001',
    'pg-tap-onboarding', 'PG Tap Onboarding', 'PHP', 'Asia/Manila',
    'MAIN', 'Main Store', 'bootstrap-test-key-001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'test-request-001'
  )$$,
  'bootstrap transaction creates a business and main store'
);

select is(
  (select count(*)::integer from app.tenants where slug = 'pg-tap-onboarding'),
  1,
  'exactly one tenant is created'
);
select is(
  (select count(*)::integer from app.locations where code = 'MAIN' and name = 'Main Store'),
  1,
  'main store is created'
);
select is(
  (select count(*)::integer from app.tenant_memberships where user_id = '11000000-0000-4000-8000-000000000001' and is_owner and status = 'active'),
  1,
  'actor becomes active owner'
);
select is(
  (select count(*)::integer from app.roles where code = 'owner' and is_system_template),
  1,
  'owner role is created'
);
select is(
  (select count(*)::integer from app.role_permissions where permission_code in ('tenant.manage', 'locations.manage', 'onboarding.manage')),
  3,
  'owner role receives the three bootstrap permissions'
);
select is(
  (select count(*)::integer from audit.audit_events where action = 'tenant.created'),
  1,
  'tenant creation is audited'
);
select is(
  (select count(*)::integer from integration.event_outbox where topic = 'tenant.created'),
  1,
  'tenant creation emits one outbox event'
);
select ok(
  app.bootstrap_tenant(
    '11000000-0000-4000-8000-000000000001',
    'pg-tap-onboarding', 'PG Tap Onboarding', 'PHP', 'Asia/Manila',
    'MAIN', 'Main Store', 'bootstrap-test-key-001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'test-request-001'
  ) = (
    select response_body from app.onboarding_requests
    where actor_user_id = '11000000-0000-4000-8000-000000000001'
      and idempotency_key = 'bootstrap-test-key-001'
  ),
  'identical retry returns the stored response'
);
select is(
  (select count(*)::integer from app.tenants where slug = 'pg-tap-onboarding'),
  1,
  'retry does not create a second tenant'
);
select throws_ok(
  $$select app.bootstrap_tenant(
    '11000000-0000-4000-8000-000000000001',
    'different-business', 'Different Business', 'PHP', 'Asia/Manila',
    'MAIN', 'Main Store', 'bootstrap-test-key-001',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'test-request-002'
  )$$,
  'HCS01',
  'Idempotency key reused with different business details',
  'changed request cannot reuse the idempotency key'
);
select throws_ok(
  $$select app.bootstrap_tenant(
    '11000000-0000-4000-8000-000000000099',
    'unknown-owner', 'Unknown Owner', 'PHP', 'Asia/Manila',
    'MAIN', 'Main Store', 'bootstrap-test-key-099',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'test-request-099'
  )$$,
  'HCS02',
  'Authenticated account no longer exists',
  'deleted or nonexistent Auth user cannot bootstrap a tenant'
);

select * from finish();

rollback;
