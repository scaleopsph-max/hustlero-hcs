begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,aud,role) values
 ('df000000-0000-4000-8000-000000000001','discount-pos-owner@example.invalid','authenticated','authenticated'),
 ('df000000-0000-4000-8000-000000000002','discount-pos-foreign@example.invalid','authenticated','authenticated');
insert into app.tenants(id,slug,name) values
 ('df100000-0000-4000-8000-000000000001','discount-pos-a','Discount POS A'),
 ('df100000-0000-4000-8000-000000000002','discount-pos-b','Discount POS B');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
 ('df100000-0000-4000-8000-000000000001','df000000-0000-4000-8000-000000000001','active',true,now()),
 ('df100000-0000-4000-8000-000000000002','df000000-0000-4000-8000-000000000002','active',true,now());
insert into app.locations(id,tenant_id,code,name) values
 ('df200000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001','MAIN','Main');
insert into app.employees(id,tenant_id,employee_code,display_name) values
 ('df300000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001','REF-1','Ref Cashier');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
 ('df100000-0000-4000-8000-000000000001','df300000-0000-4000-8000-000000000001','df200000-0000-4000-8000-000000000001');
insert into app.employee_roles(tenant_id,employee_id,role_id)
 select 'df100000-0000-4000-8000-000000000001','df300000-0000-4000-8000-000000000001',id
 from app.roles where tenant_id='df100000-0000-4000-8000-000000000001' and code='cashier';
insert into app.registers(id,tenant_id,location_id,name,code) values
 ('df400000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001','df200000-0000-4000-8000-000000000001','Ref register','REF');
insert into app.pos_devices(id,tenant_id,register_id,location_id,name,status,token_hash,activated_at,created_by_user_id) values
 ('df500000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001','df400000-0000-4000-8000-000000000001',
 'df200000-0000-4000-8000-000000000001','Ref POS','active',repeat('e',64),now(),'df000000-0000-4000-8000-000000000001');
insert into app.pos_employee_sessions(tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at) values
 ('df100000-0000-4000-8000-000000000001','df500000-0000-4000-8000-000000000001','df400000-0000-4000-8000-000000000001',
 'df200000-0000-4000-8000-000000000001','df300000-0000-4000-8000-000000000001',repeat('f',64),now()+interval '1 hour');
insert into app.products(id,tenant_id,name,created_by) values
 ('df600000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001','Ref item','df000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,track_inventory,created_by) values
 ('df700000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001','df600000-0000-4000-8000-000000000001',
 'Each','REF-EACH',100,false,'df000000-0000-4000-8000-000000000001');
insert into app.payment_methods(id,tenant_id,code,name,method_type) values
 ('df800000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001','disc-fixture-wallet','Ref Wallet','e_wallet'),
 ('df800000-0000-4000-8000-000000000002','df100000-0000-4000-8000-000000000001','disc-fixture-bank','Ref Bank','bank_transfer');
select app.open_pos_register_session(repeat('f',64),0,'disc-fixture-open','disc-fixture-open-hash','disc-fixture-open-request');
update app.product_variants set retail_price=100.01,track_inventory=true where id='df700000-0000-4000-8000-000000000001';
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,track_inventory,created_by) values
 ('df700000-0000-4000-8000-000000000002','df100000-0000-4000-8000-000000000001','df600000-0000-4000-8000-000000000001','Second','DISCOUNT-SECOND',50.03,20,true,'df000000-0000-4000-8000-000000000001');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost) values
 -- Explicit unknown original cost fixture; no fabricated zero-cost stock return.
 ('df100000-0000-4000-8000-000000000001','df200000-0000-4000-8000-000000000001','df700000-0000-4000-8000-000000000001',100,null),
 ('df100000-0000-4000-8000-000000000001','df200000-0000-4000-8000-000000000001','df700000-0000-4000-8000-000000000002',10,20);
create temp table discount_pos_customer as select app.create_customer('df000000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001',
 'Discount customer','discount-customer@example.invalid',null,null,'reseller',false,false,'discount-customer-001','discount-customer-hash','discount-customer-request') result;
insert into app.loyalty_policies(tenant_id,enabled,spend_per_point) values('df100000-0000-4000-8000-000000000001',true,1)
on conflict(tenant_id) do update set enabled=true,spend_per_point=1;
create temp table discount_pos_definition as select app.manage_retail_discount('df000000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001',
 '{"action":"create","name":"POS Fixed","value":{"kind":"fixed","amountMinor":101},"status":"active"}','discount-pos-definition','discount-pos-request') result;
create temp table discount_pos_foreign as select app.manage_retail_discount('df000000-0000-4000-8000-000000000002','df100000-0000-4000-8000-000000000002',
 '{"action":"create","name":"Foreign Fixed","value":{"kind":"fixed","amountMinor":101},"status":"active"}','discount-pos-foreign-001','discount-pos-request') result;
create function pg_temp.discount_pos_sale(p_key text,p_selection jsonb default null,p_payments jsonb default null,p_lines jsonb default null,p_pricing text default 'retail',p_token text default repeat('f',64))
returns jsonb language sql as $$
 select app.complete_pos_discounted_sale(p_token,
 coalesce(p_lines,'[{"variantId":"df700000-0000-4000-8000-000000000001","quantityMilli":1000},{"variantId":"df700000-0000-4000-8000-000000000002","quantityMilli":500}]'::jsonb),
 coalesce(p_payments,jsonb_build_array(jsonb_build_object('paymentMethodId',(select id from app.payment_methods where tenant_id='df100000-0000-4000-8000-000000000001' and method_type='cash' limit 1),'amountCentavos',12402,'tenderedCentavos',13000))),
 (select (result->>'customerId')::uuid from discount_pos_customer),p_pricing,
 coalesce(p_selection,jsonb_build_object('discountId',(select result->>'id' from discount_pos_definition),'expectedRevision',1)),p_key,p_key);
$$;
select is(app.load_pos_discount_options(repeat('f',64))->>'canApplyDiscount','true','actual cashier apply permission is exposed');
select is(jsonb_array_length(app.load_pos_discount_options(repeat('f',64))->'discounts'),1,'only this tenant active definitions returned');
select throws_ok($$select pg_temp.discount_pos_sale('discount-no-session',null,null,null,'retail',repeat('0',64))$$,'HCS90','POS session is invalid or expired','unrecognized session denied');
select throws_ok($$select pg_temp.discount_pos_sale('discount-foreign-def',jsonb_build_object('discountId',(select result->>'id' from discount_pos_foreign),'expectedRevision',1))$$,'HCDP1','Selected discount changed or is unavailable','foreign tenant discount denied');
select throws_ok($$select pg_temp.discount_pos_sale('discount-invalid-override',jsonb_build_object('discountId',(select result->>'id' from discount_pos_definition),'expectedRevision',1,'amountMinor',1))$$,'HCDP2','Invalid predefined discount selection','client cannot override the predefined value');
create temp table discount_pos_state as select pg_temp.discount_pos_sale('discount-cash-sale-001') result;
select is((select result->>'subtotalCentavos' from discount_pos_state),'12503','fractional line gross rounds before ticket allocation');
select is((select result->>'discountCentavos' from discount_pos_state),'101','configured fixed amount only');
select is((select result->>'totalCentavos' from discount_pos_state),'12402','exact net payable');
select is((select result->>'cashReceivedCentavos' from discount_pos_state),'13000','cash tender snapshot');
select is((select result->>'changeCentavos' from discount_pos_state),'598','change computed against discounted payable');
select is((select result->>'loyaltyEarnedPoints' from discount_pos_state),'124','loyalty earns against net spend, not gross');
select is((select total from app.sales where id=(select (result->>'saleId')::uuid from discount_pos_state)),124.02::numeric,'sale total persisted at net');
select is((select subtotal from app.sales where id=(select (result->>'saleId')::uuid from discount_pos_state)),125.03::numeric,'sale retains original gross');
select is((select discount_total from app.sales where id=(select (result->>'saleId')::uuid from discount_pos_state)),1.01::numeric,'header discount reconciles');
select is((select amount from app.cash_movements where source_id=(select (result->>'saleId')::uuid from discount_pos_state)),124.02::numeric,'cash movement records net, never gross');
select is((select sum(amount) from app.sale_payments where sale_id=(select (result->>'saleId')::uuid from discount_pos_state)),124.02::numeric,'payments equal net');
select is((select on_hand from app.inventory_balances where tenant_id='df100000-0000-4000-8000-000000000001' and variant_id='df700000-0000-4000-8000-000000000001'),99::numeric,'shared stock deducted once');
select is((select on_hand from app.inventory_balances where tenant_id='df100000-0000-4000-8000-000000000001' and variant_id='df700000-0000-4000-8000-000000000002'),9.5::numeric,'fractional quantity deducted, discount does not change units');
select is((select sum(gross_minor) from app.pos_sale_line_discounts where sale_id=(select (result->>'saleId')::uuid from discount_pos_state)),12503::numeric,'line gross snapshots reconcile');
select is((select sum(discount_minor) from app.pos_sale_line_discounts where sale_id=(select (result->>'saleId')::uuid from discount_pos_state)),101::numeric,'all allocated cents reconcile');
select is((select sum(net_minor) from app.pos_sale_line_discounts where sale_id=(select (result->>'saleId')::uuid from discount_pos_state)),12402::numeric,'all line net snapshots reconcile');
select ok(not exists(select 1 from app.pos_sale_line_discounts d join app.sale_lines sl on sl.tenant_id=d.tenant_id and sl.id=d.sale_line_id where d.gross_minor<>round(sl.line_total*100) or d.net_minor+d.discount_minor<>d.gross_minor),'immutable line snapshots match original sale lines');
select is(pg_temp.discount_pos_sale('discount-cash-sale-001'),(select result from discount_pos_state),'unknown response retry returns exact original receipt');
select is((select count(*)::integer from app.sales where tenant_id='df100000-0000-4000-8000-000000000001'),1,'retry creates no duplicate sale');
select is((select count(*)::integer from app.inventory_movements where tenant_id='df100000-0000-4000-8000-000000000001'),2,'retry creates no duplicate stock movements');
select is((select count(*)::integer from app.loyalty_transactions where tenant_id='df100000-0000-4000-8000-000000000001'),1,'retry creates no duplicate loyalty entry');
select is((select count(*)::integer from audit.audit_events where tenant_id='df100000-0000-4000-8000-000000000001' and action='sale.completed'),1,'single completion audit');
select is((select count(*)::integer from integration.event_outbox where tenant_id='df100000-0000-4000-8000-000000000001' and topic='sale.completed'),1,'single completion event');
select throws_ok($$update app.pos_sale_discount_snapshots set discount_minor=102$$,'HCDP3','POS discount snapshots are immutable','header snapshot cannot change');
select throws_ok($$delete from app.pos_sale_line_discounts$$,'HCDP3','POS discount snapshots are immutable','line snapshot cannot be deleted');
select ok(not has_table_privilege('authenticated','app.pos_sale_line_discounts','select'),'browser cannot read snapshots directly');
select ok(not has_function_privilege('hcs_hyperdrive','app.complete_pos_discounted_sale_core(text,jsonb,jsonb,uuid,text,jsonb,text,text,text)','execute'),'API cannot bypass guarded discounted entry');
select ok(not has_function_privilege('anon','app.complete_pos_discounted_sale(text,jsonb,jsonb,uuid,text,jsonb,text,text)','execute'),'anonymous posting denied');
select ok((select relrowsecurity from pg_class where oid='app.pos_sale_discount_snapshots'::regclass),'snapshots RLS enabled');
select throws_ok($$select pg_temp.discount_pos_sale('discount-wrong-total',null,jsonb_build_array(jsonb_build_object('paymentMethodId',(select id from app.payment_methods where tenant_id='df100000-0000-4000-8000-000000000001' and method_type='cash' limit 1),'amountCentavos',12503,'tenderedCentavos',12503)))$$,'HCS99','Payment allocation must equal the sale total','gross payment cannot bypass net computation');
select is((select count(*)::integer from app.sales where tenant_id='df100000-0000-4000-8000-000000000001'),1,'wrong payment atomically rolls back sale');
select is((select on_hand from app.inventory_balances where variant_id='df700000-0000-4000-8000-000000000001'),99::numeric,'wrong payment rolls back stock');
select throws_ok($$select pg_temp.discount_pos_sale('discount-wallet-noref',null,'[{"paymentMethodId":"df800000-0000-4000-8000-000000000001","amountCentavos":12402,"tenderedCentavos":12402}]')$$,'HCDP4','Enter exactly four transaction reference digits for online payments','discount does not bypass online-reference validation');
create temp table discount_bank_state as select pg_temp.discount_pos_sale('discount-bank-sale-001',null,'[{"paymentMethodId":"df800000-0000-4000-8000-000000000002","amountCentavos":12402,"tenderedCentavos":12402,"referenceLastFour":"0047"}]') result;
select is((select result->'payments'->0->>'referenceLastFour' from discount_bank_state),'0047','discounted bank receipt retains leading-zero suffix');
select is((select reference_last_four from app.pos_payment_references where sale_payment_id=(select id from app.sale_payments where sale_id=(select (result->>'saleId')::uuid from discount_bank_state))),'0047','bank reference immutable record persisted');
select is(pg_temp.discount_pos_sale('discount-bank-sale-001',null,'[{"paymentMethodId":"df800000-0000-4000-8000-000000000002","amountCentavos":12402,"tenderedCentavos":12402,"referenceLastFour":"0047"}]'),(select result from discount_bank_state),'bank replay returns exact original');
select is((select count(*)::integer from app.pos_payment_references where tenant_id='df100000-0000-4000-8000-000000000001'),1,'bank replay cannot duplicate reference');
select throws_ok($$select pg_temp.discount_pos_sale('discount-bank-sale-001',null,'[{"paymentMethodId":"df800000-0000-4000-8000-000000000002","amountCentavos":12402,"tenderedCentavos":12402,"referenceLastFour":"0048"}]')$$,'HCS08','Idempotency key conflict','changed reference conflicts on the original key');
select throws_ok($$select pg_temp.discount_pos_sale('discount-cash-sale-001',null,null,'[{"variantId":"df700000-0000-4000-8000-000000000001","quantityMilli":2000}]')$$,'HCS08','Idempotency key conflict','changed cart conflicts on the original key');
delete from app.role_permissions rp using app.roles r where r.tenant_id=rp.tenant_id and r.id=rp.role_id and r.tenant_id='df100000-0000-4000-8000-000000000001' and r.code='cashier' and rp.permission_code='discounts.apply';
select is(app.load_pos_discount_options(repeat('f',64))->>'canApplyDiscount','false','cashier cannot invent apply rights');
select is(jsonb_array_length(app.load_pos_discount_options(repeat('f',64))->'discounts'),0,'unprivileged cashier gets no selectable definitions');
select throws_ok($$select pg_temp.discount_pos_sale('discount-cash-sale-001')$$,'HCS93','Employee cannot apply retail discounts','revoked apply permission blocks completed replay');
insert into app.role_permissions(tenant_id,role_id,permission_code) select tenant_id,id,'discounts.apply' from app.roles where tenant_id='df100000-0000-4000-8000-000000000001' and code='cashier';
select app.manage_retail_discount('df000000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001',jsonb_build_object('action','archive','discountId',(select result->>'id' from discount_pos_definition),'expectedRevision',1),'discount-pos-archive','discount-pos-request');
select is(pg_temp.discount_pos_sale('discount-cash-sale-001'),(select result from discount_pos_state),'archive never rewrites original applied snapshot or replay');
select throws_ok($$select pg_temp.discount_pos_sale('discount-archived-fresh')$$,'HCDP1','Selected discount changed or is unavailable','archived definition blocked on a new sale');
select is((select definition_snapshot from app.pos_sale_discount_snapshots where sale_id=(select (result->>'saleId')::uuid from discount_pos_state)),(select result from discount_pos_definition),'original definition snapshot stays active revision one');
create temp table discount_pos_percent as select app.manage_retail_discount('df000000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001',
 '{"action":"create","name":"POS Percent","value":{"kind":"percent","rateBps":1250},"status":"active"}','discount-pos-percentage','discount-pos-request') result;
create temp table discount_percent_state as select pg_temp.discount_pos_sale('discount-percent-sale',jsonb_build_object('discountId',(select result->>'id' from discount_pos_percent),'expectedRevision',1),
 jsonb_build_array(jsonb_build_object('paymentMethodId',(select id from app.payment_methods where tenant_id='df100000-0000-4000-8000-000000000001' and method_type='cash' limit 1),'amountCentavos',10940,'tenderedCentavos',11000))) result;
select is((select result->>'discountCentavos' from discount_percent_state),'1563','percentage rounds half-up to cents');
select is((select result->>'totalCentavos' from discount_percent_state),'10940','percentage payable exactly reconciles');
select is((select sum(discount_minor) from app.pos_sale_line_discounts where sale_id=(select (result->>'saleId')::uuid from discount_percent_state)),1563::numeric,'percent allocated cents reconcile');
select throws_ok($$select app.manage_retail_discount('df000000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001','{"action":"create","name":"Free","value":{"kind":"percent","rateBps":10000},"status":"active"}','discount-pos-free-test','discount-pos-request')$$,'HCDI2','Invalid discount command','100 percent cannot be configured');
create temp table discount_pos_excess as select app.manage_retail_discount('df000000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001',
 '{"action":"create","name":"Excess","value":{"kind":"fixed","amountMinor":12503},"status":"active"}','discount-pos-excess-test','discount-pos-request') result;
select throws_ok($$select pg_temp.discount_pos_sale('discount-zero-payable',jsonb_build_object('discountId',(select result->>'id' from discount_pos_excess),'expectedRevision',1))$$,'HCDP2','Discount must leave a positive payable amount','zero payable rejected with no silent cap');
insert into app.product_categories(id,tenant_id,name,created_by) values('df900000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001','Discount category','df000000-0000-4000-8000-000000000001');
update app.products set category_id='df900000-0000-4000-8000-000000000001' where id='df600000-0000-4000-8000-000000000001';
do $$declare mode text;begin
 foreach mode in array array['wholesale','dealer'] loop
  perform app.upsert_price_list('df000000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001',
   jsonb_build_object('code','DISC_'||upper(mode),'name','Discount test '||mode,'pricingType',mode,'isDefault',true,'isActive',true,
    'pricingGroup',jsonb_build_object('code','DISC_GROUP_'||upper(mode),'name','Discount group '||mode,'thresholdMilli',1000),
    'customerIds',jsonb_build_array((select result->>'customerId' from discount_pos_customer)),
    'entries',jsonb_build_array(jsonb_build_object('variantId','df700000-0000-4000-8000-000000000001','unitPriceMinor',7000))),
   'discount-pos-price-'||mode,'discount-pos-hash-'||mode,'discount-pos-request');
 end loop;
end;$$;
update app.pricing_groups set category_id='df900000-0000-4000-8000-000000000001' where tenant_id='df100000-0000-4000-8000-000000000001' and code in ('DISC_GROUP_WHOLESALE','DISC_GROUP_DEALER');
select throws_ok($$select pg_temp.discount_pos_sale('discount-auto-mixed',jsonb_build_object('discountId',(select result->>'id' from discount_pos_percent),'expectedRevision',1),null,null,'auto')$$,'HCDP2','Discounts require an untaxed retail-only ticket without stacking','automatic mixed category pricing cannot stack a discount');
select throws_ok(format('select pg_temp.discount_pos_sale(%L,%L::jsonb,null,%L::jsonb,%L)','discount-manual-wholesale',jsonb_build_object('discountId',(select result->>'id' from discount_pos_percent),'expectedRevision',1),'[{"variantId":"df700000-0000-4000-8000-000000000001","quantityMilli":1000}]','wholesale'),'HCDP2','Discounts require an untaxed retail-only ticket without stacking','manual wholesale cannot stack a discount');
select throws_ok(format('select pg_temp.discount_pos_sale(%L,%L::jsonb,null,%L::jsonb,%L)','discount-manual-dealer',jsonb_build_object('discountId',(select result->>'id' from discount_pos_percent),'expectedRevision',1),'[{"variantId":"df700000-0000-4000-8000-000000000001","quantityMilli":1000}]','dealer'),'HCDP2','Discounts require an untaxed retail-only ticket without stacking','dealer cannot stack a discount');
select is((select count(*)::integer from app.sales where tenant_id='df100000-0000-4000-8000-000000000001'),3,'all rejected attempts leave only three accepted sales');
select throws_ok($$select app.reverse_sale('df000000-0000-4000-8000-000000000001','df100000-0000-4000-8000-000000000001',(select (result->>'saleId')::uuid from discount_pos_state),'void',null,'Return original snapshot net payment','discount-refund-gate','discount-refund-hash','discount-refund-request')$$,'HCSA7','Return inventory requires reconciliation','tracked return with missing original cost remains blocked for reconciliation');
update app.tenant_entitlements set starts_at=clock_timestamp()-interval '1 day',ends_at=clock_timestamp()-interval '1 second' where tenant_id='df100000-0000-4000-8000-000000000001' and feature_code='sales';
select throws_ok($$select pg_temp.discount_pos_sale('discount-cash-sale-001')$$,'HCDP0','POS discounts are unavailable','expired Sales denies even historical replay');
select * from finish();
rollback;
