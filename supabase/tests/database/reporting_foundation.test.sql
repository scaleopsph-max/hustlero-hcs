begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

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
('7d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','cash','Cash','cash');
insert into app.product_categories(id,tenant_id,code,name,created_by) values
('8d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','shirts','Shirts','1d000000-0000-4000-8000-000000000001');
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

select throws_ok($$select app.load_reporting('1d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')$$,'HCSD0','Reporting access is not allowed','cross-tenant report access is denied');
select throws_ok($$select app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-26','2026-09-25',null,'all')$$,'HCSD1','Reporting filters are invalid','inverted dates are rejected');
select throws_ok($$select app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25','3d000000-0000-4000-8000-000000000002','all')$$,'HCSD2','Reporting location was not found','foreign tenant location is rejected');

select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'grossSalesCentavos')::bigint,100000::bigint,'gross sales use committed sale truth');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'refundsCentavos')::bigint,50000::bigint,'refunds use reversal truth');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,50000::bigint,'net sales reconcile gross less refunds');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'cogsCentavos')::bigint,30000::bigint,'COGS reverses returned quantity cost');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'grossProfitCentavos')::bigint,20000::bigint,'gross profit reconciles net sales less COGS');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'transactionCount')::integer,1,'transaction count uses completed sale count');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'salesTrend'->0->>'netSalesCentavos')::bigint,50000::bigint,'daily trend reconciles summary');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'branches'->0->>'netSalesCentavos')::bigint,50000::bigint,'branch total reconciles summary');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byItem'->0->>'quantityMilli')::bigint,1000::bigint,'item report nets refunded quantity');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byCategory'->0->>'netSalesCentavos')::bigint,50000::bigint,'category report reconciles net sales');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byEmployee'->0->>'grossProfitCentavos')::bigint,20000::bigint,'employee report reconciles gross profit');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byPaymentType'->0->>'netSalesCentavos')::bigint,50000::bigint,'payment report nets payment reversals');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'inventory'->>'valuationCentavos')::bigint,270000::bigint,'inventory valuation uses current balance and average cost');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'registers'->>'openCount')::integer,1,'dashboard shows open registers');
select is(jsonb_array_length(app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25','3d000000-0000-4000-8000-000000000001','pos')->'inventoryItems'),1,'location and POS channel scope is accepted');
select is((select count(*)::integer from app.role_permissions rp join app.roles r on r.tenant_id=rp.tenant_id and r.id=rp.role_id where r.tenant_id='2d000000-0000-4000-8000-000000000001' and r.code='owner' and rp.permission_code='reports.read'),1,'owner role receives reporting permission');

select * from finish();
rollback;
