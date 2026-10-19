begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('app','wholesale_credit_notes','credit notes exist');
select has_table('app','wholesale_credit_note_lines','credit note lines exist');
select has_table('app','wholesale_customer_credit_issues','customer-credit issues exist');
select has_table('app','wholesale_credit_applications','explicit credit applications exist');
select has_table('app','wholesale_credit_payouts','separate payouts exist');
select ok(not has_table_privilege('authenticated','app.wholesale_credit_notes','select,insert,update,delete'),'browser cannot directly access credit notes');
select ok(not has_table_privilege('hcs_hyperdrive','app.wholesale_credit_payouts','select,insert,update,delete'),'API cannot directly mutate payouts');
select ok(has_function_privilege('hcs_hyperdrive','app.post_wholesale_return(uuid,uuid,jsonb,text,text,text)','execute'),'API can execute narrow return command');
select ok(not has_function_privilege('anon','app.post_wholesale_return(uuid,uuid,jsonb,text,text,text)','execute'),'anonymous cannot execute return command');
select ok(not has_function_privilege('hcs_hyperdrive','app.wholesale_statement_before_credit_notes(uuid,uuid,date,uuid,uuid)','execute'),'unadjusted statement cannot bypass wrapper');
select ok(not has_function_privilege('hcs_hyperdrive','app.wholesale_funds_before_credit_notes(uuid,uuid,jsonb,text,text,text)','execute'),'unguarded fund command is private');

create temporary table aw4_fixture(invoice_id uuid,line_id uuid,customer_id uuid,method_id uuid,note_id uuid,application_id uuid,target_id uuid,session_id uuid);
do $$
declare a uuid:='1b000000-0000-4000-8000-000000000001'; t uuid:='2b000000-0000-4000-8000-000000000001';
 l uuid:='3b000000-0000-4000-8000-000000000001'; p uuid:='4b000000-0000-4000-8000-000000000001'; v uuid:='5b000000-0000-4000-8000-000000000001';
 c uuid; price uuid; o uuid; line uuid; invoice uuid; method uuid;
begin
 insert into auth.users(id,email) values(a,'aw4-pgtap-owner@example.invalid');
 insert into app.tenants(id,slug,name) values(t,'aw4-pgtap','AW4 pgTAP');
 insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values(t,a,'active',true,now());
 update app.tenant_entitlements set entitled=true,enabled=true where tenant_id=t and feature_code in ('advanced_wholesale','inventory');
 insert into app.locations(id,tenant_id,code,name) values(l,t,'AW4','AW4 Branch');
 insert into app.products(id,tenant_id,name,created_by) values(p,t,'AW4 Shoes',a);
 insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values(v,t,p,'Size 9','AW4-PGTAP',499,250,a);
 insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,reserved,average_unit_cost) values(t,l,v,25,0,250);
 perform app.create_customer(a,t,'AW4 Reseller','aw4-pgtap-customer@example.invalid',null,null,'reseller',false,false,'aw4-pgtap-customer-001','fixture','fixture');
 select id into c from app.customers where tenant_id=t;
 perform app.upsert_price_list(a,t,jsonb_build_object('code','AW4','name','AW4 Wholesale','pricingType','wholesale','isDefault',true,'isActive',true,
 'pricingGroup',jsonb_build_object('code','AW4','name','AW4 Shoes','thresholdMilli',10000),'customerIds','[]'::jsonb,
 'entries',jsonb_build_array(jsonb_build_object('variantId',v,'unitPriceMinor',45000))),'aw4-pgtap-price-001','fixture','fixture');
 select id into price from app.price_lists where tenant_id=t;
 perform app.save_wholesale_customer_credit_settings(a,t,jsonb_build_object('customerId',c,'paymentTerm','net_7','creditLimitMinor',500000,'reason','Synthetic credit agreement'),'aw4-pgtap-settings-001','fixture','fixture');
 perform app.save_wholesale_order_draft(a,t,jsonb_build_object('orderNumber','AW4-PGTAP-001','customerId',c,'locationId',l,'priceListId',price,'pricingType','wholesale','notes','Synthetic fixture',
 'lines',jsonb_build_array(jsonb_build_object('variantId',v,'quantityMilli',10000))),'aw4-pgtap-order-draft','fixture','fixture');
 select id into o from app.sales_orders where tenant_id=t;
 perform app.confirm_wholesale_order(a,t,o,'aw4-pgtap-order-confirm','fixture','fixture');
 select id into line from app.sales_order_lines where tenant_id=t and sales_order_id=o;
 perform app.fulfill_wholesale_order(a,t,o,jsonb_build_array(jsonb_build_object('salesOrderLineId',line,'quantityMilli',10000)),'aw4-pgtap-order-fulfill','fixture','fixture');
 select id into invoice from app.invoices where tenant_id=t;
 select id into line from app.invoice_lines where tenant_id=t;
 select id into method from app.payment_methods where tenant_id=t and method_type='cash' limit 1;
 perform app.record_wholesale_payment(a,t,jsonb_build_object('customerId',c,'paymentMethodId',method,'amountMinor',450000,'reference','0047',
 'allocations',jsonb_build_array(jsonb_build_object('invoiceId',invoice,'amountMinor',450000))),'aw4-pgtap-payment-001','fixture','fixture');
 insert into aw4_fixture(invoice_id,line_id,customer_id,method_id) values(invoice,line,c,method);
end;
$$;
create function pg_temp.aw4_return(p_quantity bigint default 2000,p_key text default 'aw4-pgtap-return-001') returns jsonb language sql as $$
 select app.post_wholesale_return('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001',
 jsonb_build_object('invoiceId',invoice_id,'reason','Synthetic return','lines',jsonb_build_array(jsonb_build_object('invoiceLineId',line_id,'quantityMilli',p_quantity,'returnToStock',true))),p_key,p_key,'aw4-pgtap') from aw4_fixture;
$$;
select throws_ok($$select app.allocate_wholesale_payment_funds('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001',
 '{"paymentId":"invalid-uuid"}'::jsonb,'aw4-pgtap-malformed-fund','fixture','fixture')$$,'HCFD2',null,'malformed fund identity retains validation error');
select is((pg_temp.aw4_return()->>'newCustomerCreditMinor')::bigint,90000::bigint,'paid return issues exact customer credit');
update aw4_fixture set note_id=(select id from app.wholesale_credit_notes where tenant_id='2b000000-0000-4000-8000-000000000001');
select is((pg_temp.aw4_return()->>'cashPayoutMinor')::bigint,0::bigint,'replayed return pays no cash');
select is((select count(*) from app.wholesale_credit_notes where tenant_id='2b000000-0000-4000-8000-000000000001'),1::bigint,'replay creates one note');
select is((select count(*) from app.refunds where tenant_id='2b000000-0000-4000-8000-000000000001'),1::bigint,'one commercial reversal');
select is((select on_hand from app.inventory_balances where tenant_id='2b000000-0000-4000-8000-000000000001'),17::numeric,'two units return to shared stock once');
select is((select count(*) from app.cash_movements where tenant_id='2b000000-0000-4000-8000-000000000001'),0::bigint,'credit note creates no cash movement');
select is((select count(*) from app.payment_reversals where tenant_id='2b000000-0000-4000-8000-000000000001'),0::bigint,'credit note does not rewrite collection');
select throws_ok($$select pg_temp.aw4_return(9000,'aw4-pgtap-excess-001')$$,'HCWR4',null,'cannot exceed remaining fulfilled quantity');
select throws_ok($$select pg_temp.aw4_return(1000)$$,'HCS08',null,'same key with changed body is rejected');
select throws_ok($$delete from app.wholesale_credit_notes where tenant_id='2b000000-0000-4000-8000-000000000001'$$,null,'issued invoices are immutable','credit notes cannot be deleted');

do $$
declare a uuid:='1b000000-0000-4000-8000-000000000001';t uuid:='2b000000-0000-4000-8000-000000000001';o uuid;line uuid;price uuid;c uuid;target uuid;result jsonb;
begin
 select customer_id into c from aw4_fixture;select id into price from app.price_lists where tenant_id=t;
 perform app.save_wholesale_order_draft(a,t,jsonb_build_object('orderNumber','AW4-PGTAP-002','customerId',c,'locationId','3b000000-0000-4000-8000-000000000001','priceListId',price,'pricingType','wholesale','notes','Second synthetic invoice',
 'lines',jsonb_build_array(jsonb_build_object('variantId','5b000000-0000-4000-8000-000000000001','quantityMilli',10000))),'aw4-pgtap-second-draft','fixture','fixture');
 select id into o from app.sales_orders where tenant_id=t and order_number='AW4-PGTAP-002';
 perform app.confirm_wholesale_order(a,t,o,'aw4-pgtap-second-confirm','fixture','fixture');
 select id into line from app.sales_order_lines where tenant_id=t and sales_order_id=o;
 perform app.fulfill_wholesale_order(a,t,o,jsonb_build_array(jsonb_build_object('salesOrderLineId',line,'quantityMilli',10000)),'aw4-pgtap-second-fulfill','fixture','fixture');
 select id into target from app.invoices where tenant_id=t and sales_order_id=o;
 select app.command_wholesale_credit(a,t,'apply',jsonb_build_object('creditNoteId',note_id,'invoiceId',target,'amountMinor',30000,'reason','Explicit credit application'),'aw4-pgtap-credit-apply','fixture','fixture') into result from aw4_fixture;
 update aw4_fixture set target_id=target,application_id=(result->>'applicationId')::uuid;
end;
$$;
select is((select app.wholesale_credit_available('2b000000-0000-4000-8000-000000000001',note_id) from aw4_fixture),600::numeric,'only unused credit remains');
select is((select app.wholesale_invoice_open_balance('2b000000-0000-4000-8000-000000000001',target_id) from aw4_fixture),4200::numeric,'application reduces target debt');
select is((app.load_wholesale_statement('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001',(statement_timestamp() at time zone 'Asia/Manila')::date,null,null)->'summary'->>'balanceMinor')::bigint,420000::bigint,'statement includes return and application');
select is((app.load_wholesale_settlement_report('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001',(statement_timestamp() at time zone 'Asia/Manila')::date,(statement_timestamp() at time zone 'Asia/Manila')::date,null)->'summary'->>'closingReceivablesMinor')::bigint,420000::bigint,'settlement report reconciles');
select is(app.wholesale_credit_exposure('2b000000-0000-4000-8000-000000000001',(select customer_id from aw4_fixture)),4200::numeric,'credit limit uses adjusted debt');
select is((select count(*) from app.wholesale_payments where tenant_id='2b000000-0000-4000-8000-000000000001'),1::bigint,'credit application is not a new receipt');
select is((select count(*) from app.fund_ledger_entries where tenant_id='2b000000-0000-4000-8000-000000000001'),0::bigint,'credit application is not a fund contribution');
select throws_ok($$select app.command_wholesale_credit('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','apply',jsonb_build_object('creditNoteId',note_id,'invoiceId',target_id,'amountMinor',60001,'reason','Synthetic overdraw'),'aw4-pgtap-overdraw-001','fixture','fixture') from aw4_fixture$$,'HCWR4',null,'credit cannot be overdrawn');
select throws_ok($$select app.allocate_wholesale_payment_funds('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001',jsonb_build_object('paymentId',(select id from app.wholesale_payments where tenant_id='2b000000-0000-4000-8000-000000000001'),'capitalMinor',300000,'operatingMinor',150000,'settledConfirmed',true,'settlementReference','Synthetic','reason','Synthetic allocation'),'aw4-pgtap-fund-block-001','fixture','fixture')$$,'HCWR5',null,'return-backed cash is not allocated without reconciliation');
select * from finish();
rollback;
