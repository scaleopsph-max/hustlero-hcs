begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,aud,role) values
 ('ab000000-0000-4000-8000-000000000001','pcount-owner@example.invalid','authenticated','authenticated'),
 ('ab000000-0000-4000-8000-000000000002','pcount-manager@example.invalid','authenticated','authenticated'),
 ('ab000000-0000-4000-8000-000000000003','pcount-staff@example.invalid','authenticated','authenticated'),
 ('ab000000-0000-4000-8000-000000000004','pcount-foreign@example.invalid','authenticated','authenticated');
insert into app.tenants(id,slug,name) values
 ('ab100000-0000-4000-8000-000000000001','pcount-test-a','Count A'),
 ('ab100000-0000-4000-8000-000000000002','pcount-test-b','Count B');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner) values
 ('ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001','active',true),
 ('ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000002','active',false),
 ('ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000003','active',false),
 ('ab100000-0000-4000-8000-000000000002','ab000000-0000-4000-8000-000000000004','active',true);
insert into app.locations(id,tenant_id,code,name) values
 ('ab200000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','MAIN','Main'),
 ('ab200000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001','OTHER','Other');
insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values
 ('ab300000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000002','MGR','Manager'),
 ('ab300000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000003','STAFF','Staff');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
 ('ab100000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000002','ab200000-0000-4000-8000-000000000001'),
 ('ab100000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001');
insert into app.membership_roles(tenant_id,user_id,role_id)
 select 'ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000002',id from app.roles
 where tenant_id='ab100000-0000-4000-8000-000000000001' and code='manager';
insert into app.membership_roles(tenant_id,user_id,role_id)
 select 'ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000003',id from app.roles
 where tenant_id='ab100000-0000-4000-8000-000000000001' and code='cashier';
insert into app.role_permissions(tenant_id,role_id,permission_code)
 select tenant_id,id,'inventory_counts.enter' from app.roles where tenant_id='ab100000-0000-4000-8000-000000000001' and code='cashier';
update app.tenant_entitlements set entitled=true,enabled=true where tenant_id='ab100000-0000-4000-8000-000000000001' and feature_code='inventory';
insert into app.products(id,tenant_id,name,created_by) values
 ('ab400000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','Count product','ab000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,track_inventory,created_by) values
 ('ab500000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000001','Each','COUNT-1',100,50,true,'ab000000-0000-4000-8000-000000000001'),
 ('ab500000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000001','Other','COUNT-2',100,50,true,'ab000000-0000-4000-8000-000000000001');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost,version) values
 ('ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','ab500000-0000-4000-8000-000000000001',10,50,2),
 ('ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','ab500000-0000-4000-8000-000000000002',5,50,3);

create function pg_temp.create_count(p_actor uuid,p_key text,p_location uuid default 'ab200000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select app.create_inventory_count(p_actor,'ab100000-0000-4000-8000-000000000001',p_location,
 '["ab500000-0000-4000-8000-000000000001","ab500000-0000-4000-8000-000000000002"]',p_key,'count-test');
$$;
select ok(not has_table_privilege('authenticated','app.inventory_count_lines','select'),'browser cannot query count lines directly');
select ok(not has_function_privilege('hcs_hyperdrive','app.lock_inventory_count_access(uuid,uuid,uuid,text)','execute'),'API cannot bypass private access guard');
select throws_ok($$select pg_temp.create_count('ab000000-0000-4000-8000-000000000003','count-staff-denied-001')$$,'HCPC0',null,'staff count permission does not permit creation');
select throws_ok($$select pg_temp.create_count('ab000000-0000-4000-8000-000000000002','count-wrong-branch-001','ab200000-0000-4000-8000-000000000002')$$,'HCPC1',null,'manager cannot create outside assigned branch');
select throws_ok($$select pg_temp.create_count('ab000000-0000-4000-8000-000000000004','count-foreign-denied-01')$$,'HCPC0',null,'foreign tenant user denied');
create temp table created as select pg_temp.create_count('ab000000-0000-4000-8000-000000000002','count-create-manager-01') result;
select is((select result->>'status' from created),'draft','manager creates draft');
select is((select result->>'revision' from created),'1','draft starts at revision one');
select is((select jsonb_array_length(result->'lines') from created),2,'draft includes both tracked snapshot lines');
select is((select result->'lines'->0->>'expectedMilli' from created),'10000','snapshot captures original on-hand');
select is((select result->'lines'->0->>'balanceVersion' from created),'2','snapshot captures original version');
select is(pg_temp.create_count('ab000000-0000-4000-8000-000000000002','count-create-manager-01'),(select result from created),'create retry returns original draft');
select is((select count(*)::integer from app.inventory_counts),1,'create retry does not duplicate count');
select is((select sum(on_hand) from app.inventory_balances),15::numeric,'creation does not change stock');
select is((select count(*)::integer from app.inventory_movements),0,'creation does not append stock movements');
select is(pg_temp.create_count('ab000000-0000-4000-8000-000000000001','count-create-owner-0001')->>'status','draft','owner can create a count');

create function pg_temp.enter_count(p_actor uuid,p_revision integer,p_entries jsonb,p_key text) returns jsonb language sql as $$
 select app.enter_inventory_count(p_actor,'ab100000-0000-4000-8000-000000000001',(select (result->>'id')::uuid from created),p_revision,p_entries,p_key,'count-test');
$$;
create temp table entered as select pg_temp.enter_count('ab000000-0000-4000-8000-000000000003',1,
 '[{"variantId":"ab500000-0000-4000-8000-000000000001","countedMilli":8500}]','count-entry-staff-001') result;
select is((select result->>'status' from entered),'counting','authorized staff enters quantity');
select is((select result->>'revision' from entered),'2','entry advances revision');
select is((select result->'lines'->0->>'countedMilli' from entered),'8500','fractional count is exact');
select is(app.load_inventory_count('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001',(select (result->>'id')::uuid from created))->>'status','counting','authorized staff can read assigned-branch count');
select throws_ok($$select app.load_inventory_count('ab000000-0000-4000-8000-000000000004','ab100000-0000-4000-8000-000000000002',(select (result->>'id')::uuid from created))$$,'HCPC1',null,'foreign tenant cannot read count');
select is(pg_temp.enter_count('ab000000-0000-4000-8000-000000000003',1,
 '[{"variantId":"ab500000-0000-4000-8000-000000000001","countedMilli":8500}]','count-entry-staff-001'),(select result from entered),'entry retry returns original response');
select throws_ok($$select pg_temp.enter_count('ab000000-0000-4000-8000-000000000003',1,
 '[{"variantId":"ab500000-0000-4000-8000-000000000001","countedMilli":9000}]','count-entry-staff-001')$$,'HCS08',null,'key cannot be reused for different count');
select throws_ok($$select pg_temp.enter_count('ab000000-0000-4000-8000-000000000003',1,
 '[{"variantId":"ab500000-0000-4000-8000-000000000002","countedMilli":5000}]','count-stale-revision-01')$$,'HCPC3',null,'stale revision denied');
select throws_ok($$select pg_temp.enter_count('ab000000-0000-4000-8000-000000000003',2,
 '[{"variantId":"ab500000-0000-4000-8000-000000000001","countedMilli":9000,"expectedMilli":0}]','count-spoofed-data-001')$$,'HCPC2',null,'client cannot replace expected stock');
select throws_ok($$select pg_temp.enter_count('ab000000-0000-4000-8000-000000000003',2,
 '[{"variantId":"ab500000-0000-4000-8000-000000000001","countedMilli":9000},{"variantId":"ab500000-0000-4000-8000-000000000099","countedMilli":1}]','count-foreign-item-001')$$,'HCPC1',null,'foreign item denies entire entry');
select is((select counted from app.inventory_count_lines where count_id=(select (result->>'id')::uuid from created) and variant_id='ab500000-0000-4000-8000-000000000001'),8.5::numeric,'rejected mixed entry rolls back earlier row');
select is((select count(*)::integer from app.inventory_count_events where count_id=(select (result->>'id')::uuid from created)),2,'draft and first count produce append-only history');
select throws_ok($$delete from app.inventory_count_events$$,'HCPC5',null,'count history cannot be deleted');
select is((select sum(on_hand) from app.inventory_balances),15::numeric,'entry does not change stock');
select is((select count(*)::integer from app.inventory_movements),0,'entry does not create stock movements');
delete from app.role_permissions where tenant_id='ab100000-0000-4000-8000-000000000001' and permission_code='inventory_counts.enter';
select throws_ok($$select pg_temp.enter_count('ab000000-0000-4000-8000-000000000003',1,
 '[{"variantId":"ab500000-0000-4000-8000-000000000001","countedMilli":8500}]','count-entry-staff-001')$$,'HCPC0',null,'revoked staff cannot replay old result');
update app.tenants set status='suspended' where id='ab100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.create_count('ab000000-0000-4000-8000-000000000002','count-create-manager-01')$$,'HCPC0',null,'suspended tenant cannot replay old result');
select * from finish();
rollback;
