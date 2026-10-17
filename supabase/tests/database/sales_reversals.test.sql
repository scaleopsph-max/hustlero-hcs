begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

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

select lives_ok($$select app.reverse_sale('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',(select id from app.sales where tenant_id='29100000-0000-4000-8000-000000000001' order by created_at limit 1),'refund',jsonb_build_array(jsonb_build_object('saleLineId',(select id from app.sale_lines where tenant_id='29100000-0000-4000-8000-000000000001' order by created_at limit 1),'quantityMilli',1000,'returnToStock',true)),'Customer return','reversal-refund-one','refund-hash','refund-request')$$,'partial refund completes');
select is((select status from app.sales where tenant_id='29100000-0000-4000-8000-000000000001' order by created_at limit 1),'partially_refunded','sale is partially refunded');
select is((select amount from app.refunds where tenant_id='29100000-0000-4000-8000-000000000001' and reversal_type='refund'),899.00::numeric,'refund amount is server-priced');
select is((select quantity from app.refund_items where tenant_id='29100000-0000-4000-8000-000000000001'),1.000::numeric,'refund item stores exact quantity');
select is((select on_hand from app.inventory_balances where tenant_id='29100000-0000-4000-8000-000000000001'),7.000::numeric,'returned item restores inventory');
select is((select amount from app.cash_movements where tenant_id='29100000-0000-4000-8000-000000000001' and movement_type='cash_refund'),(-899.00)::numeric,'cash refund is appended');
select is((select count(*)::integer from app.inventory_movements where tenant_id='29100000-0000-4000-8000-000000000001' and movement_type='REFUND'),1,'refund inventory movement is appended');
select is((select count(*)::integer from audit.audit_events where tenant_id='29100000-0000-4000-8000-000000000001' and action='sale.refunded'),1,'refund is audited');
select is((select count(*)::integer from integration.event_outbox where tenant_id='29100000-0000-4000-8000-000000000001' and topic='sale.refunded'),1,'refund emits an outbox event');
select lives_ok($$select app.reverse_sale('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',(select id from app.sales where tenant_id='29100000-0000-4000-8000-000000000001' order by created_at limit 1),'refund',jsonb_build_array(jsonb_build_object('saleLineId',(select id from app.sale_lines where tenant_id='29100000-0000-4000-8000-000000000001' order by created_at limit 1),'quantityMilli',1000,'returnToStock',true)),'Customer return','reversal-refund-one','refund-hash','refund-retry')$$,'identical refund retry returns stored response');
select is((select count(*)::integer from app.refunds where tenant_id='29100000-0000-4000-8000-000000000001'),1,'idempotent retry creates no second refund');
select throws_ok($$select app.reverse_sale('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',(select id from app.sales where tenant_id='29100000-0000-4000-8000-000000000001' order by created_at limit 1),'refund',jsonb_build_array(jsonb_build_object('saleLineId',(select id from app.sale_lines where tenant_id='29100000-0000-4000-8000-000000000001' order by created_at limit 1),'quantityMilli',4000,'returnToStock',true)),'Excess return','reversal-refund-two','refund-two-hash','refund-two-request')$$,'HCSA5','Refund quantity exceeds the remaining quantity','over-refund is rejected');

select lives_ok($$select app.complete_pos_cash_sale(repeat('d',64),jsonb_build_array(jsonb_build_object('variantId','89100000-0000-4000-8000-000000000001','quantityMilli',2000)),200000,'reversal-sale-two','sale-two-hash','sale-two-request')$$,'second cash sale completes');
select lives_ok($$select app.reverse_sale('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',(select id from app.sales where tenant_id='29100000-0000-4000-8000-000000000001' and receipt_number like '%-000002'),'void',null,'Duplicate sale','reversal-void-one','void-hash','void-request')$$,'completed sale is voided');
select is((select status from app.sales where tenant_id='29100000-0000-4000-8000-000000000001' and receipt_number like '%-000002'),'voided','void updates sale status');
select is((select amount from app.refunds where tenant_id='29100000-0000-4000-8000-000000000001' and reversal_type='void'),1798.00::numeric,'void reverses full sale amount');
select is((select on_hand from app.inventory_balances where tenant_id='29100000-0000-4000-8000-000000000001'),7.000::numeric,'void restores all second-sale stock');
select is((select count(*)::integer from app.payment_reversals where tenant_id='29100000-0000-4000-8000-000000000001'),2,'payment reversals are linked to both actions');
select is((select count(*)::integer from app.cash_movements where tenant_id='29100000-0000-4000-8000-000000000001' and movement_type='cash_refund'),2,'refund and void both append cash reversals');
select is((app.load_sale_receipt('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',(select id from app.sales where tenant_id='29100000-0000-4000-8000-000000000001' and receipt_number like '%-000002'))->>'status'),'voided','receipt detail exposes final status');
select is((select (entry->>'netCentavos')::bigint from jsonb_array_elements(app.list_sales('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',100)->'sales') entry where entry->>'receiptNumber' like '%-000002'),0::bigint,'sales list exposes zero net for void');

-- A permitted manager must still be restricted to current employee branches.
insert into auth.users(id,email,aud,role,email_confirmed_at) values
 ('19100000-0000-4000-8000-000000000002','sale-branch-manager@example.invalid','authenticated','authenticated',now());
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner) values
 ('29100000-0000-4000-8000-000000000001','19100000-0000-4000-8000-000000000002','active',false);
insert into app.roles(id,tenant_id,code,name) values
 ('99100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001','SCOPE-UAT','Scoped manager');
insert into app.role_permissions(tenant_id,role_id,permission_code)
 select '29100000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000001',code
 from app.permissions where code in ('sales.read','sales.refund','sales.void');
insert into app.membership_roles(tenant_id,user_id,role_id) values
 ('29100000-0000-4000-8000-000000000001','19100000-0000-4000-8000-000000000002','99100000-0000-4000-8000-000000000001');
insert into app.locations(id,tenant_id,code,name) values
 ('39100000-0000-4000-8000-000000000002','29100000-0000-4000-8000-000000000001','OTHER','Other Branch');
insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values
 ('49100000-0000-4000-8000-000000000002','29100000-0000-4000-8000-000000000001','19100000-0000-4000-8000-000000000002','MANAGER-1','Scoped Manager');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
 ('29100000-0000-4000-8000-000000000001','49100000-0000-4000-8000-000000000002','39100000-0000-4000-8000-000000000002');

create function pg_temp.scope_read(p_function text) returns jsonb language plpgsql as $$
declare v_result jsonb;
begin
 execute format('select app.%I($1,$2,$3)',p_function) into v_result using
  '19100000-0000-4000-8000-000000000002'::uuid,'29100000-0000-4000-8000-000000000001'::uuid,
  (select id from app.sales where tenant_id='29100000-0000-4000-8000-000000000001' and status='partially_refunded');
 return v_result;
end;
$$;
create function pg_temp.scope_reverse(p_type text,p_key text) returns jsonb language sql as $$
 select app.reverse_sale('19100000-0000-4000-8000-000000000002','29100000-0000-4000-8000-000000000001',
  (select id from app.sales where tenant_id='29100000-0000-4000-8000-000000000001' and status='partially_refunded'),
  p_type,jsonb_build_array(jsonb_build_object('saleLineId',
   (select sl.id from app.sale_lines sl join app.sales s on s.tenant_id=sl.tenant_id and s.id=sl.sale_id
    where s.tenant_id='29100000-0000-4000-8000-000000000001' and s.status='partially_refunded'),
   'quantityMilli',1000,'returnToStock',true)),'Scoped UAT return',p_key,'scope-hash','scope-request');
$$;
create function pg_temp.scope_truth() returns jsonb language sql as $$
 select jsonb_build_array(
  (select count(*) from app.refunds),(select count(*) from app.refund_items),
  (select count(*) from app.payment_reversals),(select count(*) from app.cash_movements),
  (select count(*) from app.inventory_movements),(select count(*) from audit.audit_events),
  (select count(*) from integration.event_outbox),(select count(*) from app.idempotency_records),
  (select jsonb_agg(to_jsonb(b) order by location_id,variant_id) from app.inventory_balances b),
  (select jsonb_agg(to_jsonb(s) order by id) from app.sales s),
  (select jsonb_agg(to_jsonb(p) order by id) from app.sale_payments p));
$$;
create temporary table scope_before as select pg_temp.scope_truth() truth;
select throws_ok(format('select pg_temp.scope_read(%L)',f),'HCSA1','Sale was not found',f||' denies another branch')
 from (values ('load_sale_receipt'),('load_sale_receipt_with_customer'),('load_sale_archive_record')) functions(f);
select is(jsonb_array_length(app.list_sales_archive('19100000-0000-4000-8000-000000000002','29100000-0000-4000-8000-000000000001')->'sales'),0,'archive hides other branch sales');
select is(jsonb_array_length(app.list_sales('19100000-0000-4000-8000-000000000002','29100000-0000-4000-8000-000000000001')->'sales'),0,'legacy list hides other branch sales');
select throws_ok($$select pg_temp.scope_reverse('refund','scope-denied-refund')$$,'HCSA1','Sale was not found','refund cannot cross branches');
select throws_ok($$select pg_temp.scope_reverse('void','scope-denied-void')$$,'HCSA1','Sale was not found','void cannot cross branches');
select is(pg_temp.scope_truth(),(select truth from scope_before),'denials leave all business truth and idempotency rows unchanged');

update app.employee_locations set location_id='39100000-0000-4000-8000-000000000001'
 where employee_id='49100000-0000-4000-8000-000000000002';
select lives_ok($$select pg_temp.scope_read('load_sale_archive_record')$$,'assigned manager can read receipt');
select lives_ok($$select pg_temp.scope_reverse('refund','scope-success-refund')$$,'assigned manager can refund');
select is((select on_hand from app.inventory_balances where tenant_id='29100000-0000-4000-8000-000000000001'),8.000::numeric,'assigned refund restores exactly one unit');
select is((select amount from app.refunds where tenant_id='29100000-0000-4000-8000-000000000001' and reason='Scoped UAT return'),899.00::numeric,'assigned refund computes exact original unit price');
select lives_ok($$select pg_temp.scope_reverse('refund','scope-success-refund')$$,'assigned retry succeeds');
select throws_ok($$select app.reverse_sale('19100000-0000-4000-8000-000000000002','29100000-0000-4000-8000-000000000001',
 (select id from app.sales where tenant_id='29100000-0000-4000-8000-000000000001' and status='voided'),
 'refund','[]','Scoped UAT return','scope-success-refund','scope-hash','scope-other-sale')$$,
 'HCS08','Idempotency key conflict','same key cannot replay another sale even with identical body hash');
update scope_before set truth=pg_temp.scope_truth();
update app.employee_locations set location_id='39100000-0000-4000-8000-000000000002'
 where employee_id='49100000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.scope_reverse('refund','scope-success-refund')$$,'HCSA1','Sale was not found','removed assignment denies cached successful response');
select is(pg_temp.scope_truth(),(select truth from scope_before),'denied retry creates no duplicate or mutation');
update app.employee_locations set location_id='39100000-0000-4000-8000-000000000001'
 where employee_id='49100000-0000-4000-8000-000000000002';
update app.employees set status='suspended' where id='49100000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.scope_read('load_sale_receipt')$$,'HCSA1','Sale was not found','inactive employee cannot read assigned receipt');
select throws_ok($$select pg_temp.scope_reverse('refund','scope-success-refund')$$,'HCSA1','Sale was not found','inactive employee cannot replay refund');
update app.employees set status='active' where id='49100000-0000-4000-8000-000000000002';
update app.locations set is_active=false where id='39100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.scope_read('load_sale_receipt')$$,'HCSA1','Sale was not found','inactive branch fails closed for non-owner');
select lives_ok($$select app.load_sale_archive_record('19100000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001',
 (select id from app.sales where tenant_id='29100000-0000-4000-8000-000000000001' and status='voided'))$$,'owner retains historical access to inactive own branch');
select ok(not has_function_privilege(r.role_name,f.signature,'execute'),r.role_name||' cannot bypass '||f.signature)
 from (values ('anon'),('authenticated'),('hcs_hyperdrive')) r(role_name)
 cross join (values ('app.sale_receipt_scope_core(uuid,uuid,uuid)'),
 ('app.sale_archive_record_scope_core(uuid,uuid,uuid)'),
 ('app.reverse_sale_scope_core(uuid,uuid,uuid,text,jsonb,text,text,text,text)'),
 ('app.require_sale_location_access(uuid,uuid,uuid,text)')) f(signature);

select * from finish();
rollback;
