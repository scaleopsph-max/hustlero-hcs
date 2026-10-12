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

select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting aggregates only assigned branch');
select is(jsonb_array_length(app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'locations'),1,'load_reporting hides other branch choices');
select throws_ok($$select app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25','3d000000-0000-4000-8000-000000000001','all')$$,'HCSD2','Reporting location was not found','load_reporting rejects same-tenant unassigned location');
select throws_ok($$select app.load_reporting('1d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')$$,'HCSD0','Reporting access is not allowed','load_reporting rejects foreign tenant reader');
select ok(not has_function_privilege('authenticated','app.load_reporting(uuid,uuid,date,date,uuid,text)','execute'),'load_reporting browser execute remains denied');
select ok(has_function_privilege('hcs_hyperdrive','app.load_reporting(uuid,uuid,date,date,uuid,text)','execute'),'load_reporting API execute retained');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,250000::bigint,'load_reporting preserves owner tenant totals');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_with_inventory_policy aggregates only assigned branch');
select is(jsonb_array_length(app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'locations'),1,'load_reporting_with_inventory_policy hides other branch choices');
select throws_ok($$select app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25','3d000000-0000-4000-8000-000000000001','all')$$,'HCSD2','Reporting location was not found','load_reporting_with_inventory_policy rejects same-tenant unassigned location');
select throws_ok($$select app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')$$,'HCSD0','Reporting access is not allowed','load_reporting_with_inventory_policy rejects foreign tenant reader');
select ok(not has_function_privilege('authenticated','app.load_reporting_with_inventory_policy(uuid,uuid,date,date,uuid,text)','execute'),'load_reporting_with_inventory_policy browser execute remains denied');
select ok(has_function_privilege('hcs_hyperdrive','app.load_reporting_with_inventory_policy(uuid,uuid,date,date,uuid,text)','execute'),'load_reporting_with_inventory_policy API execute retained');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,250000::bigint,'load_reporting_with_inventory_policy preserves owner tenant totals');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_by_channel aggregates only assigned branch');
select is(jsonb_array_length(app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'locations'),1,'load_reporting_by_channel hides other branch choices');
select throws_ok($$select app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25','3d000000-0000-4000-8000-000000000001','all')$$,'HCSD2','Reporting location was not found','load_reporting_by_channel rejects same-tenant unassigned location');
select throws_ok($$select app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')$$,'HCSD0','Reporting access is not allowed','load_reporting_by_channel rejects foreign tenant reader');
select ok(not has_function_privilege('authenticated','app.load_reporting_by_channel(uuid,uuid,date,date,uuid,text)','execute'),'load_reporting_by_channel browser execute remains denied');
select ok(has_function_privilege('hcs_hyperdrive','app.load_reporting_by_channel(uuid,uuid,date,date,uuid,text)','execute'),'load_reporting_by_channel API execute retained');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,250000::bigint,'load_reporting_by_channel preserves owner tenant totals');
select is((app.load_shift_report('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,200000::bigint,'load_shift_report aggregates only assigned branch');
select is(jsonb_array_length(app.load_shift_report('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'locations'),1,'load_shift_report hides other branch choices');
select throws_ok($$select app.load_shift_report('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25','3d000000-0000-4000-8000-000000000001','all')$$,'HCSD2','Reporting location was not found','load_shift_report rejects same-tenant unassigned location');
select throws_ok($$select app.load_shift_report('1d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')$$,'HCSD0','Reporting access is not allowed','load_shift_report rejects foreign tenant reader');
select ok(not has_function_privilege('authenticated','app.load_shift_report(uuid,uuid,date,date,uuid,text)','execute'),'load_shift_report browser execute remains denied');
select ok(has_function_privilege('hcs_hyperdrive','app.load_shift_report(uuid,uuid,date,date,uuid,text)','execute'),'load_shift_report API execute retained');
select is((app.load_shift_report('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,250000::bigint,'load_shift_report preserves owner tenant totals');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'salesTrend'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting salesTrend excludes other branch');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'branches'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting branches excludes other branch');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byItem'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting byItem excludes other branch');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byCategory'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting byCategory excludes other branch');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byEmployee'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting byEmployee excludes other branch');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byPaymentType'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting byPaymentType excludes other branch');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'inventory'->>'onHandMilli')::bigint,5000::bigint,'load_reporting inventory totals exclude other branch');
select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'registers'->>'openCount')::integer,1,'load_reporting register count excludes other branch');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'salesTrend'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_with_inventory_policy salesTrend excludes other branch');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'branches'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_with_inventory_policy branches excludes other branch');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byItem'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_with_inventory_policy byItem excludes other branch');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byCategory'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_with_inventory_policy byCategory excludes other branch');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byEmployee'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_with_inventory_policy byEmployee excludes other branch');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byPaymentType'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_with_inventory_policy byPaymentType excludes other branch');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'inventory'->>'onHandMilli')::bigint,5000::bigint,'load_reporting_with_inventory_policy inventory totals exclude other branch');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'registers'->>'openCount')::integer,1,'load_reporting_with_inventory_policy register count excludes other branch');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'salesTrend'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_by_channel salesTrend excludes other branch');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'branches'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_by_channel branches excludes other branch');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byItem'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_by_channel byItem excludes other branch');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byCategory'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_by_channel byCategory excludes other branch');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byEmployee'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_by_channel byEmployee excludes other branch');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'byPaymentType'->0->>'netSalesCentavos')::bigint,200000::bigint,'load_reporting_by_channel byPaymentType excludes other branch');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'inventory'->>'onHandMilli')::bigint,5000::bigint,'load_reporting_by_channel inventory totals exclude other branch');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'registers'->>'openCount')::integer,1,'load_reporting_by_channel register count excludes other branch');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'inventory'->>'lowStockCount')::integer,1,'load_reporting_with_inventory_policy reorder count excludes other branch');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'inventory'->>'lowStockCount')::integer,1,'load_reporting_by_channel reorder count excludes other branch');
select is(jsonb_array_length(app.load_shift_report('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'sessions'),1,'shift rows exclude other branch');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'pos')->'summary'->>'netSalesCentavos')::bigint,200000::bigint,'POS channel respects branch');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'wholesale')->'summary'->>'netSalesCentavos')::bigint,0::bigint,'wholesale channel retains channel filter');

update app.employees set status='suspended' where user_id='1d000000-0000-4000-8000-000000000003';
select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,0::bigint,'load_reporting suspended employee scope');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,0::bigint,'load_reporting_with_inventory_policy suspended employee scope');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,0::bigint,'load_reporting_by_channel suspended employee scope');
select is((app.load_shift_report('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,0::bigint,'load_shift_report suspended employee scope');

update app.employees set status='active' where user_id='1d000000-0000-4000-8000-000000000003'; update app.locations set is_active=false where id='3d000000-0000-4000-8000-000000000003';
select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,0::bigint,'load_reporting inactive assigned branch scope');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,0::bigint,'load_reporting_with_inventory_policy inactive assigned branch scope');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,0::bigint,'load_reporting_by_channel inactive assigned branch scope');
select is((app.load_shift_report('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,0::bigint,'load_shift_report inactive assigned branch scope');

update app.locations set is_active=true where id='3d000000-0000-4000-8000-000000000003'; update app.employee_locations set location_id='3d000000-0000-4000-8000-000000000001' where employee_id='4d000000-0000-4000-8000-000000000003';
select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,50000::bigint,'load_reporting reassigned employee scope');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,50000::bigint,'load_reporting_with_inventory_policy reassigned employee scope');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,50000::bigint,'load_reporting_by_channel reassigned employee scope');
select is((app.load_shift_report('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,50000::bigint,'load_shift_report reassigned employee scope');

update app.tenant_memberships set status='suspended' where user_id='1d000000-0000-4000-8000-000000000003';
select throws_ok($$select app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')$$,'HCSD0','Reporting access is not allowed','load_reporting suspended membership denied');
select throws_ok($$select app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')$$,'HCSD0','Reporting access is not allowed','load_reporting_with_inventory_policy suspended membership denied');
select throws_ok($$select app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')$$,'HCSD0','Reporting access is not allowed','load_reporting_by_channel suspended membership denied');
select throws_ok($$select app.load_shift_report('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')$$,'HCSD0','Reporting access is not allowed','load_shift_report suspended membership denied');
update app.tenant_memberships set status='active' where user_id='1d000000-0000-4000-8000-000000000003';
update app.employees set user_id=null where employee_code='REPORT-READER';
select is((app.load_reporting('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,0::bigint,'reader without linked employee has no branch totals');
select is(jsonb_array_length(app.load_shift_report('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'sessions'),0,'reader without linked employee has no shift rows');
update app.employees set user_id='1d000000-0000-4000-8000-000000000003' where employee_code='REPORT-READER';
insert into app.employee_locations(tenant_id,employee_id,location_id) values
('2d000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000003','3d000000-0000-4000-8000-000000000003');
select is((app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'summary'->>'netSalesCentavos')::bigint,250000::bigint,'multiple assignments aggregate permitted branches once');
select is((app.load_reporting_with_inventory_policy('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'inventory'->>'lowStockCount')::integer,2,'multiple assignments include both reorder policies');
select is(jsonb_array_length(app.load_shift_report('1d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','2026-09-25','2026-09-25',null,'all')->'sessions'),2,'multiple assignments include both shifts');
select * from finish();
rollback;
