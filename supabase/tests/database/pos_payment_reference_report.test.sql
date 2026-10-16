begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users(id,email,aud,role) values
 ('ae000000-0000-4000-8000-000000000001','payment-ref-owner@example.invalid','authenticated','authenticated'),
 ('ae000000-0000-4000-8000-000000000002','payment-ref-foreign@example.invalid','authenticated','authenticated');
insert into app.tenants(id,slug,name) values
 ('ae100000-0000-4000-8000-000000000001','payment-ref-a','Payment ref A'),
 ('ae100000-0000-4000-8000-000000000002','payment-ref-b','Payment ref B');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
 ('ae100000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-000000000001','active',true,now()),
 ('ae100000-0000-4000-8000-000000000002','ae000000-0000-4000-8000-000000000002','active',true,now());
insert into app.locations(id,tenant_id,code,name) values
 ('ae200000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001','MAIN','Main');
insert into app.employees(id,tenant_id,employee_code,display_name) values
 ('ae300000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001','REF-1','Ref Cashier');
insert into app.employee_roles(tenant_id,employee_id,role_id)
 select 'ae100000-0000-4000-8000-000000000001','ae300000-0000-4000-8000-000000000001',id
 from app.roles where tenant_id='ae100000-0000-4000-8000-000000000001' and code='cashier';
insert into app.registers(id,tenant_id,location_id,name,code) values
 ('ae400000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001','ae200000-0000-4000-8000-000000000001','Ref register','REF');
insert into app.pos_devices(id,tenant_id,register_id,location_id,name,status,token_hash,activated_at,created_by_user_id) values
 ('ae500000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001','ae400000-0000-4000-8000-000000000001',
 'ae200000-0000-4000-8000-000000000001','Ref POS','active',repeat('e',64),now(),'ae000000-0000-4000-8000-000000000001');
insert into app.pos_employee_sessions(tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at) values
 ('ae100000-0000-4000-8000-000000000001','ae500000-0000-4000-8000-000000000001','ae400000-0000-4000-8000-000000000001',
 'ae200000-0000-4000-8000-000000000001','ae300000-0000-4000-8000-000000000001',repeat('f',64),now()+interval '1 hour');
insert into app.products(id,tenant_id,name,created_by) values
 ('ae600000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001','Ref item','ae000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,track_inventory,created_by) values
 ('ae700000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001','ae600000-0000-4000-8000-000000000001',
 'Each','REF-EACH',100,false,'ae000000-0000-4000-8000-000000000001');
insert into app.payment_methods(id,tenant_id,code,name,method_type) values
 ('ae800000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001','ref-wallet','Ref Wallet','e_wallet'),
 ('ae800000-0000-4000-8000-000000000002','ae100000-0000-4000-8000-000000000001','ref-bank','Ref Bank','bank_transfer');
select app.open_pos_register_session(repeat('f',64),0,'ref-open','ref-open-hash','ref-open-request');

create function pg_temp.ref_sale(p_ref jsonb,p_key text,p_hash text,p_method text default 'ae800000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
 select app.complete_pos_priced_sale(repeat('f',64),
 '[{"variantId":"ae700000-0000-4000-8000-000000000001","quantityMilli":1000}]',
 jsonb_build_array(jsonb_build_object('paymentMethodId',p_method,'amountCentavos',10000,'tenderedCentavos',10000)
  || case when p_ref is null then '{}'::jsonb else jsonb_build_object('referenceLastFour',p_ref) end),
 null,'retail',p_key,p_hash,p_key);
$$;
select throws_ok($$select pg_temp.ref_sale(null,'missing-ref','missing-ref-hash')$$,'HCS94',
 'Enter exactly four transaction reference digits for online payments','missing online reference rejected');
select throws_ok($$select pg_temp.ref_sale('"123"','short-ref','short-ref-hash')$$,'HCS94',
 'Enter exactly four transaction reference digits for online payments','short online reference rejected');
select throws_ok($$select pg_temp.ref_sale('47','number-ref','number-ref-hash')$$,'HCS94',
 'Enter exactly four transaction reference digits for online payments','numeric reference cannot lose leading zeros');
select is((select count(*) from app.sales where tenant_id='ae100000-0000-4000-8000-000000000001'),0::bigint,'rejections leave no sale');
select lives_ok($$select pg_temp.ref_sale('"0047"','valid-ref','valid-ref-hash')$$,'wallet sale accepted with zero-prefixed suffix');
select is((select reference_last_four from app.pos_payment_references where tenant_id='ae100000-0000-4000-8000-000000000001'),'0047','reference preserved');
select lives_ok($$select pg_temp.ref_sale('"0047"','valid-ref','valid-ref-hash')$$,'exact retry accepted');
select is((select count(*) from app.pos_payment_references where tenant_id='ae100000-0000-4000-8000-000000000001'),1::bigint,'retry does not duplicate reference');
select throws_ok($$select pg_temp.ref_sale('"0048"','valid-ref','changed-hash')$$,'HCS08','Idempotency key conflict','changed reference conflicts on original key');
select throws_ok($$update app.pos_payment_references set reference_last_four='1111'$$,'P0001','issued invoices are immutable','reference is append-only');
select lives_ok($$select pg_temp.ref_sale('"0047"','bank-ref','bank-ref-hash','ae800000-0000-4000-8000-000000000002')$$,'repeated last four on another payment is allowed');
select throws_ok($$select pg_temp.ref_sale(null,'missing-bank','missing-bank-hash','ae800000-0000-4000-8000-000000000002')$$,'HCS94',
 'Enter exactly four transaction reference digits for online payments','bank reference required');
select is((app.load_pos_payment_reference_report('ae000000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001',
 (now() at time zone 'Asia/Manila')::date,(now() at time zone 'Asia/Manila')::date)->'rows')->0->>'referenceLastFour','0047','owner report retains reference');
select is(jsonb_array_length(app.load_pos_payment_reference_report('ae000000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001',
 (now() at time zone 'Asia/Manila')::date,(now() at time zone 'Asia/Manila')::date)->'rows'),2,'report returns both payment methods');
select throws_ok($$select app.load_pos_payment_reference_report('ae000000-0000-4000-8000-000000000002','ae100000-0000-4000-8000-000000000001',current_date,current_date)$$,
 'HCSD0','Reporting access is not allowed','foreign owner denied');
select throws_ok($$select app.load_pos_payment_reference_report('ae000000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001',current_date,current_date+40)$$,
 'HCSD1','Choose a report range of at most 32 days','bounded date range');
select ok(not has_function_privilege('hcs_hyperdrive','app.complete_pos_priced_sale_reference_core(text,jsonb,jsonb,uuid,text,text,text,text)','EXECUTE'),'core cannot bypass reference validation');
select ok(not has_table_privilege('authenticated','app.pos_payment_references','SELECT'),'browser cannot read private references');
select ok((select relrowsecurity from pg_class where oid='app.pos_payment_references'::regclass),'reference RLS enabled');
select is((select count(*) from app.inventory_movements where tenant_id='ae100000-0000-4000-8000-000000000001'),0::bigint,'untracked fixture creates no stock movement');
select lives_ok($$select pg_temp.ref_sale(null,'cash-without-ref','cash-without-ref-hash',
 (select id::text from app.payment_methods where tenant_id='ae100000-0000-4000-8000-000000000001' and code='cash'))$$,'cash still needs no reference');
select lives_ok($$select app.complete_pos_priced_sale_reference_core(repeat('f',64),
 '[{"variantId":"ae700000-0000-4000-8000-000000000001","quantityMilli":1000}]',
 '[{"paymentMethodId":"ae800000-0000-4000-8000-000000000001","amountCentavos":10000,"tenderedCentavos":10000}]',
 null,'retail','legacy-ref','legacy-ref-hash','legacy-ref')$$,'simulate pre-migration online receipt without reference');
select lives_ok($$select pg_temp.ref_sale(null,'legacy-ref','legacy-ref-hash')$$,'legacy completed retry is not retroactively required to supply reference');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
 ('ae100000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-000000000002','active',false,now());
insert into app.locations(id,tenant_id,code,name) values
 ('ae200000-0000-4000-8000-000000000002','ae100000-0000-4000-8000-000000000001','BR2','Branch 2');
insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values
 ('ae300000-0000-4000-8000-000000000002','ae100000-0000-4000-8000-000000000001',
 'ae000000-0000-4000-8000-000000000002','REF-2','Restricted Reporter');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
 ('ae100000-0000-4000-8000-000000000001','ae300000-0000-4000-8000-000000000002','ae200000-0000-4000-8000-000000000002');
insert into app.role_permissions(tenant_id,role_id,permission_code)
 select 'ae100000-0000-4000-8000-000000000001',id,'reports.read' from app.roles
 where tenant_id='ae100000-0000-4000-8000-000000000001' and code='cashier' on conflict do nothing;
insert into app.membership_roles(tenant_id,user_id,role_id)
 select 'ae100000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-000000000002',id from app.roles
 where tenant_id='ae100000-0000-4000-8000-000000000001' and code='cashier';
select is(jsonb_array_length(app.load_pos_payment_reference_report('ae000000-0000-4000-8000-000000000002','ae100000-0000-4000-8000-000000000001',
 current_date,current_date)->'rows'),0,'reports.read does not expose another assigned branch payments');
select is(jsonb_array_length(app.load_pos_payment_reference_report('ae000000-0000-4000-8000-000000000002','ae100000-0000-4000-8000-000000000001',
 current_date,current_date)->'locations'),1,'location picker is branch scoped');
select throws_ok($$select app.load_pos_payment_reference_report('ae000000-0000-4000-8000-000000000002','ae100000-0000-4000-8000-000000000001',
 current_date,current_date,'ae200000-0000-4000-8000-000000000001')$$,'HCSD0','Reporting location is not allowed','explicit foreign branch denied');
select * from finish();
rollback;
