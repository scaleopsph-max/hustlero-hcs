begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,aud,role,email_confirmed_at) values
 ('17000000-0000-4000-8000-000000000001','discount-owner@example.invalid','authenticated','authenticated',now()),
 ('17000000-0000-4000-8000-000000000002','discount-cashier@example.invalid','authenticated','authenticated',now()),
 ('17000000-0000-4000-8000-000000000003','discount-manager@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name) values
 ('27000000-0000-4000-8000-000000000001','discount-test-one','Discount One'),
 ('27000000-0000-4000-8000-000000000002','discount-test-two','Discount Two');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner) values
 ('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','active',true),
 ('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002','active',false),
 ('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000003','active',false);
insert into app.roles(id,tenant_id,code,name) values
 ('37000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001','cashier','Cashier'),
 ('37000000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000001','manager','Manager');
insert into app.membership_roles(tenant_id,user_id,role_id) values
 ('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000001'),
 ('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000003','37000000-0000-4000-8000-000000000002');
create function pg_temp.discount(p_body jsonb,p_key text,p_actor uuid default '17000000-0000-4000-8000-000000000001',p_tenant uuid default '27000000-0000-4000-8000-000000000001')
returns jsonb language sql as $$select app.manage_retail_discount(p_actor,p_tenant,p_body,p_key,'discount-test')$$;
create function pg_temp.discounts(p_id uuid default null,p_revision integer default null,p_actor uuid default '17000000-0000-4000-8000-000000000001',p_tenant uuid default '27000000-0000-4000-8000-000000000001')
returns jsonb language sql as $$select app.load_retail_discounts(p_actor,p_tenant,p_id,p_revision)$$;
create temp table discount_state as select pg_temp.discount('{"action":"create","name":" Fixed ","value":{"kind":"fixed","amountMinor":123},"status":"inactive"}','discount-create-key-001') result;
select is((select result->>'name' from discount_state),'Fixed','trimmed canonical name');
select is((select result->>'revision' from discount_state),'1','first revision');
select is((select result->>'scope' from discount_state),'retail_ticket','retail ticket only');
select is((select result->'value'->>'amountMinor' from discount_state),'123','exact minor units');
select is(jsonb_array_length(pg_temp.discounts()->'discounts'),1,'tenant-scoped list');
select is(pg_temp.discounts((select (result->>'id')::uuid from discount_state),1),(select result from discount_state),'exact immutable revision proof');
select is(pg_temp.discount('{"action":"create","name":" Fixed ","value":{"kind":"fixed","amountMinor":123},"status":"inactive"}','discount-create-key-001'),(select result from discount_state),'original command replay');
select throws_ok($$select pg_temp.discount('{"action":"create","name":"fixed","value":{"kind":"fixed","amountMinor":123},"status":"active"}','discount-duplicate-001')$$,'23505',null,'normalized duplicate denied');
select throws_ok($$select pg_temp.discount('{"action":"create","name":"Other","value":{"kind":"fixed","amountMinor":123},"status":"active"}','discount-create-key-001')$$,'HCS08','Request key conflict','changed body cannot reuse key');
select throws_ok($$select pg_temp.discount('{"action":"create","name":"Other","value":{"kind":"fixed","amountMinor":123},"status":"active"}','discount-cashier-001','17000000-0000-4000-8000-000000000002')$$,'HCDI0','Discount management denied','apply-only cashier cannot manage');
select throws_ok($$select pg_temp.discounts(null,null,'17000000-0000-4000-8000-000000000002')$$,'HCDI0','Discount management denied','apply-only cashier cannot read private management history');
select throws_ok($$select pg_temp.discounts(null,null,'17000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000002')$$,'HCDI0','Discount management denied','foreign tenant denied');
select lives_ok($$select pg_temp.discounts(null,null,'17000000-0000-4000-8000-000000000003')$$,'manager default management permission');
select ok(exists(select 1 from app.role_permissions where role_id='37000000-0000-4000-8000-000000000001' and permission_code='discounts.apply'),'cashier default apply permission');
select ok(not exists(select 1 from app.role_permissions where role_id='37000000-0000-4000-8000-000000000001' and permission_code='discounts.manage'),'cashier never defaults to manage');

select throws_ok(format('select pg_temp.discount(%L::jsonb,%L)',jsonb_build_object('action','update','discountId',(select result->>'id' from discount_state),'expectedRevision',2,'name','Fixed','value',jsonb_build_object('kind','percent','rateBps',1000),'status','active'),'discount-wrong-revision'),'HCDI4','Discount revision conflict','stale revision denied');
select lives_ok(format('select pg_temp.discount(%L::jsonb,%L)',jsonb_build_object('action','update','discountId',(select result->>'id' from discount_state),'expectedRevision',1,'name','Renamed','value',jsonb_build_object('kind','percent','rateBps',1250),'status','active'),'discount-update-key-001'),'update changes configuration');
select is((pg_temp.discounts((select (result->>'id')::uuid from discount_state),2)->'value'->>'rateBps'),'1250','percentage revision retained');
select is(pg_temp.discounts((select (result->>'id')::uuid from discount_state),1),(select result from discount_state),'old revision survives edit');
select is(pg_temp.discount('{"action":"create","name":" Fixed ","value":{"kind":"fixed","amountMinor":123},"status":"inactive"}','discount-create-key-001'),(select result from discount_state),'replay returns original snapshot after later edit');
select lives_ok(format('select pg_temp.discount(%L::jsonb,%L)',jsonb_build_object('action','archive','discountId',(select result->>'id' from discount_state),'expectedRevision',2),'discount-archive-key-001'),'archive creates new revision');
select is(jsonb_array_length(pg_temp.discounts((select (result->>'id')::uuid from discount_state))->'versions'),3,'all three versions kept');
select is(pg_temp.discounts((select (result->>'id')::uuid from discount_state),1),(select result from discount_state),'exact old version survives archive');
select throws_ok(format('select pg_temp.discount(%L::jsonb,%L)',jsonb_build_object('action','archive','discountId',(select result->>'id' from discount_state),'expectedRevision',3),'discount-archive-again'),'HCDI3','Discount history is immutable','archived definition cannot change');
select throws_ok($$update app.retail_discount_versions set snapshot='{}'$$,'HCDI3','Discount history is immutable','version update rejected');
select throws_ok($$delete from app.retail_discount_versions$$,'HCDI3','Discount history is immutable','version deletion rejected');
select throws_ok($$delete from app.retail_discounts$$,'HCDI3','Discount history is immutable','definition deletion rejected');
select throws_ok($$select pg_temp.discounts('47000000-0000-4000-8000-000000000001')$$,'HCDI5','Discount not found','unknown history is not leaked');
select throws_ok($$select pg_temp.discounts('47000000-0000-4000-8000-000000000001',1)$$,'HCDI5','Discount not found','unknown exact revision denied');

select throws_ok(format('select pg_temp.discount(%L::jsonb,%L)',body,'discount-invalid-'||row_number() over()),'HCDI2','Invalid discount command','strict SQL command validation') from (values
 ('{"action":"create","name":"Invalid","value":{"kind":"percent","rateBps":10000},"status":"active"}'::jsonb),
 ('{"action":"create","name":"Invalid","value":{"kind":"fixed","amountMinor":0},"status":"active"}'),
 ('{"action":"create","name":"Invalid","value":{"kind":"fixed","amountMinor":1.5},"status":"active"}'),
 ('{"action":"create","name":"Invalid","value":{"kind":"fixed","amountMinor":"100"},"status":"active"}'),
 ('{"action":"create","name":"Invalid","value":{"kind":"fixed","amountMinor":100,"rateBps":10},"status":"active"}'),
 ('{"action":"create","name":"Invalid","value":{"kind":"fixed"},"status":"active"}'),
 ('{"action":"create","name":"Invalid","value":{"kind":"fixed","amountMinor":100},"status":"archived"}'),
 ('{"action":"create","name":"Invalid","value":{"kind":"fixed","amountMinor":100},"status":"active","tenantId":"injected"}'),
 ('{"action":"archive","discountId":"47000000-0000-4000-8000-000000000001","expectedRevision":1.5}'),
 ('null'),('[]'),('{}')
) invalid(body);
select is((select count(*)::integer from app.retail_discounts),1,'rejected commands have no effects');
select is((select count(*)::integer from audit.audit_events where tenant_id='27000000-0000-4000-8000-000000000001' and action like 'retail.discount.%'),3,'one audit per successful command');
select is((select count(*)::integer from integration.event_outbox where tenant_id='27000000-0000-4000-8000-000000000001' and topic like 'retail.discount.%'),3,'one event per successful command');
select ok(not has_table_privilege('hcs_hyperdrive','app.retail_discounts','insert'),'API cannot bypass guarded writes');
select ok(not has_table_privilege('authenticated','app.retail_discount_versions','select'),'browser cannot read versions directly');
select ok(not has_function_privilege('anon','app.manage_retail_discount(uuid,uuid,jsonb,text,text)','execute'),'anonymous command denied');
select ok(not has_function_privilege('authenticated','app.load_retail_discounts(uuid,uuid,uuid,integer)','execute'),'browser direct loader denied');
select ok((select relrowsecurity from pg_class where oid='app.retail_discounts'::regclass),'definitions RLS enabled');
select ok((select relrowsecurity from pg_class where oid='app.retail_discount_versions'::regclass),'versions RLS enabled');
select ok(not exists(select 1 from app.retail_discounts d join audit.audit_events a on a.entity_id=d.id and a.action='retail.discount.archive' join integration.event_outbox e on e.aggregate_id=d.id and e.topic=a.action where d.updated_at<>a.occurred_at or d.updated_at<>e.created_at),'definition audit/event share one command timestamp');
update app.tenant_entitlements set ends_at=clock_timestamp()-interval '1 second' where tenant_id='27000000-0000-4000-8000-000000000001' and feature_code='sales';
select throws_ok($$select pg_temp.discount('{"action":"create","name":" Fixed ","value":{"kind":"fixed","amountMinor":123},"status":"inactive"}','discount-create-key-001')$$,'HCDI1','Sales unavailable','expired entitlement denies even completed replay');
update app.tenant_entitlements set ends_at=null where tenant_id='27000000-0000-4000-8000-000000000001' and feature_code='sales';
delete from app.role_permissions where role_id='37000000-0000-4000-8000-000000000002' and permission_code='discounts.manage';
select throws_ok($$select pg_temp.discounts(null,null,'17000000-0000-4000-8000-000000000003')$$,'HCDI0','Discount management denied','revoked management denied');
update app.tenants set status='suspended' where id='27000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.discounts()$$,'HCDI0','Discount management denied','suspended tenant denied');
select * from finish();
rollback;
