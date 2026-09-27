begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

select has_table('app','fund_accounts','fund accounts exist');
select has_table('app','fund_ledger_entries','fund ledger exists');
select has_function('app','create_basic_fund_setup',array['uuid','uuid','text','text','text'],'basic fund command exists');
select has_function('app','load_onboarding_snapshot',array['uuid','uuid'],'go-live projection exists');
select ok((select relrowsecurity from pg_class where oid='app.fund_accounts'::regclass),'fund accounts have RLS');
select ok((select relrowsecurity from pg_class where oid='app.fund_ledger_entries'::regclass),'fund ledger has RLS');
select ok(has_function_privilege('hcs_hyperdrive','app.create_basic_fund_setup(uuid,uuid,text,text,text)','execute'),'API role can create basic funds');
select ok(has_function_privilege('hcs_hyperdrive','app.load_onboarding_snapshot(uuid,uuid)','execute'),'API role can load go-live state');
select ok(not has_table_privilege('hcs_hyperdrive','app.fund_accounts','select'),'API role cannot read fund accounts directly');
select ok(not has_table_privilege('hcs_hyperdrive','app.fund_ledger_entries','select'),'API role cannot read fund ledger directly');
select has_index('app','fund_accounts','fund_accounts_tenant_status_idx','active fund lookup is indexed');
select has_index('app','fund_ledger_entries','fund_ledger_entries_account_occurred_idx','fund history is indexed');

insert into auth.users(id,email,aud,role,email_confirmed_at) values
('71000000-0000-4000-8000-000000000001','go-live-owner@example.invalid','authenticated','authenticated',now()),
('71000000-0000-4000-8000-000000000002','go-live-outsider@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name) values('72000000-0000-4000-8000-000000000001','go-live-test','Go Live Test');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','active',true,now());
insert into app.locations(id,tenant_id,code,name) values
('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','MAIN','Main Store');
insert into app.tenant_onboarding_profiles(tenant_id,business_type,sales_channels,tracks_inventory,product_setup_method,business_questions_completed_at,feature_selection_completed_at)
values('72000000-0000-4000-8000-000000000001','retail',array['in_store'],false,'manual',now(),now());

select ok((app.load_onboarding_snapshot('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001')->>'hasPaymentMethods')::boolean,'default cash method completes payment setup');
select ok(not (app.load_onboarding_snapshot('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001')->>'hasBasicFunds')::boolean,'fund setup starts pending');
select ok((app.load_onboarding_snapshot('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001')->>'hasOpeningInventory')::boolean,'non-inventory business does not require opening stock');
select ok(not (app.load_onboarding_snapshot('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001')->>'readyToSell')::boolean,'missing operational records block go-live');
select throws_ok(
  $$select app.load_onboarding_snapshot('71000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001')$$,
  'HCS03','Business setup is available to its active owner','non-owner cannot inspect setup state');

select is(app.create_basic_fund_setup('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','fund-setup-001','hash-fund','request-fund')->>'status','complete','owner can create basic funds');
select is((select count(*)::integer from app.fund_accounts where tenant_id='72000000-0000-4000-8000-000000000001' and status='active'),2,'capital and operating funds are created');
select ok((app.load_onboarding_snapshot('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001')->>'hasBasicFunds')::boolean,'fund setup completes from real accounts');
select is((select count(*)::integer from audit.audit_events where tenant_id='72000000-0000-4000-8000-000000000001' and action='onboarding.basic_funds.completed'),1,'fund setup is audited once');
select lives_ok(
  $$select app.create_basic_fund_setup('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','fund-setup-001','hash-fund','request-fund')$$,
  'identical fund setup retry succeeds');
select is((select count(*)::integer from audit.audit_events where tenant_id='72000000-0000-4000-8000-000000000001' and action='onboarding.basic_funds.completed'),1,'retry does not duplicate fund audit history');
select throws_ok(
  $$select app.create_basic_fund_setup('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','fund-setup-001','different-hash','request-conflict')$$,
  'HCS08','Idempotency key conflict','fund setup key conflict is rejected');
select throws_ok(
  $$select app.create_basic_fund_setup('71000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','fund-outsider-001','hash-outsider','request-outsider')$$,
  'HCS03','Only an active owner can complete basic fund setup','non-owner cannot create funds');

insert into app.fund_ledger_entries(tenant_id,fund_account_id,entry_type,amount,source_type,reason,actor_user_id)
select tenant_id,id,'allocation',1000,'owner_setup','Initial allocation','71000000-0000-4000-8000-000000000001'
from app.fund_accounts where tenant_id='72000000-0000-4000-8000-000000000001' and fund_type='operating';
select throws_ok(
  $$delete from app.fund_ledger_entries where tenant_id='72000000-0000-4000-8000-000000000001'$$,
  'HCS90','Fund ledger entries are append-only','fund ledger rejects deletion');
select is((select count(*)::integer from integration.event_outbox where tenant_id='72000000-0000-4000-8000-000000000001' and topic='onboarding.basic_funds.completed'),1,'fund setup emits one integration event');

select * from finish();
rollback;
