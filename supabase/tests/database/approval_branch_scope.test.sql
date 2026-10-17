begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
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


insert into app.role_permissions(tenant_id,role_id,permission_code)
select '2d000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001',code from app.permissions where code in ('approvals.read','approvals.manage');
insert into app.approval_requests(id,tenant_id,subject_type,location_id,variant_id,requested_quantity,requested_unit_cost,reason,requested_by) values
('ee100000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','inventory_adjustment','3d000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001',2,500,'Synthetic main','1d000000-0000-4000-8000-000000000001'),
('ee100000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001','inventory_adjustment','3d000000-0000-4000-8000-000000000003','ad000000-0000-4000-8000-000000000001',2,500,'Synthetic assigned','1d000000-0000-4000-8000-000000000001'),
('ee100000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','inventory_adjustment','3d000000-0000-4000-8000-000000000003','ad000000-0000-4000-8000-000000000001',2,500,'Synthetic second','1d000000-0000-4000-8000-000000000001');
create function pg_temp.decide(p_id uuid,p_key text) returns jsonb language sql as $$
 select app.decide_approval_request('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001',p_id,'approved','Synthetic',p_key,p_key,p_key);
$$;
create function pg_temp.effects() returns jsonb language sql as $$
 select jsonb_build_object('requests',(select jsonb_agg(to_jsonb(r) order by id) from app.approval_requests r),
 'balances',(select jsonb_agg(to_jsonb(b) order by tenant_id,location_id,variant_id) from app.inventory_balances b),
 'stock',(select count(*) from app.inventory_movements),'audit',(select count(*) from audit.audit_events),
 'outbox',(select count(*) from integration.event_outbox),'keys',(select count(*) from app.idempotency_records));
$$;
select is(jsonb_array_length(app.list_approval_center('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001')->'requests'),2,'reader sees assigned approval requests');
select is(jsonb_array_length(app.list_approval_center('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001')->'requests'),3,'owner sees all approval requests');
create temporary table baseline as select pg_temp.effects() value;
select throws_ok($$select pg_temp.decide('ee100000-0000-4000-8000-000000000001','denied')$$,'HCS25','Approval request was not found','unassigned decision denied');
select is(pg_temp.effects(),(select value from baseline),'denied decision has no stock or business effects');
select lives_ok($$select pg_temp.decide('ee100000-0000-4000-8000-000000000002','approved-one')$$,'assigned approval accepted');
select is((select on_hand from app.inventory_balances where location_id='3d000000-0000-4000-8000-000000000003'),7::numeric,'approval adds exactly two units');
select is((select average_unit_cost from app.inventory_balances where location_id='3d000000-0000-4000-8000-000000000003'),357.14::numeric,'approval weighted cost preserved');
update baseline set value=pg_temp.effects();
select lives_ok($$select pg_temp.decide('ee100000-0000-4000-8000-000000000002','approved-one')$$,'completed approval exact replay succeeds');
select throws_ok($$select pg_temp.decide('ee100000-0000-4000-8000-000000000003','approved-one')$$,'HCS08','Idempotency key conflict','cached approval binds request path');
select is(pg_temp.effects(),(select value from baseline),'replay and rejected path do not double-post');
delete from app.employee_locations where employee_id='4d000000-0000-4000-8000-000000000003';
select throws_ok($$select pg_temp.decide('ee100000-0000-4000-8000-000000000002','approved-one')$$,'HCS25','Approval request was not found','removed assignment denies completed retry');
select is(pg_temp.effects(),(select value from baseline),'scope loss leaves business truth unchanged');
delete from app.role_permissions where role_id='f1000000-0000-4000-8000-000000000001' and permission_code='approvals.manage';
select throws_ok($$select pg_temp.decide('ee100000-0000-4000-8000-000000000003','no-manage')$$,'HCS23','Approval management is not allowed','read permission cannot approve');
select throws_ok($$select app.list_approval_center('1d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001')$$,'HCS23','Approval access is not allowed','foreign tenant denied');
select ok(not has_function_privilege('hcs_hyperdrive','app.approval_decision_scope_core(uuid,uuid,uuid,text,text,text,text,text)','execute'),'old approval core private');
select * from finish();
rollback;
