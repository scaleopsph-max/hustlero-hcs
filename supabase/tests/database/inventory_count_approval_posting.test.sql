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

select is(app.list_inventory_counts('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001')->'locations'->0->>'canCreate','false','staff cannot create from the assigned branch');
select is(app.list_inventory_counts('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001')->'locations'->0->>'canEnter','true','explicitly permitted staff can enter counts');
select is(app.list_inventory_counts('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001')->'locations'->0->>'canPost','false','staff cannot post');
select is(app.list_inventory_counts('ab000000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001')->'locations'->0->>'canPost','true','assigned manager with inventory permission can post');
select is(jsonb_array_length(app.list_inventory_counts('ab000000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001')->'locations'),1,'manager does not see unassigned location capabilities');
select app.update_inventory_adjustment_approval_policy('ab000000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001',1,'count-policy-update-001','policy-hash','pcount-test');
create temp table target as select pg_temp.create_count('ab000000-0000-4000-8000-000000000002','count-approval-create-01') result;
create function pg_temp.count_enter(p_revision integer,p_key text) returns jsonb language sql as $$
 select app.enter_inventory_count('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from target),p_revision,
 '[{"variantId":"ab500000-0000-4000-8000-000000000001","countedMilli":8000},{"variantId":"ab500000-0000-4000-8000-000000000002","countedMilli":4000}]',p_key,'pcount-test');
$$;
create temp table counted as select pg_temp.count_enter(1,'count-approval-enter-001') result;
create function pg_temp.count_submit(p_revision integer,p_key text) returns jsonb language sql as $$
 select app.submit_inventory_count('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from target),p_revision,p_key,'pcount-test');
$$;
create temp table submitted as select pg_temp.count_submit(2,'count-approval-submit-01') result;
select is((select result->>'status' from submitted),'awaiting_approval','one over-threshold line requests whole-count approval');
select is((select count(*)::integer from app.inventory_count_approval_requests),1,'one request covers all lines');
select is((select sum(on_hand) from app.inventory_balances),15::numeric,'submission does not alter stock');
select is((select count(*)::integer from app.inventory_movements),0,'submission does not create movements');
select is(pg_temp.count_submit(2,'count-approval-submit-01'),(select result from submitted),'submit replay returns exact response');
select throws_ok($$select app.decide_inventory_count_approval('ab000000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from target),3,'approved',null,'count-manager-approve-01','pcount-test')$$,'HCPC0',null,'manager without approvals.manage cannot approve');
create temp table approved as select app.decide_inventory_count_approval('ab000000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from target),3,'approved',null,'count-owner-approval-01','pcount-test') result;
select is((select result->>'status' from approved),'approved','owner approves entire count');
select is((select result->>'revision' from approved),'4','approval advances revision');
select is((select count(*)::integer from app.inventory_count_approval_decisions),1,'one immutable approval decision');
select is((select sum(on_hand) from app.inventory_balances),15::numeric,'approval alone does not alter stock');
select is((select count(*)::integer from app.inventory_movements),0,'approval alone produces no stock movement');
select throws_ok($$select app.post_inventory_count('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from target),4,'Physical stock count','count-staff-post-denied','pcount-test')$$,'HCPC0',null,'staff cannot post');
update app.inventory_balances set average_unit_cost=null where variant_id='ab500000-0000-4000-8000-000000000001';
select throws_ok($$select app.post_inventory_count('ab000000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from target),4,'Physical stock count','count-no-cost-denied-01','pcount-test')$$,'HCPC4',null,'missing cost blocks entire posting');
select is((select sum(on_hand) from app.inventory_balances),15::numeric,'missing-cost denial leaves both stock balances');
update app.inventory_balances set average_unit_cost=50 where variant_id='ab500000-0000-4000-8000-000000000001';
create temp table posted as select app.post_inventory_count('ab000000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from target),4,'Physical stock count','count-manager-post-0001','pcount-test') result;
select is((select result->>'status' from posted),'posted','manager posts approved count');
select is((select sum(on_hand) from app.inventory_balances),12::numeric,'both variances post atomically');
select is((select count(*)::integer from app.inventory_movements where source_type='physical_inventory_count'),2,'each nonzero variance has a movement');
select is((select sum(quantity) from app.inventory_movements where source_type='physical_inventory_count'),-3::numeric,'movement sum equals counted variance');
select is((select sum(unit_cost) from app.inventory_movements where source_type='physical_inventory_count'),100::numeric,'movements use validated original cost');
select is(app.post_inventory_count('ab000000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from target),4,'Physical stock count','count-manager-post-0001','pcount-test'),(select result from posted),'post retry returns exact receipt');
select is((select count(*)::integer from app.inventory_movements where source_type='physical_inventory_count'),2,'post retry cannot duplicate movements');
select throws_ok($$delete from app.inventory_count_approval_decisions$$,'HCPC5',null,'approval decisions are append-only');
select throws_ok($$select app.post_inventory_count('ab000000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from target),4,'Physical stock count','count-manager-post-0002','pcount-test')$$,'HCPC3',null,'another key cannot post the count twice');

create temp table second_count as select pg_temp.create_count('ab000000-0000-4000-8000-000000000002','count-second-create-001') result;
select app.enter_inventory_count('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from second_count),1,
 '[{"variantId":"ab500000-0000-4000-8000-000000000001","countedMilli":7000},{"variantId":"ab500000-0000-4000-8000-000000000002","countedMilli":4000}]','count-second-entry-0001','pcount-test');
create temp table second_submitted as select app.submit_inventory_count('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from second_count),2,'count-second-submit-001','pcount-test') result;
select is((select result->>'status' from second_submitted),'submitted','variance equal to threshold does not require approval');
select app.update_inventory_adjustment_approval_policy('ab000000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001',0.5,'count-policy-lower-0001','policy-hash-lower','pcount-test');
select throws_ok($$select app.post_inventory_count('ab000000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from second_count),3,'Physical stock count','count-lowered-threshold','pcount-test')$$,'HCPC3',null,'current stricter threshold blocks unapproved post');
create temp table second_approval as select app.submit_inventory_count('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from second_count),3,'count-second-resubmit-01','pcount-test') result;
select is((select result->>'status' from second_approval),'awaiting_approval','resubmission requests a single approval under current policy');
update app.inventory_balances set on_hand=on_hand-1,version=version+1 where variant_id='ab500000-0000-4000-8000-000000000001';
select throws_ok($$select app.decide_inventory_count_approval('ab000000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from second_count),4,'approved',null,'count-stale-approval-01','pcount-test')$$,'HCPC4',null,'stock movement invalidates pending approval');
select is((select count(*)::integer from app.inventory_count_approval_decisions),1,'stale approval creates no decision');
select is(app.cancel_inventory_count('ab000000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001',
 (select (result->>'id')::uuid from second_count),4,'Start a fresh recount','count-stale-cancel-0001','pcount-test')->>'status','cancelled','manager can cancel stale count and start recount');
select is((select count(*)::integer from app.inventory_movements where source_type='physical_inventory_count'),2,'stale count has no additional posting');
select * from finish();
rollback;
