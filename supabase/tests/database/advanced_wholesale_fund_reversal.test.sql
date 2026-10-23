begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create temporary table aw4_fixture(invoice_id uuid,line_id uuid,customer_id uuid,method_id uuid,note_id uuid,application_id uuid,target_id uuid,session_id uuid);
do $$
declare a uuid:='1c000000-0000-4000-8000-000000000001'; t uuid:='2c000000-0000-4000-8000-000000000001';
 l uuid:='3c000000-0000-4000-8000-000000000001'; p uuid:='4c000000-0000-4000-8000-000000000001'; v uuid:='5c000000-0000-4000-8000-000000000001';
 c uuid; price uuid; o uuid; line uuid; invoice uuid; method uuid;
begin
 insert into auth.users(id,email) values(a,'aw4-extension-owner@example.invalid');
 insert into app.tenants(id,slug,name) values(t,'aw4-extension','AW4 pgTAP');
 insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values(t,a,'active',true,now());
 update app.tenant_entitlements set entitled=true,enabled=true where tenant_id=t and feature_code in ('advanced_wholesale','inventory');
 insert into app.locations(id,tenant_id,code,name) values(l,t,'AW4','AW4 Branch');
 insert into app.products(id,tenant_id,name,created_by) values(p,t,'AW4 Shoes',a);
 insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values(v,t,p,'Size 9','AW4-PGTAP',499,250,a);
 insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,reserved,average_unit_cost) values(t,l,v,25,0,250);
 perform app.create_customer(a,t,'AW4 Reseller','aw4-extension-customer@example.invalid',null,null,'reseller',false,false,'aw4-extension-customer-001','fixture','fixture');
 select id into c from app.customers where tenant_id=t;
 perform app.upsert_price_list(a,t,jsonb_build_object('code','AW4','name','AW4 Wholesale','pricingType','wholesale','isDefault',true,'isActive',true,
 'pricingGroup',jsonb_build_object('code','AW4','name','AW4 Shoes','thresholdMilli',10000),'customerIds','[]'::jsonb,
 'entries',jsonb_build_array(jsonb_build_object('variantId',v,'unitPriceMinor',45000))),'aw4-extension-price-001','fixture','fixture');
 select id into price from app.price_lists where tenant_id=t;
 perform app.save_wholesale_customer_credit_settings(a,t,jsonb_build_object('customerId',c,'paymentTerm','net_7','creditLimitMinor',500000,'reason','Synthetic credit agreement'),'aw4-extension-settings-001','fixture','fixture');
 perform app.save_wholesale_order_draft(a,t,jsonb_build_object('orderNumber','AW4-PGTAP-001','customerId',c,'locationId',l,'priceListId',price,'pricingType','wholesale','notes','Synthetic fixture',
 'lines',jsonb_build_array(jsonb_build_object('variantId',v,'quantityMilli',10000))),'aw4-extension-order-draft','fixture','fixture');
 select id into o from app.sales_orders where tenant_id=t;
 perform app.confirm_wholesale_order(a,t,o,'aw4-extension-order-confirm','fixture','fixture');
 select id into line from app.sales_order_lines where tenant_id=t and sales_order_id=o;
 perform app.fulfill_wholesale_order(a,t,o,jsonb_build_array(jsonb_build_object('salesOrderLineId',line,'quantityMilli',10000)),'aw4-extension-order-fulfill','fixture','fixture');
 select id into invoice from app.invoices where tenant_id=t;
 select id into line from app.invoice_lines where tenant_id=t;
 select id into method from app.payment_methods where tenant_id=t and method_type='cash' limit 1;
 perform app.record_wholesale_payment(a,t,jsonb_build_object('customerId',c,'paymentMethodId',method,'amountMinor',450000,'reference','0047',
 'allocations',jsonb_build_array(jsonb_build_object('invoiceId',invoice,'amountMinor',450000))),'aw4-extension-payment-001','fixture','fixture');
 insert into aw4_fixture(invoice_id,line_id,customer_id,method_id) values(invoice,line,c,method);
end;
$$;
create function pg_temp.aw4_return(p_quantity bigint default 2000,p_key text default 'aw4-extension-return-001') returns jsonb language sql as $$
 select app.post_wholesale_return('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001',
 jsonb_build_object('invoiceId',invoice_id,'reason','Synthetic return','lines',jsonb_build_array(jsonb_build_object('invoiceLineId',line_id,'quantityMilli',p_quantity,'returnToStock',true))),p_key,p_key,'aw4-extension') from aw4_fixture;
$$;

-- Extension assertions follow; each file rolls back its synthetic fixture.
select has_table('app','wholesale_fund_reversals','audited allocation reversals exist');
select ok(not has_table_privilege('authenticated','app.wholesale_fund_reversals','select,insert,update,delete'),'browser has no direct reversal access');
select ok(not has_table_privilege('hcs_hyperdrive','app.wholesale_fund_reversals','select,insert,update,delete'),'API must use narrow reversal command');
select ok(has_function_privilege('hcs_hyperdrive','app.reverse_wholesale_payment_funds(uuid,uuid,jsonb,text,text,text)','execute'),'API can execute reversal command');
select ok(not has_function_privilege('hcs_hyperdrive','app.lock_wholesale_fund_reversal_access(uuid,uuid)','execute'),'authorization helper is private');
select ok(not has_function_privilege('hcs_hyperdrive','app.wholesale_funds_before_reversals(uuid,uuid)','execute'),'old loader is private');
select app.create_basic_fund_setup('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','aw4-extension-funds-setup','fixture','fixture');
savepoint inactive_extra_leg;
select app.allocate_wholesale_payment_funds('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001',
 jsonb_build_object('paymentId',id,'capitalMinor',0,'operatingMinor',450000,'settledConfirmed',true,'settlementReference','Synthetic original single leg','reason','Original zero-capital split'),
 'aw4-extension-single-leg','fixture','fixture') from app.wholesale_payments where tenant_id='2c000000-0000-4000-8000-000000000001';
insert into app.fund_ledger_entries(tenant_id,fund_account_id,entry_type,amount,source_type,source_id,reason,actor_user_id)
select f.tenant_id,f.id,'allocation',25,'wholesale_payment',p.id,'Malformed synthetic original leg','1c000000-0000-4000-8000-000000000001'
from app.fund_accounts f join app.wholesale_payments p on p.tenant_id=f.tenant_id where f.tenant_id='2c000000-0000-4000-8000-000000000001' and f.fund_type='capital_cogs';
update app.fund_accounts set status='inactive' where tenant_id='2c000000-0000-4000-8000-000000000001' and fund_type='capital_cogs';
select throws_ok($$select app.reverse_wholesale_payment_funds('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001',
 jsonb_build_object('paymentId',id,'reason','Reject hidden malformed original leg','reversalConfirmed',true),
 'aw4-extension-malformed-reverse','fixture','fixture') from app.wholesale_payments where tenant_id='2c000000-0000-4000-8000-000000000001'$$,'HCFD8',null,'inactive extra original leg is rejected instead of silently reversed');
select is((select count(*) from app.wholesale_fund_reversals where tenant_id='2c000000-0000-4000-8000-000000000001'),0::bigint,'malformed-history denial leaves no reversal');
rollback to savepoint inactive_extra_leg;
select app.allocate_wholesale_payment_funds('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001',
 jsonb_build_object('paymentId',id,'capitalMinor',300000,'operatingMinor',150000,'settledConfirmed',true,'settlementReference','Synthetic settled receipt','reason','Original allocation'),
 'aw4-extension-allocate','fixture','fixture') from app.wholesale_payments where tenant_id='2c000000-0000-4000-8000-000000000001';
create function pg_temp.reverse_funds(p_key text default 'aw4-extension-reverse',p_actor uuid default '1c000000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
 select app.reverse_wholesale_payment_funds(p_actor,'2c000000-0000-4000-8000-000000000001',
 jsonb_build_object('paymentId',id,'reason','Original split reversal','reversalConfirmed',true),p_key,p_key,'fixture')
 from app.wholesale_payments where tenant_id='2c000000-0000-4000-8000-000000000001';
$$;
select throws_ok($$select pg_temp.reverse_funds('aw4-foreign-reversal','ffffffff-ffff-4fff-8fff-ffffffffffff')$$,'HCAR1',null,'nonmember cannot reverse');
savepoint insufficient_capital;
insert into app.fund_ledger_entries(tenant_id,fund_account_id,entry_type,amount,source_type,reason,actor_user_id)
select tenant_id,id,'expense',-0.01,'synthetic','Synthetic fund usage','1c000000-0000-4000-8000-000000000001'
from app.fund_accounts where tenant_id='2c000000-0000-4000-8000-000000000001' and fund_type='capital_cogs';
select throws_ok($$select pg_temp.reverse_funds()$$,'HCFD7',null,'capital shortfall blocks even when operating has funds');
select is((select count(*) from app.wholesale_fund_reversals where tenant_id='2c000000-0000-4000-8000-000000000001'),0::bigint,'insufficient reversal has no record');
rollback to savepoint insufficient_capital;
savepoint insufficient_operating;
insert into app.fund_ledger_entries(tenant_id,fund_account_id,entry_type,amount,source_type,reason,actor_user_id)
select tenant_id,id,'expense',-0.01,'synthetic','Synthetic fund usage','1c000000-0000-4000-8000-000000000001'
from app.fund_accounts where tenant_id='2c000000-0000-4000-8000-000000000001' and fund_type='operating';
select throws_ok($$select pg_temp.reverse_funds()$$,'HCFD7',null,'operating shortfall also blocks independently');
rollback to savepoint insufficient_operating;
select is((pg_temp.aw4_return(1500)->>'amountMinor')::bigint,67500::bigint,'fractional return keeps exact original valuation');
select ok(app.wholesale_invoice_has_funded_receipts('2c000000-0000-4000-8000-000000000001',(select invoice_id from aw4_fixture)),'allocated receipt blocks separate payout');
create temporary table reversal_result as select pg_temp.reverse_funds() result;
select is((select (result->>'capitalMinor')::bigint from reversal_result),300000::bigint,'reversal uses full original capital amount');
select is((select (result->>'operatingMinor')::bigint from reversal_result),150000::bigint,'reversal uses full original operating amount');
select is(pg_temp.reverse_funds(),(select result from reversal_result),'same-key replay returns original result');
select throws_ok($$select pg_temp.reverse_funds('aw4-extension-other-key')$$,'HCFD6',null,'different key cannot reverse allocation twice');
select is((select count(*) from app.fund_ledger_entries where tenant_id='2c000000-0000-4000-8000-000000000001' and entry_type='reversal'),2::bigint,'one negative entry for each nonzero original split');
select ok((select bool_and(r.amount=-o.amount and r.fund_account_id=o.fund_account_id and r.occurred_at=n.recorded_at)
 from app.fund_ledger_entries r join app.fund_ledger_entries o on o.tenant_id=r.tenant_id and o.id=r.reversal_of
 join app.wholesale_fund_reversals n on n.tenant_id=r.tenant_id and n.id=r.source_id
 where r.tenant_id='2c000000-0000-4000-8000-000000000001'),'every debit links original account/amount and common timestamp');
select is((select sum(amount) from app.fund_ledger_entries where tenant_id='2c000000-0000-4000-8000-000000000001'),0::numeric,'fund balances net to zero');
select is((select sum(amount) from app.wholesale_payments where tenant_id='2c000000-0000-4000-8000-000000000001'),4500::numeric,'original collection remains intact');
select is((select count(*) from app.cash_movements where tenant_id='2c000000-0000-4000-8000-000000000001'),0::bigint,'reversal does not pay cash');
select ok(not app.wholesale_invoice_has_funded_receipts('2c000000-0000-4000-8000-000000000001',(select invoice_id from aw4_fixture)),'reversed allocation no longer blocks separate payout');
select ok((app.load_wholesale_funds('1c000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001')->'payments'->0->'reversal'->>'reversalId')=(select result->>'reversalId' from reversal_result),'history retains allocation and linked reversal');
select throws_ok($$delete from app.wholesale_fund_reversals where tenant_id='2c000000-0000-4000-8000-000000000001'$$,'HCS90',null,'reversal history is append-only');
update app.tenants set status='suspended' where id='2c000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.reverse_funds()$$,'HCFD1',null,'suspension denies even original-key replay');
select * from finish();
rollback;
