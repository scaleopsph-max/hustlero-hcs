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
select throws_ok($$select app.command_wholesale_credit('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','refund',
 jsonb_build_object('creditNoteId',note_id,'paymentMethodId','ffffffff-ffff-4fff-8fff-ffffffffffff','registerSessionId',null,'referenceLastFour','0047','payoutConfirmed',true,'amountMinor',100,'reason','Unavailable method regression'),
 'aw4-pgtap-method-unavailable','fixture','fixture') from aw4_fixture$$,'HCWR6',null,'post-replay unavailable method is a definitive no-effect rejection');
select is((select count(*) from app.wholesale_credit_payouts where tenant_id='2b000000-0000-4000-8000-000000000001'),0::bigint,'unavailable method posts no payout');
select throws_ok($$select pg_temp.aw4_return(9000,'aw4-pgtap-excess-001')$$,'HCWR4',null,'cannot exceed remaining fulfilled quantity');
select throws_ok($$select pg_temp.aw4_return(1000)$$,'HCS08',null,'same key with changed body is rejected');
select throws_ok($$delete from app.wholesale_credit_notes where tenant_id='2b000000-0000-4000-8000-000000000001'$$,null,'issued invoices are immutable','credit notes cannot be deleted');

create temporary table aw4_note_detail as
select app.load_wholesale_returns('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001')->'notes'->0 detail;
select is((select detail->>'reason' from aw4_note_detail),'Synthetic return','authorized note detail preserves original reason');
select is((select detail->>'refundId' from aw4_note_detail),(select refund_id::text from app.wholesale_credit_notes where id=(select note_id from aw4_fixture)),'detail links exact immutable commercial reversal');
select is((select (detail->>'debtReductionMinor')::bigint from aw4_note_detail),0::bigint,'paid return detail has no invented debt reduction');
select is((select (detail->'lines'->0->>'quantityMilli')::bigint from aw4_note_detail),2000::bigint,'detail contains original returned quantity');
select is((select (detail->'lines'->0->>'amountMinor')::bigint from aw4_note_detail),90000::bigint,'detail contains exact original-price credit');
select is((select (detail->'lines'->0->>'returnToStock')::boolean from aw4_note_detail),true,'detail contains recorded stock disposition');
update app.products set name='Changed current catalog' where tenant_id='2b000000-0000-4000-8000-000000000001';
update app.product_variants set name='Changed size',retail_price=999 where tenant_id='2b000000-0000-4000-8000-000000000001';
select is(app.load_wholesale_returns('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001')->'notes'->0->'lines'->0->>'name','AW4 Shoes / Size 9','note uses immutable invoice names after current catalog changes');
select is((app.load_wholesale_returns('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001')->'notes'->0->'lines'->0->>'amountMinor')::bigint,90000::bigint,'catalog repricing does not revalue note');

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
insert into auth.users(id,email) values('1b000000-0000-4000-8000-000000000002','aw4-detail-reader@example.invalid');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner) values('2b000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-000000000002','active',false);
insert into app.roles(id,tenant_id,code,name) values('6b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001','AW4-READ','AW4 read-only');
insert into app.role_permissions(tenant_id,role_id,permission_code) values('2b000000-0000-4000-8000-000000000001','6b000000-0000-4000-8000-000000000002','wholesale_orders.read');
insert into app.membership_roles(tenant_id,user_id,role_id) values('2b000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-000000000002','6b000000-0000-4000-8000-000000000002');
insert into app.locations(id,tenant_id,code,name) values('3b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001','OTHER','Other branch');
insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values('7b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-000000000002','AW4-READ','AW4 detail reader');
insert into app.employee_locations(tenant_id,employee_id,location_id) values('2b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000002','3b000000-0000-4000-8000-000000000002');
select is(app.load_wholesale_returns('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001')->'notes','[]'::jsonb,'other-branch reader cannot see note details');
insert into app.tenants(id,slug,name) values('2b000000-0000-4000-8000-000000000002','aw4-detail-foreign','AW4 Foreign Detail Tenant');
update app.tenant_entitlements set entitled=true,enabled=true where tenant_id='2b000000-0000-4000-8000-000000000002' and feature_code='advanced_wholesale';
select throws_ok($$select app.load_wholesale_returns('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000002')$$,'HCAR1',null,'foreign tenant note reads are denied');
insert into app.employee_locations(tenant_id,employee_id,location_id) values('2b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000002','3b000000-0000-4000-8000-000000000001');
select is(app.load_wholesale_returns('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001')->'notes'->0->>'reason','Synthetic return','assigned read-only reader can inspect note details');
select is(app.load_wholesale_returns('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000001')->>'canPost','false','detail access does not grant posting authority');
select ok((select bool_and(n.recorded_at=r.completed_at and n.recorded_at=r.created_at
  and n.recorded_at>transaction_timestamp())
  from app.wholesale_credit_notes n join app.refunds r on r.tenant_id=n.tenant_id and r.id=n.refund_id
  where n.tenant_id='2b000000-0000-4000-8000-000000000001'),'commercial reversal and note share post-start effective time');
select ok((select bool_and(n.recorded_at=i.recorded_at) from app.wholesale_credit_notes n
  join app.wholesale_customer_credit_issues i on i.tenant_id=n.tenant_id and i.credit_note_id=n.id
  where n.tenant_id='2b000000-0000-4000-8000-000000000001'),'customer credit issue uses note effective time');
select ok((select bool_and(n.recorded_at=m.occurred_at and n.recorded_at=m.created_at)
  from app.wholesale_credit_notes n join app.inventory_movements m
  on m.tenant_id=n.tenant_id and m.source_type='wholesale_credit_note' and m.source_reference=n.id::text
  where n.tenant_id='2b000000-0000-4000-8000-000000000001'),'stock reversal uses the same business event time');
select ok((select bool_and(n.recorded_at=i.created_at) from app.wholesale_credit_notes n
  join app.refund_items i on i.tenant_id=n.tenant_id and i.refund_id=n.refund_id
  where n.tenant_id='2b000000-0000-4000-8000-000000000001'),'refund items share note effective time');
select ok((select bool_and(n.recorded_at=a.occurred_at and n.recorded_at=e.created_at and n.recorded_at=e.available_at)
  from app.wholesale_credit_notes n join audit.audit_events a on a.tenant_id=n.tenant_id and a.entity_id=n.id and a.action='wholesale_return.posted'
  join integration.event_outbox e on e.tenant_id=n.tenant_id and e.aggregate_id=n.id and e.topic='wholesale_return.posted'
  where n.tenant_id='2b000000-0000-4000-8000-000000000001'),'return audit and outbox agree with note effective time');
select ok((select bool_and(a.recorded_at=e.created_at and a.recorded_at=h.occurred_at)
  from app.wholesale_credit_applications a join audit.audit_events h on h.tenant_id=a.tenant_id and h.entity_id=a.id and h.action='wholesale_credit.apply'
  join integration.event_outbox e on e.tenant_id=a.tenant_id and e.aggregate_id=a.id and e.topic='wholesale_credit.apply'
  where a.tenant_id='2b000000-0000-4000-8000-000000000001'),'credit application audit and outbox share effective time');
select ok((select bool_and((n.recorded_at at time zone 'Asia/Manila')::date=(r.completed_at at time zone 'Asia/Manila')::date)
  from app.wholesale_credit_notes n join app.refunds r on r.tenant_id=n.tenant_id and r.id=n.refund_id
  where n.tenant_id='2b000000-0000-4000-8000-000000000001'),'linked reversal and note belong to the same Manila business day');
select ok((select bool_and((r.completed_at<n.recorded_at)=(n.recorded_at<n.recorded_at)
  and (r.completed_at<n.recorded_at+interval '1 microsecond')=(n.recorded_at<n.recorded_at+interval '1 microsecond'))
  from app.wholesale_credit_notes n join app.refunds r on r.tenant_id=n.tenant_id and r.id=n.refund_id
  where n.tenant_id='2b000000-0000-4000-8000-000000000001'),'strict as-of cutoff includes or excludes both sides of reversal together');
select * from finish();
rollback;
