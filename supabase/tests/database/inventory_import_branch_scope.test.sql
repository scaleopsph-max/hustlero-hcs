begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function('app','load_reporting',array['uuid','uuid','date','date','uuid','text'],'reporting projection exists');
select ok(has_function_privilege('hcs_hyperdrive','app.load_reporting(uuid,uuid,date,date,uuid,text)','execute'),'API login can execute reporting projection');
select ok(not has_table_privilege('hcs_hyperdrive','app.sales','select'),'API login still cannot read sales directly');

insert into auth.users(id,email,aud,role,email_confirmed_at) values
('1d000000-0000-4000-8000-000000000001','report-a@example.invalid','authenticated','authenticated',now()),
('1d000000-0000-4000-8000-000000000002','report-b@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name,timezone) values
('2d000000-0000-4000-8000-000000000001','report-a','Report A','Asia/Manila'),
('2d000000-0000-4000-8000-000000000002','report-b','Report B','Asia/Manila');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('2d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001','active',true,now()),
('2d000000-0000-4000-8000-000000000002','1d000000-0000-4000-8000-000000000002','active',true,now());
insert into app.locations(id,tenant_id,code,name) values
('3d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','MAIN','Main Store'),
('3d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000002','MAIN','Other Store');
insert into app.employees(id,tenant_id,employee_code,display_name) values
('4d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','CASH-1','Cashier One');
insert into app.registers(id,tenant_id,location_id,name,code) values
('5d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000001','Register 1','REG-1');
insert into app.register_sessions(id,tenant_id,register_id,location_id,employee_id,status,opening_cash,opened_at) values
('6d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','5d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000001','open',1000,'2026-09-25 00:00:00+00');
insert into app.payment_methods(id,tenant_id,code,name,method_type) values
('7d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','report-cash','Report Cash','cash');
insert into app.product_categories(id,tenant_id,name,created_by) values
('8d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','Shirts','1d000000-0000-4000-8000-000000000001');
insert into app.products(id,tenant_id,name,category_id,created_by) values
('9d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','Report Shirt','8d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values
('ad000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000001','Black / Small','REPORT-SHIRT',500,300,'1d000000-0000-4000-8000-000000000001');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost) values
('2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001',9,300);
insert into app.sales(id,tenant_id,location_id,register_id,register_session_id,employee_id,receipt_number,subtotal,total,completed_at) values
('bd000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000001','5d000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000001','MAIN-20260925-000001',1000,1000,'2026-09-25 02:00:00+00');
insert into app.sale_lines(id,tenant_id,sale_id,variant_id,product_name,variant_name,sku,quantity,unit_price,unit_cost,line_total) values
('cd000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001','Report Shirt','Black / Small','REPORT-SHIRT',2,500,300,1000);
insert into app.sale_payments(id,tenant_id,sale_id,payment_method_id,amount,tendered_amount,change_amount) values
('dd000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001','7d000000-0000-4000-8000-000000000001',1000,1000,0);
insert into app.refunds(id,tenant_id,sale_id,reversal_type,amount,reason,completed_by,completed_at) values
('ed000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001','refund',500,'Report refund','1d000000-0000-4000-8000-000000000001','2026-09-25 03:00:00+00');
insert into app.refund_items(tenant_id,refund_id,sale_line_id,quantity,amount,returned_to_stock) values
('2d000000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001',1,500,true);
insert into app.payment_reversals(tenant_id,refund_id,sale_payment_id,amount) values
('2d000000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000001',500);


insert into auth.users(id,email,aud,role,email_confirmed_at) values
('1d000000-0000-4000-8000-000000000003','report-reader@example.invalid','authenticated','authenticated',now());
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('2d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000003','active',false,now());
insert into app.roles(id,tenant_id,code,name) values
('f1000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','REPORT-UAT-READ','Report UAT Read');
insert into app.role_permissions(tenant_id,role_id,permission_code) values
('2d000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','reports.read');
insert into app.membership_roles(tenant_id,user_id,role_id) values
('2d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001');
insert into app.locations(id,tenant_id,code,name) values ('3d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','BRANCH','Assigned Branch');
insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values
('4d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000003','REPORT-READER','Report Reader');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
('2d000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000003','3d000000-0000-4000-8000-000000000003');
insert into app.registers(id,tenant_id,location_id,name,code) values
('5d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000003','Branch Register','REG-B');
insert into app.register_sessions(id,tenant_id,register_id,location_id,employee_id,status,opening_cash,opened_at) values
('6d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','5d000000-0000-4000-8000-000000000003','3d000000-0000-4000-8000-000000000003','4d000000-0000-4000-8000-000000000003','open',2000,'2026-09-25 00:00:00+00');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost) values
('2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000003','ad000000-0000-4000-8000-000000000001',5,300);
insert into app.inventory_reorder_policies(tenant_id,location_id,variant_id,reorder_level,updated_by) values
('2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000003','ad000000-0000-4000-8000-000000000001',6,'1d000000-0000-4000-8000-000000000001'),
('2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001',10,'1d000000-0000-4000-8000-000000000001');
insert into app.sales(id,tenant_id,location_id,register_id,register_session_id,employee_id,receipt_number,subtotal,total,completed_at) values
('bd000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000003','5d000000-0000-4000-8000-000000000003','6d000000-0000-4000-8000-000000000003','4d000000-0000-4000-8000-000000000003','BRANCH-20260925-000001',2000,2000,'2026-09-25 02:00:00+00');
insert into app.sale_lines(id,tenant_id,sale_id,variant_id,product_name,variant_name,sku,quantity,unit_price,unit_cost,line_total) values
('cd000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000003','ad000000-0000-4000-8000-000000000001','Report Shirt','Black / Small','REPORT-SHIRT',4,500,300,2000);
insert into app.sale_payments(id,tenant_id,sale_id,payment_method_id,amount,tendered_amount,change_amount) values
('dd000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000003','7d000000-0000-4000-8000-000000000001',2000,2000,0);

update app.tenant_entitlements set enabled=true where tenant_id='2d000000-0000-4000-8000-000000000001' and feature_code='inventory';
insert into app.role_permissions(tenant_id,role_id,permission_code) values
('2d000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','inventory.manage');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values
('ab000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000001','Import','IMPORT-SCOPE',10,3.35,'1d000000-0000-4000-8000-000000000001');
create function pg_temp.preview_scope(p_actor uuid,p_branch text,p_key text) returns jsonb language sql as $$
select app.preview_inventory_import(p_actor,'2d000000-0000-4000-8000-000000000001','scope.csv','2026-10-17T00:00:00Z',
jsonb_build_array(jsonb_build_object('rowNumber',2,'branchCode',p_branch,'sku','IMPORT-SCOPE','quantityOnHand','2','unitCost','3.35','reorderLevel','1','reservedQuantity','0','damagedQuantity','0','inTransitQuantity','0')),
p_key,p_key,'scope-preview');
$$;
create function pg_temp.import_effects() returns jsonb language sql as $$
select jsonb_build_array((select count(*) from app.inventory_import_batches),(select count(*) from app.inventory_import_rows),
(select count(*) from app.inventory_balances),(select count(*) from app.inventory_movements),(select count(*) from app.inventory_reorder_policies),
(select count(*) from app.idempotency_records),(select count(*) from audit.audit_events),(select count(*) from integration.event_outbox));
$$;
create temp table import_before as select pg_temp.import_effects() effects;
select throws_ok($$select pg_temp.preview_scope('1d000000-0000-4000-8000-000000000003','MAIN','denied-preview')$$,'HCS32','Inventory import batch was not found','unassigned preview is denied');
select is(pg_temp.import_effects(),(select effects from import_before),'denied preview rolls back batch rows keys audit and outbox');
create temp table import_ids(name text primary key,id uuid);
insert into import_ids values('owner-main',(pg_temp.preview_scope('1d000000-0000-4000-8000-000000000001','MAIN','owner-main')->>'batchId')::uuid);
select throws_ok($$select app.post_inventory_import('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001',(select id from import_ids where name='owner-main'),'denied-post','denied-post','scope')$$,'HCS32','Inventory import batch was not found','other-branch owner-created batch cannot be posted');
insert into import_ids values('assigned',(pg_temp.preview_scope('1d000000-0000-4000-8000-000000000003','BRANCH','assigned-preview')->>'batchId')::uuid);
select lives_ok($$select app.post_inventory_import('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001',(select id from import_ids where name='assigned'),'assigned-post','assigned-post','scope')$$,'assigned batch posts');
select is((select on_hand from app.inventory_balances where tenant_id='2d000000-0000-4000-8000-000000000001' and location_id='3d000000-0000-4000-8000-000000000003' and variant_id='ab000000-0000-4000-8000-000000000001'),2::numeric,'exact stock quantity posted');
select is((select average_unit_cost from app.inventory_balances where tenant_id='2d000000-0000-4000-8000-000000000001' and location_id='3d000000-0000-4000-8000-000000000003' and variant_id='ab000000-0000-4000-8000-000000000001'),3.35::numeric,'exact cost preserved');
select lives_ok($$select app.reconcile_inventory_import('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001',(select id from import_ids where name='assigned'),'assigned-reconcile','assigned-reconcile','scope')$$,'assigned batch reconciles');
select is((select status from app.inventory_import_batches where id=(select id from import_ids where name='assigned')),'reconciled','batch is reconciled');
select lives_ok($$select app.post_inventory_import('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001',(select id from import_ids where name='assigned'),'assigned-post','assigned-post','scope')$$,'exact posting retry succeeds without duplication');
insert into import_ids values('second',(pg_temp.preview_scope('1d000000-0000-4000-8000-000000000003','BRANCH','second-preview')->>'batchId')::uuid);
update import_before set effects=pg_temp.import_effects();
select throws_ok($$select app.post_inventory_import('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001',(select id from import_ids where name='second'),'assigned-post','assigned-post','scope')$$,'HCS08','Idempotency key conflict','cached posting cannot be rebound to another batch');
select throws_ok($$select app.reconcile_inventory_import('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001',(select id from import_ids where name='second'),'assigned-reconcile','assigned-reconcile','scope')$$,'HCS08','Idempotency key conflict','cached reconciliation cannot be rebound');
select is(pg_temp.import_effects(),(select effects from import_before),'rebound retries have zero effects');
delete from app.employee_locations where employee_id='4d000000-0000-4000-8000-000000000003';
select throws_ok($$select pg_temp.preview_scope('1d000000-0000-4000-8000-000000000003','BRANCH','assigned-preview')$$,'HCS32','Inventory import batch was not found','preview replay rechecks assignment');
select throws_ok($$select app.post_inventory_import('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001',(select id from import_ids where name='assigned'),'assigned-post','assigned-post','scope')$$,'HCS32','Inventory import batch was not found','posting replay rechecks assignment');
select throws_ok($$select app.reconcile_inventory_import('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001',(select id from import_ids where name='assigned'),'assigned-reconcile','assigned-reconcile','scope')$$,'HCS32','Inventory import batch was not found','reconciliation replay rechecks assignment');
select is(pg_temp.import_effects(),(select effects from import_before),'revoked assignment retries have zero effects');
select throws_ok($$select app.post_inventory_import('1d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001',(select id from import_ids where name='assigned'),'foreign-post','foreign-post','scope')$$,'HCS17','Inventory management is not allowed','foreign actor denied');
delete from app.role_permissions where role_id='f1000000-0000-4000-8000-000000000001' and permission_code='inventory.manage';
select throws_ok($$select pg_temp.preview_scope('1d000000-0000-4000-8000-000000000003','BRANCH','assigned-preview')$$,'HCS17','Inventory management is not allowed','preview replay rechecks capability');
select throws_ok($$select app.post_inventory_import('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001',(select id from import_ids where name='assigned'),'assigned-post','assigned-post','scope')$$,'HCS17','Inventory management is not allowed','posting replay rechecks capability');
select ok(not has_function_privilege('hcs_hyperdrive','app.inventory_import_post_scope_core(uuid,uuid,uuid,text,text,text)','execute'),'unscoped posting core is private');
select ok(not has_function_privilege('hcs_hyperdrive','app.inventory_import_preview_scope_core(uuid,uuid,text,timestamptz,jsonb,text,text,text)','execute'),'unscoped preview core is private');
select ok(not has_function_privilege('hcs_hyperdrive','app.inventory_import_reconcile_scope_core(uuid,uuid,uuid,text,text,text)','execute'),'unscoped reconciliation core is private');
select ok(not has_function_privilege('authenticated','app.post_inventory_import(uuid,uuid,uuid,text,text,text)','execute'),'browser cannot post directly');
select ok(has_function_privilege('hcs_hyperdrive','app.post_inventory_import(uuid,uuid,uuid,text,text,text)','execute'),'API posting entry retained');
select * from finish();
rollback;
