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
update app.tenant_entitlements set entitled=true,enabled=true where tenant_id='ab100000-0000-4000-8000-000000000001' and feature_code='inventory';
insert into app.products(id,tenant_id,name,created_by) values
 ('ab400000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','Count product','ab000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,track_inventory,created_by) values
 ('ab500000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000001','Each','COUNT-1',100,50,true,'ab000000-0000-4000-8000-000000000001'),
 ('ab500000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000001','Other','COUNT-2',100,50,true,'ab000000-0000-4000-8000-000000000001');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost,version) values
 ('ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','ab500000-0000-4000-8000-000000000001',10,50,2),
 ('ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','ab500000-0000-4000-8000-000000000002',5,50,3);


select throws_ok($$select app.set_inventory_count_staff_access('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001',true,'count-grant-denied-001','uat')$$,'HCPC0',null,'staff cannot grant access');
select throws_ok($$select app.lock_inventory_count_access('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','enter')$$,'HCPC0',null,'staff denied before grant');
create temp table grant_result as select app.set_inventory_count_staff_access('ab000000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001',true,'count-grant-owner-0001','uat') result;
select lives_ok($$select app.lock_inventory_count_access('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','enter')$$,'grant allows count entry in assigned branch');
select throws_ok($$select app.lock_inventory_count_access('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','post')$$,'HCPC0',null,'grant does not allow posting');
select throws_ok($$select app.lock_inventory_count_access('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000002','enter')$$,'HCPC1',null,'grant does not authorize another branch');
select is(app.set_inventory_count_staff_access('ab000000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001',true,'count-grant-owner-0001','uat'),(select result from grant_result),'same key returns original grant');
select is((select count(*)::integer from audit.audit_events where action='inventory_count.staff_access_changed'),1,'retry produces one audit event');
update app.employees set status='suspended' where id='ab300000-0000-4000-8000-000000000003';
select app.set_inventory_count_staff_access('ab000000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001',false,'count-revoke-owner-001','uat');
update app.employees set status='active' where id='ab300000-0000-4000-8000-000000000003';
select throws_ok($$select app.lock_inventory_count_access('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','enter')$$,'HCPC0',null,'revoke denies count entry');
select * from finish();
rollback;
