begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,aud,role) values
 ('dc000000-0000-4000-8000-000000000001','discount-pos-owner@example.invalid','authenticated','authenticated'),
 ('dc000000-0000-4000-8000-000000000002','discount-pos-foreign@example.invalid','authenticated','authenticated');
insert into app.tenants(id,slug,name) values
 ('dc100000-0000-4000-8000-000000000001','discount-pos-a','Discount POS A'),
 ('dc100000-0000-4000-8000-000000000002','discount-pos-b','Discount POS B');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
 ('dc100000-0000-4000-8000-000000000001','dc000000-0000-4000-8000-000000000001','active',true,now()),
 ('dc100000-0000-4000-8000-000000000002','dc000000-0000-4000-8000-000000000002','active',true,now());
insert into app.locations(id,tenant_id,code,name) values
 ('dc200000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001','MAIN','Main');
insert into app.employees(id,tenant_id,employee_code,display_name) values
 ('dc300000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001','REF-1','Ref Cashier');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
 ('dc100000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001','dc200000-0000-4000-8000-000000000001');
insert into app.employee_roles(tenant_id,employee_id,role_id)
 select 'dc100000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',id
 from app.roles where tenant_id='dc100000-0000-4000-8000-000000000001' and code='cashier';
insert into app.registers(id,tenant_id,location_id,name,code) values
 ('dc400000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001','dc200000-0000-4000-8000-000000000001','Ref register','REF');
insert into app.pos_devices(id,tenant_id,register_id,location_id,name,status,token_hash,activated_at,created_by_user_id) values
 ('dc500000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001','dc400000-0000-4000-8000-000000000001',
 'dc200000-0000-4000-8000-000000000001','Ref POS','active',repeat('e',64),now(),'dc000000-0000-4000-8000-000000000001');
insert into app.pos_employee_sessions(tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at) values
 ('dc100000-0000-4000-8000-000000000001','dc500000-0000-4000-8000-000000000001','dc400000-0000-4000-8000-000000000001',
 'dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',repeat('f',64),now()+interval '1 hour');
insert into app.products(id,tenant_id,name,created_by) values
 ('dc600000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001','Ref item','dc000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,track_inventory,created_by) values
 ('dc700000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001',
 'Each','REF-EACH',100,false,'dc000000-0000-4000-8000-000000000001');
insert into app.payment_methods(id,tenant_id,code,name,method_type) values
 ('dc800000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001','disc-fixture-wallet','Ref Wallet','e_wallet'),
 ('dc800000-0000-4000-8000-000000000002','dc100000-0000-4000-8000-000000000001','disc-fixture-bank','Ref Bank','bank_transfer');
select app.open_pos_register_session(repeat('f',64),0,'disc-fixture-open','disc-fixture-open-hash','disc-fixture-open-request');
update app.product_variants set retail_price=100.01,unit_cost=50,track_inventory=true where id='dc700000-0000-4000-8000-000000000001';
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,track_inventory,created_by) values
 ('dc700000-0000-4000-8000-000000000002','dc100000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001','Second','DISCOUNT-SECOND',50.03,20,true,'dc000000-0000-4000-8000-000000000001');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost) values
 ('dc100000-0000-4000-8000-000000000001','dc200000-0000-4000-8000-000000000001','dc700000-0000-4000-8000-000000000001',100,50),
 ('dc100000-0000-4000-8000-000000000001','dc200000-0000-4000-8000-000000000001','dc700000-0000-4000-8000-000000000002',10,20);
create temp table discount_pos_customer as select app.create_customer('dc000000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001',
 'Discount customer','discount-customer@example.invalid',null,null,'reseller',false,false,'discount-customer-001','discount-customer-hash','discount-customer-request') result;
insert into app.loyalty_policies(tenant_id,enabled,spend_per_point) values('dc100000-0000-4000-8000-000000000001',true,1)
on conflict(tenant_id) do update set enabled=true,spend_per_point=1;
create temp table discount_pos_definition as select app.manage_retail_discount('dc000000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001',
 '{"action":"create","name":"POS Fixed","value":{"kind":"fixed","amountMinor":101},"status":"active"}','discount-pos-definition','discount-pos-request') result;
create temp table discount_pos_foreign as select app.manage_retail_discount('dc000000-0000-4000-8000-000000000002','dc100000-0000-4000-8000-000000000002',
 '{"action":"create","name":"Foreign Fixed","value":{"kind":"fixed","amountMinor":101},"status":"active"}','discount-pos-foreign-001','discount-pos-request') result;
create function pg_temp.discount_pos_sale(p_key text,p_selection jsonb default null,p_payments jsonb default null,p_lines jsonb default null,p_pricing text default 'retail',p_token text default repeat('f',64))
returns jsonb language sql as $$
 select app.complete_pos_discounted_sale(p_token,
 coalesce(p_lines,'[{"variantId":"dc700000-0000-4000-8000-000000000001","quantityMilli":1000},{"variantId":"dc700000-0000-4000-8000-000000000002","quantityMilli":500}]'::jsonb),
 coalesce(p_payments,jsonb_build_array(jsonb_build_object('paymentMethodId',(select id from app.payment_methods where tenant_id='dc100000-0000-4000-8000-000000000001' and method_type='cash' limit 1),'amountCentavos',12402,'tenderedCentavos',13000))),
 (select (result->>'customerId')::uuid from discount_pos_customer),p_pricing,
 coalesce(p_selection,jsonb_build_object('discountId',(select result->>'id' from discount_pos_definition),'expectedRevision',1)),p_key,p_key);
$$;

create temp table refund_sale as select pg_temp.discount_pos_sale('discount-reversal-sale-001') result;
create function pg_temp.reverse_discount(p_key text,p_lines jsonb default null,p_type text default 'refund',p_sale uuid default null,p_actor uuid default 'dc000000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
select app.reverse_sale(p_actor,'dc100000-0000-4000-8000-000000000001',coalesce(p_sale,(select (result->>'saleId')::uuid from refund_sale)),p_type,p_lines,'Original net snapshot refund',p_key,p_key,'discount-reversal-test');
$$;
create function pg_temp.refund_line(p_quantity bigint default 500,p_stock boolean default true) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('saleLineId',(select id from app.sale_lines where sale_id=(select (result->>'saleId')::uuid from refund_sale) and variant_id='dc700000-0000-4000-8000-000000000001'),'quantityMilli',p_quantity,'returnToStock',p_stock));
$$;
select is(app.load_sale_archive_record('dc000000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001',(select (result->>'saleId')::uuid from refund_sale))->'discountReturnSnapshot'->>'totalMinor','12402','receipt exposes original net snapshot');
select is(jsonb_array_length(app.discount_return_snapshot('dc100000-0000-4000-8000-000000000001',(select (result->>'saleId')::uuid from refund_sale))->'lines'),2,'full line snapshot available');
select ok(not has_function_privilege('hcs_hyperdrive','app.reverse_discounted_cash_sale(uuid,uuid,uuid,text,jsonb,text,text,text)','execute'),'API cannot bypass public reversal wrapper');
select ok(not has_function_privilege('authenticated','app.discount_return_snapshot(uuid,uuid)','execute'),'browser cannot read internal valuation');
select throws_ok($$select pg_temp.reverse_discount('refund-foreign-line',jsonb_build_array(jsonb_build_object('saleLineId','dc000000-0000-4000-8000-000000000099','quantityMilli',1,'returnToStock',true)))$$,'HCSA4',null,'foreign line denied');
select throws_ok($$select pg_temp.reverse_discount('refund-too-much',pg_temp.refund_line(1001))$$,'HCSA5',null,'quantity cannot exceed original sale');
select throws_ok($$select pg_temp.reverse_discount('refund-duplicate-line',pg_temp.refund_line()||pg_temp.refund_line())$$,'HCSA2',null,'duplicate selection denied');
select throws_ok($$select pg_temp.reverse_discount('refund-empty-lines','[]')$$,'HCSA2',null,'empty selection denied');
select is((select count(*)::integer from app.refunds),0,'denied attempts post no refund');
select is((select count(*)::integer from app.cash_movements where movement_type='cash_refund'),0,'denied attempts pay no cash');
create temp table partial_refund as select pg_temp.reverse_discount('refund-half-001',pg_temp.refund_line()) result;
select is((select result->>'amountCentavos' from partial_refund),'4960','partial refund uses allocated net, never gross unit price');
select is((select result->>'saleStatus' from partial_refund),'partially_refunded','partial status');
select is((select on_hand from app.inventory_balances where variant_id='dc700000-0000-4000-8000-000000000001'),99.5::numeric,'restock actual half unit');
select is((select amount from app.cash_movements where source_id=(select (result->>'reversalId')::uuid from partial_refund)),-49.60::numeric,'cash payout exact net');
select is((select amount from app.refund_items where refund_id=(select (result->>'reversalId')::uuid from partial_refund)),49.60::numeric,'refund line exact net');
select is((select occurred_at from app.cash_movements where source_id=(select (result->>'reversalId')::uuid from partial_refund)),(select completed_at from app.refunds where id=(select (result->>'reversalId')::uuid from partial_refund)),'cash uses same effective timestamp');
select is((select occurred_at from app.inventory_movements where source_reference=(select result->>'reversalId' from partial_refund)),(select completed_at from app.refunds where id=(select (result->>'reversalId')::uuid from partial_refund)),'inventory uses same effective timestamp');
select is((select occurred_at from audit.audit_events where action='sale.refunded' and entity_id=(select (result->>'reversalId')::uuid from partial_refund)),(select completed_at from app.refunds where id=(select (result->>'reversalId')::uuid from partial_refund)),'audit uses same effective timestamp');
select is(pg_temp.reverse_discount('refund-half-001',pg_temp.refund_line()),(select result from partial_refund),'lost response replay returns exact original reversal');
select is((select count(*)::integer from app.refunds),1,'replay creates one refund');
select is((select count(*)::integer from app.payment_reversals),1,'replay creates one payment reversal');
select is((select count(*)::integer from app.cash_movements where movement_type='cash_refund'),1,'replay creates one cash payout');
select throws_ok($$select pg_temp.reverse_discount('refund-half-001',pg_temp.refund_line(400))$$,'HCS08',null,'changed body cannot reuse original key');
select throws_ok($$select pg_temp.reverse_discount('refund-after-half',pg_temp.refund_line(501))$$,'HCSA5',null,'remaining quantity enforced after partial');
select throws_ok($$select pg_temp.reverse_discount('void-after-partial',null,'void')$$,'HCSA3',null,'void cannot bypass partial history');
create temp table second_refund as select pg_temp.reverse_discount('refund-half-002',pg_temp.refund_line(500,false)) result;
select is((select result->>'amountCentavos' from second_refund),'4960','second half returns exact net remainder');
select is((select on_hand from app.inventory_balances where variant_id='dc700000-0000-4000-8000-000000000001'),99.5::numeric,'no-stock refund does not restock');
create temp table final_refund as select pg_temp.reverse_discount('refund-final-001',
jsonb_build_array(jsonb_build_object('saleLineId',(select id from app.sale_lines where sale_id=(select (result->>'saleId')::uuid from refund_sale) and variant_id='dc700000-0000-4000-8000-000000000002'),'quantityMilli',500,'returnToStock',true))) result;
select is((select result->>'amountCentavos' from final_refund),'2482','remaining fractional line exact net cents');
select is((select result->>'saleStatus' from final_refund),'refunded','full refund only after all original units selected');
select is((select sum(amount) from app.refunds),124.02::numeric,'all refunds equal original net payment exactly');
select is((select sum(points_delta)::bigint from app.loyalty_transactions),0::bigint,'full original net-spend loyalty reversed');
select is((select on_hand from app.inventory_balances where variant_id='dc700000-0000-4000-8000-000000000002'),10::numeric,'fractional shared stock restored');
select throws_ok($$select pg_temp.reverse_discount('refund-exhausted',pg_temp.refund_line())$$,'HCSA3',null,'cannot refund exhausted sale');
select is(pg_temp.reverse_discount('refund-half-001',pg_temp.refund_line()),(select result from partial_refund),'historical exact replay survives later full refund');
update app.tenant_memberships set status='suspended' where tenant_id='dc100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.reverse_discount('refund-half-001',pg_temp.refund_line())$$,'HCSA0',null,'revoked membership cannot read successful replay');
update app.tenant_memberships set status='active' where tenant_id='dc100000-0000-4000-8000-000000000001';
update app.tenants set status='suspended' where id='dc100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.reverse_discount('refund-half-001',pg_temp.refund_line())$$,'HCSA0',null,'suspended tenant cannot replay');
update app.tenants set status='active' where id='dc100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.discount_pos_sale('discount-revoked-session-denial')$$,'HCS90',null,'reactivation does not revive a revoked POS session');
insert into app.pos_employee_sessions(tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at) values
 ('dc100000-0000-4000-8000-000000000001','dc500000-0000-4000-8000-000000000001','dc400000-0000-4000-8000-000000000001',
 'dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',repeat('9',64),clock_timestamp()+interval '1 hour');
create temp table void_sale as select pg_temp.discount_pos_sale('discount-void-sale-001',null,null,null,'retail',repeat('9',64)) result;
create temp table void_result as select pg_temp.reverse_discount('discount-void-001',null,'void',(select (result->>'saleId')::uuid from void_sale)) result;
select is((select result->>'amountCentavos' from void_result),'12402','void returns original net payment');
select is((select result->>'saleStatus' from void_result),'voided','void status retained');
select is(pg_temp.reverse_discount('discount-void-001',null,'void',(select (result->>'saleId')::uuid from void_sale)),(select result from void_result),'void replay posts once');
create temp table bank_sale as select pg_temp.discount_pos_sale('discount-bank-reversal',null,'[{"paymentMethodId":"dc800000-0000-4000-8000-000000000002","amountCentavos":12402,"tenderedCentavos":12402,"referenceLastFour":"0047"}]',null,'retail',repeat('9',64)) result;
select throws_ok($$select pg_temp.reverse_discount('discount-bank-denied',null,'void',(select (result->>'saleId')::uuid from bank_sale))$$,'HCSA7',null,'bank payout still denied');
select is((select count(*)::integer from app.refunds),4,'bank rejection creates no refund');
create temp table closed_sale as select pg_temp.discount_pos_sale('discount-closed-sale',null,null,null,'retail',repeat('9',64)) result;
update app.register_sessions set status='closed',expected_cash=0,counted_cash=0,variance=0,closed_at=clock_timestamp() where tenant_id='dc100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.reverse_discount('discount-closed-denied',null,'void',(select (result->>'saleId')::uuid from closed_sale))$$,'HCSA6',null,'closed original register denied');
select is(pg_temp.reverse_discount('discount-void-001',null,'void',(select (result->>'saleId')::uuid from void_sale)),(select result from void_result),'exact success replay still works after register close');
create temp table discount_report as select app.load_reporting('dc000000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001',current_date,current_date,null,'pos') result;
select is((select result->'summary'->>'netSalesCentavos' from discount_report),'24804','report net revenue subtracts exact cash reversals');
select is((select sum((value->>'netSalesCentavos')::numeric) from discount_report,jsonb_array_elements(result->'byItem')),24804::numeric,'item totals use original discounted net, matching summary');
select is((select sum((value->>'netSalesCentavos')::numeric) from discount_report,jsonb_array_elements(result->'byCategory')),24804::numeric,'category totals use original discounted net, matching summary');
select is((select sum((value->>'netSalesCentavos')::numeric) from discount_report,jsonb_array_elements(result->'byPaymentType')),24804::numeric,'payment totals reconcile exact net sales/refunds');
select ok(not has_function_privilege('hcs_hyperdrive','app.wholesale_reporting_line_payable(uuid,uuid)','execute'),'private report helper cannot bypass report scope');
select * from finish();
rollback;
