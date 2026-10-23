begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create temporary table aw4_fixture(invoice_id uuid,line_id uuid,customer_id uuid,method_id uuid,note_id uuid,application_id uuid,target_id uuid,session_id uuid);
do $$
declare a uuid:='1d000000-0000-4000-8000-000000000001'; t uuid:='2d000000-0000-4000-8000-000000000001';
 l uuid:='3d000000-0000-4000-8000-000000000001'; p uuid:='4d000000-0000-4000-8000-000000000001'; v uuid:='5d000000-0000-4000-8000-000000000001';
 c uuid; price uuid; o uuid; line uuid; invoice uuid; method uuid;
begin
 insert into auth.users(id,email) values(a,'aw4-valuation-owner@example.invalid');
 insert into app.tenants(id,slug,name) values(t,'aw4-valuation','AW4 pgTAP');
 insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values(t,a,'active',true,now());
 update app.tenant_entitlements set entitled=true,enabled=true where tenant_id=t and feature_code in ('advanced_wholesale','inventory');
 insert into app.locations(id,tenant_id,code,name) values(l,t,'AW4','AW4 Branch');
 insert into app.products(id,tenant_id,name,created_by) values(p,t,'AW4 Shoes',a);
 insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values(v,t,p,'Size 9','AW4-PGTAP',499,250,a);
 insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,reserved,average_unit_cost) values(t,l,v,25,0,250);
 perform app.create_customer(a,t,'AW4 Reseller','aw4-valuation-customer@example.invalid',null,null,'reseller',false,false,'aw4-valuation-customer-001','fixture','fixture');
 select id into c from app.customers where tenant_id=t;
 perform app.upsert_price_list(a,t,jsonb_build_object('code','AW4','name','AW4 Wholesale','pricingType','wholesale','isDefault',true,'isActive',true,
 'pricingGroup',jsonb_build_object('code','AW4','name','AW4 Shoes','thresholdMilli',10000),'customerIds','[]'::jsonb,
 'entries',jsonb_build_array(jsonb_build_object('variantId',v,'unitPriceMinor',45000))),'aw4-valuation-price-001','fixture','fixture');
 select id into price from app.price_lists where tenant_id=t;
 perform app.save_wholesale_customer_credit_settings(a,t,jsonb_build_object('customerId',c,'paymentTerm','net_7','creditLimitMinor',500000,'reason','Synthetic credit agreement'),'aw4-valuation-settings-001','fixture','fixture');
 perform app.save_wholesale_order_draft(a,t,jsonb_build_object('orderNumber','AW4-PGTAP-001','customerId',c,'locationId',l,'priceListId',price,'pricingType','wholesale','notes','Synthetic fixture',
 'lines',jsonb_build_array(jsonb_build_object('variantId',v,'quantityMilli',10000))),'aw4-valuation-order-draft','fixture','fixture');
 select id into o from app.sales_orders where tenant_id=t;
 perform app.confirm_wholesale_order(a,t,o,'aw4-valuation-order-confirm','fixture','fixture');
 select id into line from app.sales_order_lines where tenant_id=t and sales_order_id=o;
 perform app.fulfill_wholesale_order(a,t,o,jsonb_build_array(jsonb_build_object('salesOrderLineId',line,'quantityMilli',10000)),'aw4-valuation-order-fulfill','fixture','fixture');
 select id into invoice from app.invoices where tenant_id=t;
 select id into line from app.invoice_lines where tenant_id=t;
 select id into method from app.payment_methods where tenant_id=t and method_type='cash' limit 1;
 perform app.record_wholesale_payment(a,t,jsonb_build_object('customerId',c,'paymentMethodId',method,'amountMinor',450000,'reference','0047',
 'allocations',jsonb_build_array(jsonb_build_object('invoiceId',invoice,'amountMinor',450000))),'aw4-valuation-payment-001','fixture','fixture');
 insert into aw4_fixture(invoice_id,line_id,customer_id,method_id) values(invoice,line,c,method);
end;
$$;
create function pg_temp.aw4_return(p_quantity bigint default 2000,p_key text default 'aw4-valuation-return-001') returns jsonb language sql as $$
 select app.post_wholesale_return('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001',
 jsonb_build_object('invoiceId',invoice_id,'reason','Synthetic return','lines',jsonb_build_array(jsonb_build_object('invoiceLineId',line_id,'quantityMilli',p_quantity,'returnToStock',true))),p_key,p_key,'aw4-valuation') from aw4_fixture;
$$;
create temporary table valuation_fixture(invoice_id uuid,line1 uuid,line2 uuid,original jsonb);
do $$
declare a uuid:='1d000000-0000-4000-8000-000000000001';t uuid:='2d000000-0000-4000-8000-000000000001';
 v uuid; sl uuid; ol uuid; s uuid; i uuid; idx integer; line uuid; v_price numeric;
begin
 insert into app.sales(tenant_id,location_id,receipt_number,subtotal,discount_total,tax_total,total,channel,completed_by_user_id,customer_id)
 select tenant_id,location_id,'HIST-VALUATION',3.03,0.02,0.05,3.06,'wholesale',a,customer_id from app.invoices where id=(select invoice_id from aw4_fixture) returning id into s;
 insert into app.invoices(tenant_id,invoice_number,sales_order_id,sale_id,customer_id,location_id,order_number_snapshot,customer_number_snapshot,customer_name_snapshot,location_name_snapshot,subtotal,discount_total,tax_total,total,issued_by)
 select tenant_id,'HIST-VALUATION',sales_order_id,s,customer_id,location_id,order_number_snapshot,customer_number_snapshot,customer_name_snapshot,location_name_snapshot,3.03,0.02,0.05,3.06,a
 from app.invoices where id=(select invoice_id from aw4_fixture) returning id into i;
 for idx in 1..3 loop
   v_price:=case when idx=3 then 0 else idx*1.01 end;
   insert into app.product_variants(tenant_id,product_id,name,sku,retail_price,unit_cost,created_by)
   values(t,'4d000000-0000-4000-8000-000000000001','Historical '||idx,'HIST-'||idx,v_price,0.5,a) returning id into v;
   insert into app.sales_order_lines(tenant_id,sales_order_id,variant_id,pricing_group_id,product_name_snapshot,variant_name_snapshot,sku_snapshot,ordered_quantity,fulfilled_quantity,unit_price,line_total)
   select tenant_id,sales_order_id,v,pricing_group_id,'Historical shoes','Historical '||idx,'HIST-'||idx,1,1,v_price,v_price
   from app.sales_order_lines where tenant_id=t order by id limit 1 returning id into ol;
   insert into app.sale_lines(tenant_id,sale_id,variant_id,product_name,variant_name,sku,quantity,unit_price,unit_cost,line_total)
   values(t,s,v,'Historical shoes','Historical '||idx,'HIST-'||idx,1,v_price,0.5,v_price) returning id into sl;
   line:=case idx when 1 then '8d000000-0000-4000-8000-000000000001'::uuid when 2 then '8d000000-0000-4000-8000-000000000002'::uuid else '8d000000-0000-4000-8000-000000000003'::uuid end;
   insert into app.invoice_lines(id,tenant_id,invoice_id,sales_order_line_id,sale_line_id,variant_id,product_name,variant_name,sku,quantity,unit_price,line_total)
   values(line,t,i,ol,sl,v,'Historical shoes','Historical '||idx,'HIST-'||idx,1,v_price,v_price);
 end loop;
 insert into app.wholesale_invoice_charges(tenant_id,invoice_id,customer_id,sales_order_id,amount,payment_term,due_date)
 select tenant_id,id,customer_id,sales_order_id,total,'net_7',current_date+7 from app.invoices where tenant_id=t and id=i;
 insert into valuation_fixture select i,'8d000000-0000-4000-8000-000000000001','8d000000-0000-4000-8000-000000000002',to_jsonb(original_invoice) from app.invoices original_invoice where id=i;
end;
$$;
create function pg_temp.valuation_return(p_line uuid,p_qty bigint,p_key text) returns jsonb language sql as $$
 select app.post_wholesale_return('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001',
 jsonb_build_object('invoiceId',invoice_id,'reason','Original historical allocation return','lines',jsonb_build_array(jsonb_build_object('invoiceLineId',p_line,'quantityMilli',p_qty,'returnToStock',false))),p_key,p_key,'valuation-fixture') from valuation_fixture;
$$;
select ok(not has_function_privilege('hcs_hyperdrive','app.wholesale_return_line_valuations(uuid,uuid)','execute'),'raw valuation helper is private');
select is((select count(*) from app.wholesale_return_line_valuations('2d000000-0000-4000-8000-000000000001',(select invoice_id from valuation_fixture))),3::bigint,'free line does not suppress the paid-line reporting allocation');
select throws_ok($$select pg_temp.valuation_return('8d000000-0000-4000-8000-000000000003',1000,'valuation-free-line')$$,'HCWR3',null,'free-line return remains explicitly unsupported');
select is((select sum(gross) from app.wholesale_return_line_valuations('2d000000-0000-4000-8000-000000000001',(select invoice_id from valuation_fixture))),3.03::numeric,'gross allocations equal original subtotal');
select is((select sum(discount) from app.wholesale_return_line_valuations('2d000000-0000-4000-8000-000000000001',(select invoice_id from valuation_fixture))),0.02::numeric,'discount allocations conserve every cent');
select is((select sum(tax) from app.wholesale_return_line_valuations('2d000000-0000-4000-8000-000000000001',(select invoice_id from valuation_fixture))),0.05::numeric,'tax allocations conserve every cent');
select is((select sum(payable) from app.wholesale_return_line_valuations('2d000000-0000-4000-8000-000000000001',(select invoice_id from valuation_fixture))),3.06::numeric,'payable allocations reconcile invoice total');
select is((select payable from app.wholesale_return_line_valuations('2d000000-0000-4000-8000-000000000001',(select invoice_id from valuation_fixture)) where invoice_line_id=(select line1 from valuation_fixture)),1.02::numeric,'stable line-ID ordering assigns deterministic remainder');
select throws_ok($$select pg_temp.valuation_return(line1,1,'valuation-zero-cent') from valuation_fixture$$,'HCWR4',null,'zero-cent slices fail without rounding up');
select is((select count(*) from app.wholesale_credit_notes where tenant_id='2d000000-0000-4000-8000-000000000001'),0::bigint,'zero-cent denial creates no credit note');
select is((pg_temp.valuation_return(line1,333,'valuation-first-part')->>'amountMinor')::bigint,34::bigint,'first fractional slice uses cumulative payable rounding') from valuation_fixture;
select is((pg_temp.valuation_return(line1,667,'valuation-final-part')->>'amountMinor')::bigint,68::bigint,'last slice receives exact remaining payable centavos') from valuation_fixture;
select is((pg_temp.valuation_return(line2,500,'valuation-second-first')->>'amountMinor')::bigint,102::bigint,'second original line has its own payable basis') from valuation_fixture;
select is((pg_temp.valuation_return(line2,500,'valuation-second-last')->>'amountMinor')::bigint,102::bigint,'second final slice reconciles') from valuation_fixture;
select is((select sum(amount) from app.wholesale_credit_notes where invoice_id=(select invoice_id from valuation_fixture)),3.06::numeric,'full invoice return never exceeds or loses original amount');
select is((select to_jsonb(i) from app.invoices i where id=(select invoice_id from valuation_fixture)),(select original from valuation_fixture),'historical invoice snapshot is not rewritten');
select ok((select bool_and(valuation_snapshot->>'policy'='header_gross_proportional_v1') from app.wholesale_credit_note_lines where tenant_id='2d000000-0000-4000-8000-000000000001'),'credit lines retain derived original valuation policy');
select is((select (valuation_snapshot->>'taxMinor')::bigint from app.wholesale_credit_note_lines where invoice_line_id=(select line1 from valuation_fixture) limit 1),2::bigint,'original line tax allocation is preserved');
select is((select count(*) from app.inventory_movements where tenant_id='2d000000-0000-4000-8000-000000000001' and source_type='wholesale_credit_note'),0::bigint,'non-restock valuation creates no stock increase');
select ok((select bool_and((row->>'netSalesCentavos')::bigint=0)
 from jsonb_array_elements(app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001',current_date,current_date,null,'wholesale')->'byItem') row
 where row->>'sku' like 'HIST-%'),'item report reconciles fully returned taxed/discounted invoices to zero');
do $$
declare s uuid;
begin
 insert into app.sales(tenant_id,location_id,receipt_number,subtotal,total,channel,completed_by_user_id,customer_id)
 select tenant_id,location_id,'UNLINKED-WHOLESALE',1,1,'wholesale','1d000000-0000-4000-8000-000000000001',customer_id
 from app.invoices where id=(select invoice_id from valuation_fixture) returning id into s;
 insert into app.sale_lines(tenant_id,sale_id,variant_id,product_name,variant_name,sku,quantity,unit_price,unit_cost,line_total)
 values('2d000000-0000-4000-8000-000000000001',s,'5d000000-0000-4000-8000-000000000001','Unlinked wholesale','Synthetic','UNLINKED',1,1,0.5,1);
end;
$$;
select throws_ok($$select app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001',current_date,current_date,null,'wholesale')$$,'HCSD3',null,'wholesale orphan does not silently become gross-valued');
select throws_ok($$select app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001',current_date,current_date,null,'all')$$,'HCSD3',null,'all-channel report also fails closed on included unsupported wholesale data');
select lives_ok($$select app.load_reporting_by_channel('1d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001',current_date,current_date,null,'pos')$$,'POS-only scope excludes invalid wholesale valuation before calculation');
select * from finish();
rollback;
