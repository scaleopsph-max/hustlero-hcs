begin;

create extension if not exists pgtap with schema extensions;
select plan(31);

select has_table('app','refunds','refund headers exist');
select has_table('app','refund_items','refund items exist');
select has_table('app','payment_reversals','payment reversals exist');
select has_function('app','load_sale_receipt',array['uuid','uuid','uuid'],'receipt detail query exists');
select has_function('app','reverse_sale',array['uuid','uuid','uuid','text','jsonb','text','text','text','text'],'atomic sale reversal exists');
select ok(has_function_privilege('hcs_hyperdrive','app.reverse_sale(uuid,uuid,uuid,text,jsonb,text,text,text,text)','execute'),'API login can execute reversals');
select ok(not has_table_privilege('hcs_hyperdrive','app.refunds','select'),'API login cannot read refunds directly');
select ok((select relrowsecurity from pg_class where oid='app.refunds'::regclass),'refunds use RLS');

insert into auth.users(id,email,aud,role,email_confirmed_at) values('19100000-0000-4000-8000-000000000001','sale-reversal-owner@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name) values('29100000-0000-4000-8000-000000000001','sale-reversal-test','Sale Reversal Test');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values('29100000-0000-4000-8000-000000000001','19100000-0000-4000-8000-000000000001','active',true,now());
insert into app.locations(id,tenant_id,code,name) values('39100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001','MAIN','Main Store');
insert into app.employees(id,tenant_id,employee_code,display_name) values('49100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001','CASH-1','Cashier One');
insert into app.employee_locations(tenant_id,employee_id,location_id) values('29100000-0000-4000-8000-000000000001','49100000-0000-4000-8000-000000000001','39100000-0000-4000-8000-000000000001');
insert into app.employee_roles(tenant_id,employee_id,role_id) select '29100000-0000-4000-8000-000000000001','49100000-0000-4000-8000-000000000001',id from app.roles where tenant_id='29100000-0000-4000-8000-000000000001' and code='cashier';
insert into app.registers(id,tenant_id,location_id,name,code) values('59100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001','39100000-0000-4000-8000-000000000001','Register 1','REG-1');
insert into app.pos_devices(id,tenant_id,register_id,location_id,name,status,token_hash,activated_at,created_by_user_id) values('69100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001','59100000-0000-4000-8000-000000000001','39100000-0000-4000-8000-000000000001','Test POS','active',repeat('c',64),now(),'19100000-0000-4000-8000-000000000001');
insert into app.pos_employee_sessions(tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at) values('29100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000001','59100000-0000-4000-8000-000000000001','39100000-0000-4000-8000-000000000001','49100000-0000-4000-8000-000000000001',repeat('d',64),now()+interval '1 hour');
insert into app.products(id,tenant_id,name,created_by) values('79100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001','Triple Black','19100000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values('89100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000001','Small','TB-S',899.00,450.00,'19100000-0000-4000-8000-000000000001');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost) values('29100000-0000-4000-8000-000000000001','39100000-0000-4000-8000-000000000001','89100000-0000-4000-8000-000000000001',10.000,450.00);

select lives_ok($$select app.open_pos_register_session(repeat('d',64),100000,'reversal-register-open','open-hash','open-request')$$,'register opens');
select lives_ok($$select app.complete_pos_cash_sale(repeat('d',64),jsonb_build_array(jsonb_build_object('variantId','89100000-0000-4000-8000-000000000001','quantityMilli',4000)),400000,'reversal-sale-one','sale-one-hash','sale-one-request')$$,'first cash sale completes');

select lives_ok($$select app.reverse_sale('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',(select id from app.sales order by created_at limit 1),'refund',jsonb_build_array(jsonb_build_object('saleLineId',(select id from app.sale_lines order by created_at limit 1),'quantityMilli',1000,'returnToStock',true)),'Customer return','reversal-refund-one','refund-hash','refund-request')$$,'partial refund completes');
select is((select status from app.sales order by created_at limit 1),'partially_refunded','sale is partially refunded');
select is((select amount from app.refunds where reversal_type='refund'),899.00::numeric,'refund amount is server-priced');
select is((select quantity from app.refund_items),1.000::numeric,'refund item stores exact quantity');
select is((select on_hand from app.inventory_balances),7.000::numeric,'returned item restores inventory');
select is((select amount from app.cash_movements where movement_type='cash_refund'),(-899.00)::numeric,'cash refund is appended');
select is((select count(*)::integer from app.inventory_movements where movement_type='REFUND'),1,'refund inventory movement is appended');
select is((select count(*)::integer from audit.audit_events where action='sale.refunded'),1,'refund is audited');
select is((select count(*)::integer from integration.event_outbox where topic='sale.refunded'),1,'refund emits an outbox event');
select lives_ok($$select app.reverse_sale('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',(select id from app.sales order by created_at limit 1),'refund',jsonb_build_array(jsonb_build_object('saleLineId',(select id from app.sale_lines order by created_at limit 1),'quantityMilli',1000,'returnToStock',true)),'Customer return','reversal-refund-one','refund-hash','refund-retry')$$,'identical refund retry returns stored response');
select is((select count(*)::integer from app.refunds),1,'idempotent retry creates no second refund');
select throws_ok($$select app.reverse_sale('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',(select id from app.sales order by created_at limit 1),'refund',jsonb_build_array(jsonb_build_object('saleLineId',(select id from app.sale_lines order by created_at limit 1),'quantityMilli',4000,'returnToStock',true)),'Excess return','reversal-refund-two','refund-two-hash','refund-two-request')$$,'HCSA5','Refund quantity exceeds the remaining quantity','over-refund is rejected');

select lives_ok($$select app.complete_pos_cash_sale(repeat('d',64),jsonb_build_array(jsonb_build_object('variantId','89100000-0000-4000-8000-000000000001','quantityMilli',2000)),200000,'reversal-sale-two','sale-two-hash','sale-two-request')$$,'second cash sale completes');
select lives_ok($$select app.reverse_sale('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',(select id from app.sales where receipt_number like '%-000002'),'void',null,'Duplicate sale','reversal-void-one','void-hash','void-request')$$,'completed sale is voided');
select is((select status from app.sales where receipt_number like '%-000002'),'voided','void updates sale status');
select is((select amount from app.refunds where reversal_type='void'),1798.00::numeric,'void reverses full sale amount');
select is((select on_hand from app.inventory_balances),7.000::numeric,'void restores all second-sale stock');
select is((select count(*)::integer from app.payment_reversals),2,'payment reversals are linked to both actions');
select is((select count(*)::integer from app.cash_movements where movement_type='cash_refund'),2,'refund and void both append cash reversals');
select is((app.load_sale_receipt('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',(select id from app.sales where receipt_number like '%-000002'))->>'status'),'voided','receipt detail exposes final status');
select is((select (entry->>'netCentavos')::bigint from jsonb_array_elements(app.list_sales('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',100)->'sales') entry where entry->>'receiptNumber' like '%-000002'),0::bigint,'sales list exposes zero net for void');

select * from finish();
rollback;
