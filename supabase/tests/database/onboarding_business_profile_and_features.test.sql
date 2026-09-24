begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

select has_table('app', 'tenant_onboarding_profiles', 'tenant onboarding profile table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'app.tenant_onboarding_profiles'::regclass),
  'tenant onboarding profiles have RLS enabled'
);
select ok(
  not has_table_privilege('hcs_hyperdrive', 'app.tenant_onboarding_profiles', 'INSERT'),
  'API login cannot insert onboarding profiles directly'
);
select ok(
  not has_function_privilege(
    'anon',
    'app.save_business_setup_questions(uuid,uuid,text,text[],boolean,text,text)',
    'EXECUTE'
  ),
  'anonymous role cannot save business setup questions'
);
select ok(
  not has_function_privilege(
    'anon',
    'app.save_feature_selection(uuid,uuid,text[],text)',
    'EXECUTE'
  ),
  'anonymous role cannot save feature selection'
);
select ok(
  has_function_privilege(
    'hcs_hyperdrive',
    'app.save_business_setup_questions(uuid,uuid,text,text[],boolean,text,text)',
    'EXECUTE'
  ),
  'restricted API login can save business setup questions'
);
select ok(
  has_function_privilege(
    'hcs_hyperdrive',
    'app.save_feature_selection(uuid,uuid,text[],text)',
    'EXECUTE'
  ),
  'restricted API login can save feature selection'
);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('12000000-0000-4000-8000-000000000001', 'onboarding-owner@example.invalid', 'authenticated', 'authenticated', now()),
  ('12000000-0000-4000-8000-000000000002', 'onboarding-employee@example.invalid', 'authenticated', 'authenticated', now());

insert into app.tenants (id, slug, name) values
  ('22000000-0000-4000-8000-000000000001', 'onboarding-profile-test', 'Onboarding Profile Test'),
  ('22000000-0000-4000-8000-000000000002', 'onboarding-order-test', 'Onboarding Order Test');

insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', 'active', false, now()),
  ('22000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000001', 'active', true, now());

select is(
  (select count(*)::integer from app.features where platform_available),
  8,
  'eight MVP core features are platform available'
);
select is(
  (select count(*)::integer from app.tenant_entitlements where tenant_id = '22000000-0000-4000-8000-000000000001'),
  8,
  'new tenant receives eight core feature entitlements'
);
select is(
  (select count(*)::integer from app.tenant_entitlements where tenant_id = '22000000-0000-4000-8000-000000000001' and enabled),
  3,
  'required core features start enabled'
);
select is(
  (select count(*)::integer from app.tenant_entitlements where tenant_id = '22000000-0000-4000-8000-000000000001' and not enabled),
  5,
  'optional core features start disabled'
);

select throws_ok(
  $$select app.save_business_setup_questions(
    '12000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000001',
    'retail', array['in_store'], true, 'manual', 'questions-denied'
  )$$,
  'HCS04',
  'Active tenant owner membership is required',
  'non-owner cannot save business setup questions'
);

select lives_ok(
  $$select app.save_business_setup_questions(
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'retail', array['online', 'in_store', 'online'], true, 'csv', 'questions-save-001'
  )$$,
  'owner can save valid business setup questions'
);
select is(
  (select business_type from app.tenant_onboarding_profiles where tenant_id = '22000000-0000-4000-8000-000000000001'),
  'retail',
  'business type is stored'
);
select is(
  (select sales_channels from app.tenant_onboarding_profiles where tenant_id = '22000000-0000-4000-8000-000000000001'),
  array['in_store', 'online']::text[],
  'sales channels are normalized and deduplicated'
);
select is(
  (select count(*)::integer from audit.audit_events where tenant_id = '22000000-0000-4000-8000-000000000001' and action = 'onboarding.business_questions.saved'),
  1,
  'business questions change is audited once'
);
select is(
  (select count(*)::integer from integration.event_outbox where tenant_id = '22000000-0000-4000-8000-000000000001' and topic = 'onboarding.business_questions.saved'),
  1,
  'business questions change emits one outbox event'
);
select lives_ok(
  $$select app.save_business_setup_questions(
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'retail', array['in_store', 'online'], true, 'csv', 'questions-retry-001'
  )$$,
  'identical business question retry succeeds'
);
select is(
  (select count(*)::integer from audit.audit_events where tenant_id = '22000000-0000-4000-8000-000000000001' and action = 'onboarding.business_questions.saved'),
  1,
  'identical question retry does not duplicate audit history'
);

select throws_ok(
  $$select app.save_feature_selection(
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000002',
    array['inventory'], 'features-too-early'
  )$$,
  'HCS06',
  'Business setup questions must be completed first',
  'feature selection cannot skip business questions'
);
select throws_ok(
  $$select app.save_feature_selection(
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    array['online_store'], 'features-paid-denied'
  )$$,
  'HCS07',
  'Feature selection contains an unavailable feature',
  'onboarding cannot self-entitle an unavailable paid feature'
);
select lives_ok(
  $$select app.save_feature_selection(
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    array['inventory', 'customers'], 'features-save-001'
  )$$,
  'owner can save optional core feature selection'
);
select is(
  (select count(*)::integer from app.tenant_entitlements where tenant_id = '22000000-0000-4000-8000-000000000001' and enabled and feature_code in ('inventory', 'customers')),
  2,
  'selected optional features are enabled'
);
select is(
  (select count(*)::integer from app.tenant_entitlements where tenant_id = '22000000-0000-4000-8000-000000000001' and enabled and feature_code in ('catalog', 'sales', 'reports')),
  3,
  'required features remain enabled'
);
select is(
  (select count(*)::integer from app.tenant_entitlements where tenant_id = '22000000-0000-4000-8000-000000000001' and not enabled and feature_code in ('purchasing', 'employees', 'finance')),
  3,
  'unselected optional features remain disabled'
);
select ok(
  (select feature_selection_completed_at is not null from app.tenant_onboarding_profiles where tenant_id = '22000000-0000-4000-8000-000000000001'),
  'feature selection completion is persisted'
);
select is(
  (select count(*)::integer from audit.audit_events where tenant_id = '22000000-0000-4000-8000-000000000001' and action = 'onboarding.feature_selection.saved'),
  1,
  'feature selection is audited once'
);
select is(
  (select count(*)::integer from integration.event_outbox where tenant_id = '22000000-0000-4000-8000-000000000001' and topic = 'onboarding.feature_selection.saved'),
  1,
  'feature selection emits one outbox event'
);
select lives_ok(
  $$select app.save_feature_selection(
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    array['customers', 'inventory'], 'features-retry-001'
  )$$,
  'identical feature selection retry succeeds'
);
select is(
  (select count(*)::integer from audit.audit_events where tenant_id = '22000000-0000-4000-8000-000000000001' and action = 'onboarding.feature_selection.saved'),
  1,
  'identical feature retry does not duplicate audit history'
);

select * from finish();

rollback;
