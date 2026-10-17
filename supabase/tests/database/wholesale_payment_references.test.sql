begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('app', 'invoices', 'invoice table exists');
select has_table('app', 'invoice_lines', 'invoice line table exists');
select has_table('app', 'invoice_counters', 'invoice counter table exists');
select has_function('app', 'fulfill_wholesale_order', array['uuid','uuid','uuid','jsonb','text','text','text'], 'fulfillment command exists');
select has_function('app', 'list_wholesale_invoices', array['uuid','uuid'], 'invoice listing exists');
select has_function('app', 'list_sales_archive', array['uuid','uuid','integer'], 'combined Sales archive exists');
select has_function('app', 'load_sale_archive_record', array['uuid','uuid','uuid'], 'combined sale detail exists');
select has_function('app', 'load_reporting_by_channel', array['uuid','uuid','date','date','uuid','text'], 'channel-aware reporting exists');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.invoices', 'select'), 'API login cannot read invoices directly');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.invoice_lines', 'select'), 'API login cannot read invoice lines directly');
select ok(has_function_privilege('hcs_hyperdrive', 'app.fulfill_wholesale_order(uuid,uuid,uuid,jsonb,text,text,text)', 'execute'), 'API login can execute fulfillment');
select ok(has_function_privilege('hcs_hyperdrive', 'app.load_reporting_by_channel(uuid,uuid,date,date,uuid,text)', 'execute'), 'API login can execute channel-aware reporting');

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('1f000000-0000-4000-8000-000000000001', 'aw2-owner-a@example.invalid', 'authenticated', 'authenticated', now()),
  ('1f000000-0000-4000-8000-000000000002', 'aw2-owner-b@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('2f000000-0000-4000-8000-000000000001', 'aw2-tenant-a', 'AW2 Tenant A'),
  ('2f000000-0000-4000-8000-000000000002', 'aw2-tenant-b', 'AW2 Tenant B');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('2f000000-0000-4000-8000-000000000001', '1f000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('2f000000-0000-4000-8000-000000000002', '1f000000-0000-4000-8000-000000000002', 'active', true, now());
update app.tenant_entitlements set entitled = true, enabled = true
where tenant_id in ('2f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000002')
  and feature_code = 'advanced_wholesale';

select lives_ok($$
  select app.create_customer(
    '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
    'AW2 Reseller', 'aw2-reseller@example.invalid', null, null, 'reseller', false, false,
    'aw2-customer-001', 'aw2-customer-hash', 'aw2-customer-request'
  )
$$, 'reseller customer is created');

insert into app.locations (id, tenant_id, code, name) values
  ('3f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001', 'MAIN', 'Main Warehouse');
insert into app.products (id, tenant_id, name, created_by) values
  ('4f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
   'AW2 Shared Shirt', '1f000000-0000-4000-8000-000000000001');
insert into app.product_variants (id, tenant_id, product_id, name, sku, retail_price, unit_cost, created_by) values
  ('5f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
   '4f000000-0000-4000-8000-000000000001', 'Black / Medium', 'AW2-BLK-M', 799.00, 250.00,
   '1f000000-0000-4000-8000-000000000001');
insert into app.inventory_balances (tenant_id, location_id, variant_id, on_hand, reserved, average_unit_cost) values
  ('2f000000-0000-4000-8000-000000000001', '3f000000-0000-4000-8000-000000000001',
   '5f000000-0000-4000-8000-000000000001', 25.000, 0, 250.00);

select lives_ok($$
  select app.upsert_price_list(
    '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'code', 'AW2-WHOLESALE', 'name', 'AW2 Wholesale', 'pricingType', 'wholesale',
      'isDefault', true, 'isActive', true,
      'pricingGroup', jsonb_build_object('code', 'AW2-CORE', 'name', 'AW2 core', 'thresholdMilli', 10000),
      'customerIds', '[]'::jsonb,
      'entries', jsonb_build_array(jsonb_build_object(
        'variantId', '5f000000-0000-4000-8000-000000000001', 'unitPriceMinor', 45000
      ))
    ),
    'aw2-price-list-001', 'aw2-price-hash', 'aw2-price-request'
  )
$$, 'AW2 price list is created');

select lives_ok($$
  select app.save_wholesale_order_draft(
    '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'orderNumber', 'SO-AW2-001',
      'customerId', (select id from app.customers where tenant_id = '2f000000-0000-4000-8000-000000000001'),
      'locationId', '3f000000-0000-4000-8000-000000000001',
      'priceListId', (select id from app.price_lists where tenant_id = '2f000000-0000-4000-8000-000000000001'),
      'pricingType', 'wholesale', 'notes', 'Partial fulfillment UAT',
      'lines', jsonb_build_array(jsonb_build_object(
        'variantId', '5f000000-0000-4000-8000-000000000001', 'quantityMilli', 10000
      ))
    ),
    'aw2-draft-001', 'aw2-draft-hash', 'aw2-draft-request'
  )
$$, 'AW2 draft is created');
create function pg_temp.aw3_settings(p_term text,p_limit bigint,p_key text) returns jsonb language sql as $$
  select app.save_wholesale_customer_credit_settings('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
    jsonb_build_object('customerId',(select id from app.customers where tenant_id='2f000000-0000-4000-8000-000000000001'),
      'paymentTerm',p_term,'creditLimitMinor',p_limit,'reason','Explicit test agreement'),p_key,p_key,'aw3-test');
$$;
create function pg_temp.aw3_confirm(p_key text) returns jsonb language sql as $$
  select app.confirm_wholesale_order('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id='2f000000-0000-4000-8000-000000000001'),p_key,p_key,'aw3-test');
$$;
create function pg_temp.aw3_fulfill(p_key text) returns jsonb language sql as $$
  select app.fulfill_wholesale_order('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id='2f000000-0000-4000-8000-000000000001'),
    jsonb_build_array(jsonb_build_object('salesOrderLineId',(select id from app.sales_order_lines where tenant_id='2f000000-0000-4000-8000-000000000001'),'quantityMilli',4000)),
    p_key,p_key,'aw3-test');
$$;

select pg_temp.aw3_settings('net_7',450000,'payment-settings-001');
select pg_temp.aw3_confirm('payment-confirm-001');
-- Synthetic historical invoice fixture, issued through the private inventory core by the test superuser.
select app.fulfill_wholesale_order_inventory_core('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 (select id from app.sales_orders),jsonb_build_array(jsonb_build_object('salesOrderLineId',(select id from app.sales_order_lines),'quantityMilli',4000)),
 'payment-legacy-invoice-001','legacy-hash','legacy-test');
create function pg_temp.payment(p_amount bigint,p_key text,p_allocations jsonb default null) returns jsonb language sql as $$
 select app.record_wholesale_payment('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 jsonb_build_object('customerId',(select id from app.customers),'paymentMethodId',(select id from app.payment_methods where tenant_id='2f000000-0000-4000-8000-000000000001' and method_type='cash'),
 'amountMinor',p_amount,'reference','Synthetic received cash','allocations',coalesce(p_allocations,jsonb_build_array(jsonb_build_object('invoiceId',(select id from app.invoices where total=1800),'amountMinor',p_amount)))),
 p_key,md5(p_amount::text || coalesce(p_allocations::text,'')),'payment-test');
$$;
select ok((select relrowsecurity from pg_class where oid='app.wholesale_payments'::regclass),'payment RLS enabled');
select ok((select relrowsecurity from pg_class where oid='app.wholesale_payment_allocations'::regclass),'allocation RLS enabled');
select ok(not has_table_privilege('hcs_hyperdrive','app.wholesale_payments','insert'),'direct payment insert denied');
select ok(not has_function_privilege('authenticated','app.record_wholesale_payment(uuid,uuid,jsonb,text,text,text)','execute'),'browser payment execution denied');
select throws_ok($$select pg_temp.payment(10000,'payment-unclassified-001')$$,'HCAP4','Invoice classification is required','unknown balance cannot be paid');
create function pg_temp.settlement(p_from date default (now() at time zone 'Asia/Manila')::date,p_to date default (now() at time zone 'Asia/Manila')::date,p_location uuid default null) returns jsonb language sql as $$
 select app.load_wholesale_settlement_report('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',p_from,p_to,p_location);
$$;
select is((pg_temp.settlement()->'summary'->>'unclassifiedCount')::int,1,'unclassified debt is explicitly reported');
select is((pg_temp.settlement()->'summary'->>'unclassifiedMinor')::bigint,180000::bigint,'unknown balance is not silently zeroed');
create function pg_temp.statement(p_date date default (statement_timestamp() at time zone 'Asia/Manila')::date,p_customer uuid default null,p_location uuid default null) returns jsonb language sql as $$
 select app.load_wholesale_statement('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',p_date,p_customer,p_location);
$$;
select is((pg_temp.statement()->'summary'->>'unclassifiedCount')::int,1,'statement explicitly preserves unknown invoice');
select is((pg_temp.statement()->'summary'->>'unclassifiedMinor')::bigint,180000::bigint,'statement unknown value preserved');
select is((pg_temp.statement()->'invoices'->0->>'balanceMinor'),null::text,'unknown balance is not zero debt');
select is(jsonb_array_length(pg_temp.statement()->'entries'),0,'unclassified invoice invents no charge');
select is((select count(*) from app.wholesale_payments),0::bigint,'classification failure rolls back payment header');
insert into app.wholesale_legacy_invoices(tenant_id,invoice_id) select tenant_id,id from app.invoices;
select app.record_wholesale_opening_receivable('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 jsonb_build_object('invoiceId',(select id from app.invoices),'dueDate',((statement_timestamp() at time zone 'Asia/Manila')::date-31)::text,'reason','Synthetic historical opening'),'payment-opening-001','opening-hash','opening-test');
select app.fulfill_wholesale_order('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 (select id from app.sales_orders),jsonb_build_array(jsonb_build_object('salesOrderLineId',(select id from app.sales_order_lines),'quantityMilli',6000)),
 'payment-new-invoice-001','new-hash','new-test');

insert into app.payment_methods(id,tenant_id,code,name,method_type) values
 ('8f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','REF-BANK','Bank Original','bank_transfer'),
 ('8f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000001','REF-WALLET','Wallet','e_wallet');
create function pg_temp.online(p_type text,p_ref text,p_key text) returns jsonb language sql as $$
 select app.record_wholesale_payment('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 jsonb_build_object('customerId',(select id from app.customers),'paymentMethodId',
 case p_type when 'bank_transfer' then '8f000000-0000-4000-8000-000000000001'::uuid when 'e_wallet' then '8f000000-0000-4000-8000-000000000002'::uuid
 else (select id from app.payment_methods where tenant_id='2f000000-0000-4000-8000-000000000001' and code='cash') end,
 'amountMinor',10000,'reference',p_ref,'allocations',jsonb_build_array(jsonb_build_object('invoiceId',(select id from app.invoices where total=1800),'amountMinor',10000))),
 p_key,md5(p_type||':'||p_ref),'online-reference-test');
$$;
create function pg_temp.online_report(p_location uuid default null) returns jsonb language sql as $$
 select app.load_wholesale_payment_reference_report('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 (statement_timestamp() at time zone 'Asia/Manila')::date,(statement_timestamp() at time zone 'Asia/Manila')::date,p_location);
$$;
select throws_ok(format('select pg_temp.online(%L,%L,%L)',m,r,'ref-invalid-'||m||'-'||r),'HCAP6',
 'Enter exactly four transaction reference digits for online payments','server rejects invalid '||m||' reference '||r)
 from (values ('e_wallet'),('bank_transfer')) methods(m) cross join (values ('123'),('12345'),('AB12')) refs(r);
select is((select count(*) from app.wholesale_payments),0::bigint,'invalid online references leave no receipt');
select is((select count(*) from app.wholesale_payment_references),0::bigint,'invalid references leave no snapshot');
select lives_ok($$select pg_temp.online('bank_transfer','0047','reference-bank-001')$$,'bank collection accepts four digits');
select lives_ok($$select pg_temp.online('e_wallet','0047','reference-wallet-001')$$,'wallet permits same last four for an independent transaction');
select lives_ok($$select pg_temp.online('cash','Cash slip 123456','reference-cash-001')$$,'cash remains independent of online reference rules');
select is((select count(*) from app.wholesale_payment_references),2::bigint,'only online receipts get immutable snapshots');
select is((select reference_last_four from app.wholesale_payment_references where method_type_snapshot='bank_transfer'),'0047','server preserves leading zeroes');
select is((select count(*) from app.fund_ledger_entries),0::bigint,'reference capture never posts funds');
select is((select count(*) from app.cash_movements),0::bigint,'bank/wallet collection never invents register cash');
update app.payment_methods set name='Bank Renamed',is_active=false where id='8f000000-0000-4000-8000-000000000001';
select lives_ok($$select pg_temp.online('bank_transfer','0047','reference-bank-001')$$,'completed replay survives method deactivation without another snapshot');
select is((select count(*) from app.wholesale_payment_references),2::bigint,'replay snapshots once');
select throws_ok($$select pg_temp.online('bank_transfer','0048','reference-bank-001')$$,'HCS08','Idempotency key conflict','changed reference cannot reuse key');
update app.payment_methods set is_active=true where id='8f000000-0000-4000-8000-000000000001';
select lives_ok($$select pg_temp.online('bank_transfer','0047','reference-bank-002')$$,'repeated last-four digits are not a duplicate-payment identity');
insert into app.wholesale_payments(id,tenant_id,customer_id,payment_method_id,amount,reference,recorded_by)
 select '9f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',id,'8f000000-0000-4000-8000-000000000001',10,'Legacy unclassified reference','1f000000-0000-4000-8000-000000000001' from app.customers;
insert into app.wholesale_payment_allocations(tenant_id,payment_id,invoice_id,amount)
 select tenant_id,'9f000000-0000-4000-8000-000000000001',id,10 from app.invoices where total=1800;
select is(jsonb_array_length(pg_temp.online_report()->'rows'),4,'report includes four online receipts, not cash or invoice duplicates');
select is((select sum((item->>'amountMinor')::bigint) from jsonb_array_elements(pg_temp.online_report()->'rows') item),31000::numeric,'whole receipt online total is exact');
select is((select count(*) from jsonb_array_elements(pg_temp.online_report()->'rows') item where item->>'referenceLastFour'='0047'),3::bigint,'report keeps repeated zero-prefixed references');
select is((select item->>'methodName' from jsonb_array_elements(pg_temp.online_report()->'rows') item where item->>'paymentId'=(select payment_id::text from app.wholesale_payment_references where method_name_snapshot='Bank Original')),'Bank Original','renaming a bank does not rewrite its snapshotted label');
select is((select item->>'referenceLastFour' from jsonb_array_elements(pg_temp.online_report()->'rows') item where item->>'paymentId'='9f000000-0000-4000-8000-000000000001'),null::text,'legacy reference is not invented from old free text');
select ok(exists(select 1 from jsonb_array_elements(app.load_wholesale_payments('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001')->'paymentMethods') method where method->>'methodType'='bank_transfer'),'entry context exposes actual payment method type');
select throws_ok($$delete from app.wholesale_payment_references$$,'P0001','issued invoices are immutable','reference snapshots are append-only');
select ok(not has_table_privilege('hcs_hyperdrive','app.wholesale_payment_references','insert'),'API cannot bypass reference command');
select ok(not has_function_privilege('hcs_hyperdrive','app.wholesale_payments_reference_core(uuid,uuid)','execute'),'unscoped enrichment core stays private');
select throws_ok($$select app.load_wholesale_payment_reference_report('1f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000001',current_date,current_date)$$,
 'HCSD0','Reporting access is not allowed','foreign tenant reader cannot load bank records');
select throws_ok($$select app.load_wholesale_payment_reference_report('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','2026-01-01','2026-03-01')$$,
 'HCSD1','Choose a report range of at most 32 days','bank report is bounded');

-- A failed online payment must roll back the entire COD/Prepaid delivery.
create function pg_temp.paid_order(p_term text,p_number text) returns jsonb language plpgsql as $$
declare v_draft jsonb;
begin
 perform pg_temp.aw3_settings(p_term,1000000,'reference-settings-'||p_term);
 v_draft:=app.save_wholesale_order_draft('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 jsonb_build_object('orderNumber',p_number,'customerId',(select id from app.customers),'locationId','3f000000-0000-4000-8000-000000000001',
 'priceListId',(select id from app.price_lists),'pricingType','wholesale','lines',jsonb_build_array(jsonb_build_object('variantId','5f000000-0000-4000-8000-000000000001','quantityMilli',10000))),
 'reference-draft-'||p_term,p_term,'reference-draft');
 perform app.confirm_wholesale_order('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 (v_draft->>'salesOrderId')::uuid,'reference-confirm-'||p_term,p_term,'reference-confirm');
 return v_draft;
end;
$$;
create function pg_temp.paid(p_number text,p_ref text,p_key text) returns jsonb language sql as $$
 select app.fulfill_wholesale_order_paid('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 (select id from app.sales_orders where order_number=p_number),jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('salesOrderLineId',
 (select line.id from app.sales_order_lines line join app.sales_orders o on o.tenant_id=line.tenant_id and o.id=line.sales_order_id where o.order_number=p_number),'quantityMilli',1000)),
 'payment',jsonb_build_object('paymentMethodId','8f000000-0000-4000-8000-000000000001','amountMinor',45000,'reference',p_ref)),p_key,md5(p_ref),'reference-paid');
$$;
create function pg_temp.financial_truth() returns jsonb language sql as $$
 select jsonb_build_array(
 (select count(*) from app.invoices),(select count(*) from app.sales),(select count(*) from app.wholesale_payments),
 (select count(*) from app.wholesale_payment_references),(select count(*) from app.wholesale_payment_allocations),
 (select count(*) from app.wholesale_invoice_charges),(select count(*) from app.wholesale_paid_fulfillments),
 (select count(*) from app.inventory_movements),(select count(*) from audit.audit_events),
 (select count(*) from integration.event_outbox),(select count(*) from app.idempotency_records),
 (select jsonb_agg(to_jsonb(b) order by variant_id) from app.inventory_balances b));
$$;
select lives_ok($$select pg_temp.paid_order('cod','REF-COD')$$,'COD order prepares using shared stock');
create temporary table reference_before as select pg_temp.financial_truth() truth;
select throws_ok($$select pg_temp.paid('REF-COD','123','reference-cod-invalid')$$,'HCAP6',
 'Enter exactly four transaction reference digits for online payments','COD refuses missing fourth digit');
select is(pg_temp.financial_truth(),(select truth from reference_before),'COD reference failure rolls back invoice, charge, payment, stock, audit, outbox and keys');
select lives_ok($$select pg_temp.paid('REF-COD','0047','reference-cod-valid')$$,'valid COD paid delivery snapshots reference atomically');
select lives_ok($$select app.cancel_wholesale_order_remaining('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 (select id from app.sales_orders where order_number='REF-COD'),'End reference fixture','reference-cod-cancel','cancel-cod','reference-cancel')$$,'COD remainder is cancelled');
select lives_ok($$select pg_temp.paid_order('prepaid','REF-PREPAID')$$,'Prepaid order prepares using released shared stock');
update reference_before set truth=pg_temp.financial_truth();
select throws_ok($$select pg_temp.paid('REF-PREPAID','ABCD','reference-prepaid-invalid')$$,'HCAP6',
 'Enter exactly four transaction reference digits for online payments','Prepaid rejects non-numeric reference');
select is(pg_temp.financial_truth(),(select truth from reference_before),'Prepaid reference failure rolls back the entire delivery');
select lives_ok($$select pg_temp.paid('REF-PREPAID','0047','reference-prepaid-valid')$$,'valid Prepaid delivery posts one snapshot');
update reference_before set truth=pg_temp.financial_truth();
select lives_ok($$select pg_temp.paid('REF-PREPAID','0047','reference-prepaid-valid')$$,'identical paid fulfillment retry succeeds');
select is(pg_temp.financial_truth(),(select truth from reference_before),'paid retry changes no business truth');
select is((select count(*) from app.wholesale_payment_references),5::bigint,'three collections plus COD and Prepaid each record once');
select is((select on_hand from app.inventory_balances),13.000::numeric,'only two paid delivered units reduce shared stock');
select is((select count(*) from app.fund_ledger_entries),0::bigint,'paid reference recording does not allocate funds automatically');

insert into app.locations(id,tenant_id,code,name) values('3f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000001','OTHER','Other Branch');
insert into app.roles(id,tenant_id,code,name) values('6f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','REF-READ','Reference reader');
insert into app.role_permissions(tenant_id,role_id,permission_code)
 select '2f000000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000001',code from app.permissions where code in ('reports.read','wholesale_orders.read');
insert into app.membership_roles(tenant_id,user_id,role_id) values('2f000000-0000-4000-8000-000000000001','1f000000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000001');
insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values('7f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','1f000000-0000-4000-8000-000000000001','REF-READER','Reader');
insert into app.employee_locations(tenant_id,employee_id,location_id) values('2f000000-0000-4000-8000-000000000001','7f000000-0000-4000-8000-000000000001','3f000000-0000-4000-8000-000000000001');
update app.tenant_memberships set is_owner=false where tenant_id='2f000000-0000-4000-8000-000000000001';
select is(jsonb_array_length(pg_temp.online_report()->'rows'),6,'assigned reader can view whole branch receipts');
update app.employee_locations set location_id='3f000000-0000-4000-8000-000000000002';
select is(jsonb_array_length(pg_temp.online_report()->'rows'),0,'another assigned branch cannot view Main bank records');
select throws_ok($$select pg_temp.online_report('3f000000-0000-4000-8000-000000000001')$$,'HCSD0','Reporting location is not allowed','explicit unassigned bank report filter denied');
select * from finish();
rollback;
