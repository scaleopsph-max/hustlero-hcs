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

insert into app.role_permissions(tenant_id,role_id,permission_code) values
('2d000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','customers.read');
insert into app.customers(id,tenant_id,customer_number,full_name,phone,origin,created_by_user_id)
values('fa000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','SCOPE-C1','Shared Customer','09123456789','backoffice','1d000000-0000-4000-8000-000000000001');
update app.sales set customer_id='fa000000-0000-4000-8000-000000000001' where tenant_id='2d000000-0000-4000-8000-000000000001';
create function pg_temp.customer_scope(p_actor uuid) returns jsonb language sql as $$
  select app.load_customer(p_actor,'2d000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001');
$$;
select is((pg_temp.customer_scope('1d000000-0000-4000-8000-000000000003')->>'totalSpendCentavos')::bigint,200000::bigint,'customer detail sums only assigned branch');
select is((pg_temp.customer_scope('1d000000-0000-4000-8000-000000000003')->>'visitCount')::int,1,'customer visits exclude other branch');
select is(jsonb_array_length(pg_temp.customer_scope('1d000000-0000-4000-8000-000000000003')->'purchases'),1,'only assigned purchase detail is returned');
select is(pg_temp.customer_scope('1d000000-0000-4000-8000-000000000003')->'purchases'->0->>'receiptNumber','BRANCH-20260925-000001','correct branch receipt is retained');
select is((pg_temp.customer_scope('1d000000-0000-4000-8000-000000000001')->>'totalSpendCentavos')::bigint,250000::bigint,'owner totals preserve refund arithmetic');
select is(jsonb_array_length(pg_temp.customer_scope('1d000000-0000-4000-8000-000000000001')->'purchases'),2,'owner retains both branches');
select is((app.list_customers('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001')->'customers'->0->>'totalSpendCentavos')::bigint,200000::bigint,'customer list total uses same branch scope');
insert into app.loyalty_transactions(tenant_id,customer_id,transaction_type,points_delta,balance_after_points,spend_per_point_centavos,sale_id,actor_user_id)
values
('2d000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','sale_earn',10,0,10000,'bd000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001'),
('2d000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','sale_earn',20,0,10000,'bd000000-0000-4000-8000-000000000003','1d000000-0000-4000-8000-000000000001');
select is(jsonb_array_length(pg_temp.customer_scope('1d000000-0000-4000-8000-000000000003')->'loyalty'->'transactions'),1,'loyalty receipt history is branch scoped');
select is((pg_temp.customer_scope('1d000000-0000-4000-8000-000000000003')->'loyalty'->>'balancePoints')::bigint,30::bigint,'spendable customer points remain shared across branches');
select is(jsonb_array_length(pg_temp.customer_scope('1d000000-0000-4000-8000-000000000001')->'loyalty'->'transactions'),2,'owner retains loyalty history');
select throws_ok($$select pg_temp.customer_scope('1d000000-0000-4000-8000-000000000002')$$,'HCSB0','Customer access is not allowed','foreign user denied');
delete from app.employee_locations where employee_id='4d000000-0000-4000-8000-000000000003';
select is(jsonb_array_length(pg_temp.customer_scope('1d000000-0000-4000-8000-000000000003')->'purchases'),0,'assignment removal removes historical receipts');
select is((pg_temp.customer_scope('1d000000-0000-4000-8000-000000000003')->>'totalSpendCentavos')::bigint,0::bigint,'assignment removal removes totals');
select is(jsonb_array_length(pg_temp.customer_scope('1d000000-0000-4000-8000-000000000003')->'loyalty'->'transactions'),0,'assignment removal removes loyalty receipt metadata');
delete from app.role_permissions where role_id='f1000000-0000-4000-8000-000000000001' and permission_code='customers.read';
select throws_ok($$select pg_temp.customer_scope('1d000000-0000-4000-8000-000000000003')$$,'HCSB0','Customer access is not allowed','capability removal denies detail');
select throws_ok($$select app.list_customers('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001')$$,'HCSB0','Customer access is not allowed','capability removal denies list');
select ok(not has_function_privilege('authenticated','app.load_customer(uuid,uuid,uuid)','execute'),'customer detail remains API only');
select ok(has_function_privilege('hcs_hyperdrive','app.load_customer(uuid,uuid,uuid)','execute'),'API customer detail entry retained');
select * from finish();
rollback;
