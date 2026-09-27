begin;

create extension if not exists pgtap with schema extensions;
select plan(52);

select has_table('platform','subscription_plans','subscription plan catalog exists');
select has_table('platform','subscription_plan_features','plan modules exist');
select has_table('platform','tenant_subscriptions','tenant subscription history exists');
select has_table('platform','tenant_feature_overrides','temporary add-on overrides exist');
select has_function('platform','load_subscription_context',array['uuid'],'subscription context projection exists');
select has_function('platform','create_subscription_plan',array['uuid','text','text','integer','jsonb','text','text','text'],'plan create command exists');
select has_function('platform','assign_tenant_subscription',array['uuid','uuid','uuid','timestamp with time zone','timestamp with time zone','text','text','text','text'],'assignment command exists');
select has_function('platform','create_tenant_feature_override',array['uuid','uuid','text','timestamp with time zone','text','text','text','text'],'override command exists');
select ok(has_function_privilege('hcs_hyperdrive','platform.load_subscription_context(uuid)','execute'),'API role can load subscription context');
select ok(has_function_privilege('hcs_hyperdrive','platform.create_subscription_plan(uuid,text,text,integer,jsonb,text,text,text)','execute'),'API role can create plans');
select ok(has_function_privilege('hcs_hyperdrive','platform.assign_tenant_subscription(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text)','execute'),'API role can assign plans');
select ok(has_function_privilege('hcs_hyperdrive','platform.create_tenant_feature_override(uuid,uuid,text,timestamp with time zone,text,text,text,text)','execute'),'API role can create overrides');
select ok((select relrowsecurity from pg_class where oid='platform.subscription_plans'::regclass),'plan catalog has RLS');
select ok((select relrowsecurity from pg_class where oid='platform.subscription_plan_features'::regclass),'plan modules have RLS');
select ok((select relrowsecurity from pg_class where oid='platform.tenant_subscriptions'::regclass),'subscriptions have RLS');
select ok((select relrowsecurity from pg_class where oid='platform.tenant_feature_overrides'::regclass),'overrides have RLS');
select ok(not has_table_privilege('hcs_hyperdrive','platform.subscription_plans','select'),'API role cannot read plans directly');
select ok(not has_table_privilege('hcs_hyperdrive','platform.subscription_plan_features','select'),'API role cannot read plan modules directly');
select ok(not has_table_privilege('hcs_hyperdrive','platform.tenant_subscriptions','select'),'API role cannot read subscriptions directly');
select ok(not has_table_privilege('hcs_hyperdrive','platform.tenant_feature_overrides','select'),'API role cannot read overrides directly');
select has_index('platform','subscription_plan_features','subscription_plan_features_feature_idx','feature lookup is indexed');
select has_index('platform','tenant_subscriptions','tenant_subscriptions_one_current_idx','one current subscription is enforced');
select has_index('platform','tenant_subscriptions','tenant_subscriptions_tenant_history_idx','tenant subscription history is indexed');
select has_index('platform','tenant_feature_overrides','tenant_feature_overrides_expiry_idx','override expiry is indexed');
select has_index('platform','tenant_feature_overrides','tenant_feature_overrides_created_by_idx','override actor reference is indexed');
select has_index('platform','subscription_plans','subscription_plans_created_by_idx','plan creator reference is indexed');

insert into auth.users(id,email,aud,role,email_confirmed_at) values
('61000000-0000-4000-8000-000000000001','sub-super@example.invalid','authenticated','authenticated',now()),
('61000000-0000-4000-8000-000000000002','sub-ops@example.invalid','authenticated','authenticated',now()),
('61000000-0000-4000-8000-000000000003','sub-support@example.invalid','authenticated','authenticated',now()),
('61000000-0000-4000-8000-000000000004','sub-owner@example.invalid','authenticated','authenticated',now());
insert into platform.admins(user_id,display_name,role) values
('61000000-0000-4000-8000-000000000001','Subscription Super','super_admin'),
('61000000-0000-4000-8000-000000000002','Subscription Ops','operations'),
('61000000-0000-4000-8000-000000000003','Subscription Support','support');
insert into app.tenants(id,slug,name) values('62000000-0000-4000-8000-000000000001','subscription-test','Subscription Test');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000004','active',true,now());

select throws_ok(
  $$select platform.load_subscription_context('61000000-0000-4000-8000-000000000004')$$,
  'HCSP0','Platform access is not allowed','tenant owner cannot load platform subscriptions');
select throws_ok(
  $$select platform.create_subscription_plan('61000000-0000-4000-8000-000000000003','support-plan','Support Plan',0,'[]','support-plan-001','hash-a','request-a')$$,
  'HCSP0','Subscription plan management is not allowed','support cannot create plans');

select is(
  platform.create_subscription_plan(
    '61000000-0000-4000-8000-000000000002','core-pilot','Core Pilot',14,
    '[{"featureCode":"inventory","limitValue":3}]'::jsonb,'plan-create-001','hash-plan','request-plan'
  )->>'code','core-pilot','operations can create a dynamic plan');
select is((select count(*)::integer from platform.subscription_plan_features pf join platform.subscription_plans p on p.id=pf.plan_id where p.code='core-pilot'),4,'core modules are always included with the selected add-on');
select is((select count(*)::integer from audit.audit_events where action='platform.subscription_plan.created' and entity_id=(select id from platform.subscription_plans where code='core-pilot')),1,'plan creation is audited once');
select lives_ok(
  $$select platform.create_subscription_plan('61000000-0000-4000-8000-000000000002','core-pilot','Core Pilot',14,'[{"featureCode":"inventory","limitValue":3}]','plan-create-001','hash-plan','request-plan')$$,
  'identical plan retry succeeds');
select is((select count(*)::integer from audit.audit_events where action='platform.subscription_plan.created' and entity_id=(select id from platform.subscription_plans where code='core-pilot')),1,'plan retry does not duplicate audit history');
select throws_ok(
  $$select platform.create_subscription_plan('61000000-0000-4000-8000-000000000002','different','Different',0,'[]','plan-create-001','different-hash','request-conflict')$$,
  'HCS08','Idempotency key was reused with a different subscription plan request','plan idempotency conflict is rejected');

select is(
  platform.assign_tenant_subscription(
    '61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',
    (select id from platform.subscription_plans where code='core-pilot'),null,null,'Pilot assignment',
    'subscription-assign-001','hash-assign','request-assign'
  )->>'status','active','operations can assign an active plan');
select is((select count(*)::integer from platform.tenant_subscriptions where tenant_id='62000000-0000-4000-8000-000000000001' and status='active'),1,'tenant has one current subscription');
select ok((select entitled from app.tenant_entitlements where tenant_id='62000000-0000-4000-8000-000000000001' and feature_code='inventory'),'plan materializes included module access');
select ok((select entitled from app.tenant_entitlements where tenant_id='62000000-0000-4000-8000-000000000001' and feature_code='catalog'),'plan preserves required core access');
select is((select count(*)::integer from audit.audit_events where action='platform.subscription.assigned' and tenant_id='62000000-0000-4000-8000-000000000001'),1,'assignment is audited');
select lives_ok(
  $$select platform.assign_tenant_subscription('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',(select id from platform.subscription_plans where code='core-pilot'),null,null,'Pilot assignment','subscription-assign-001','hash-assign','request-assign')$$,
  'identical assignment retry succeeds');
select is((select count(*)::integer from platform.tenant_subscriptions where tenant_id='62000000-0000-4000-8000-000000000001'),1,'assignment retry preserves one history row');

select is(
  platform.create_tenant_feature_override(
    '61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','customers',now()+interval '7 days',
    'Customer module pilot','override-create-001','hash-override','request-override'
  )->>'featureCode','customers','super admin can grant a temporary add-on');
select ok((select entitled from app.tenant_entitlements where tenant_id='62000000-0000-4000-8000-000000000001' and feature_code='customers'),'override materializes temporary access');
select ok((select ends_at is not null from app.tenant_entitlements where tenant_id='62000000-0000-4000-8000-000000000001' and feature_code='customers'),'override expiry reaches entitlement resolution');
select is((select count(*)::integer from audit.audit_events where action='platform.feature_override.created' and tenant_id='62000000-0000-4000-8000-000000000001'),1,'override is audited');
select throws_ok(
  $$select platform.create_tenant_feature_override('61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','customers',now()+interval '8 days','Duplicate pilot','override-create-002','hash-duplicate','request-duplicate')$$,
  'HCSP8','An active add-on override already exists','overlapping override is rejected');
select throws_ok(
  $$select platform.create_tenant_feature_override('61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','catalog',now()+interval '8 days','Already included','override-create-003','hash-included','request-included')$$,
  'HCSP7','Feature is already included in the current plan','plan module cannot receive a redundant override');
select throws_ok(
  $$delete from platform.tenant_subscriptions where tenant_id='62000000-0000-4000-8000-000000000001'$$,
  'HCSP5','Subscription history cannot be deleted','subscription history rejects deletion');
select throws_ok(
  $$delete from platform.tenant_feature_overrides where tenant_id='62000000-0000-4000-8000-000000000001'$$,
  'HCSP5','Subscription history cannot be deleted','override history rejects deletion');
select is(jsonb_array_length(platform.load_subscription_context('61000000-0000-4000-8000-000000000001')->'plans'),1,'context returns the live plan catalog');
select is(jsonb_array_length(platform.load_subscription_context('61000000-0000-4000-8000-000000000001')->'tenants'),1,'context returns tenant assignments');
select is((platform.load_subscription_context('61000000-0000-4000-8000-000000000003')->>'canManage')::boolean,false,'support receives a read-only subscription context');

select * from finish();
rollback;
