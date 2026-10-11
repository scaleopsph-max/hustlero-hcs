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
select is((select count(*) from app.wholesale_payments),0::bigint,'classification failure rolls back payment header');
insert into app.wholesale_legacy_invoices(tenant_id,invoice_id) select tenant_id,id from app.invoices;
select app.record_wholesale_opening_receivable('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 jsonb_build_object('invoiceId',(select id from app.invoices),'dueDate','2026-10-10','reason','Synthetic historical opening'),'payment-opening-001','opening-hash','opening-test');
select app.fulfill_wholesale_order('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 (select id from app.sales_orders),jsonb_build_array(jsonb_build_object('salesOrderLineId',(select id from app.sales_order_lines),'quantityMilli',6000)),
 'payment-new-invoice-001','new-hash','new-test');
select throws_ok($$select pg_temp.payment(180001,'payment-over-001')$$,'HCAP5','Allocation exceeds open invoice balance','overpayment denied');
select throws_ok($$select pg_temp.payment(10000,'payment-mismatch-001',jsonb_build_array(jsonb_build_object('invoiceId',(select id from app.invoices where total=1800),'amountMinor',9999)))$$,'HCAP2','Invalid wholesale payment','allocation total mismatch denied');
select throws_ok($$select pg_temp.payment(10000,'payment-duplicates-001',jsonb_build_array(jsonb_build_object('invoiceId',(select id from app.invoices where total=1800),'amountMinor',5000),jsonb_build_object('invoiceId',(select id from app.invoices where total=1800),'amountMinor',5000)))$$,'HCAP2','Invalid wholesale payment','duplicate invoice denied');
select throws_ok($$select pg_temp.payment(10000,'payment-foreign-invoice-001',jsonb_build_array(jsonb_build_object('invoiceId','00000000-0000-4000-8000-000000000001','amountMinor',10000)))$$,'HCAP3','Payment scope is unavailable','foreign invoice denied');
select throws_ok($$select pg_temp.payment(0,'payment-zero-001')$$,'HCAP2','Invalid wholesale payment','zero received money denied');
select throws_ok($$select app.record_wholesale_payment('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','[]'::jsonb,'payment-array-001','array-hash','array-test')$$,'HCAP2','Invalid wholesale payment','scalar or array payload safely denied');
update app.payment_methods set is_active=false where tenant_id='2f000000-0000-4000-8000-000000000001' and method_type='cash';
select throws_ok($$select pg_temp.payment(10000,'payment-inactive-method-001')$$,'HCAP3','Payment scope is unavailable','inactive method denied');
update app.payment_methods set is_active=true where tenant_id='2f000000-0000-4000-8000-000000000001' and method_type='cash';
update app.tenant_entitlements set enabled=false where tenant_id='2f000000-0000-4000-8000-000000000001' and feature_code='advanced_wholesale';
select throws_ok($$select pg_temp.payment(10000,'payment-disabled-001')$$,'HCSQ0','Advanced wholesale is not enabled','disabled entitlement denies payment');
update app.tenant_entitlements set enabled=true where tenant_id='2f000000-0000-4000-8000-000000000001' and feature_code='advanced_wholesale';
insert into app.roles(id,tenant_id,code,name) values('6f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','payment-test','Payment Test');
insert into app.membership_roles(tenant_id,user_id,role_id) values('2f000000-0000-4000-8000-000000000001','1f000000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000001');
insert into app.role_permissions(tenant_id,role_id,permission_code) values('2f000000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000001','wholesale_orders.read');
update app.tenant_memberships set is_owner=false where tenant_id='2f000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.payment(10000,'payment-reader-denied-001')$$,'HCAP1','Wholesale payment permission is required','order reader cannot record cash');
insert into app.role_permissions(tenant_id,role_id,permission_code) values('2f000000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000001','wholesale_payments.record');
select throws_ok($$select pg_temp.payment(10000,'payment-branch-denied-001')$$,'HCAP3','Payment scope is unavailable','explicit permission without branch assignment denied');
insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values('7f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','1f000000-0000-4000-8000-000000000001','PAY-001','Payment Actor');
insert into app.employee_locations(tenant_id,employee_id,location_id) values('2f000000-0000-4000-8000-000000000001','7f000000-0000-4000-8000-000000000001','3f000000-0000-4000-8000-000000000001');
select lives_ok($$select pg_temp.payment(10000,'payment-partial-001')$$,'partial payment recorded');
select throws_ok($$select pg_temp.settlement()$$,'HCSD0','Reporting access is not allowed','wholesale read does not imply reports permission');
insert into app.role_permissions(tenant_id,role_id,permission_code) values('2f000000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000001','reports.read');
select is((pg_temp.settlement()->'summary'->>'closingReceivablesMinor')::bigint,440000::bigint,'partial receipt reduces closing debt');
select is((pg_temp.settlement()->'summary'->>'issuedMinor')::bigint,450000::bigint,'partial receipt leaves issued revenue unchanged');
select lives_ok($$select pg_temp.payment(10000,'payment-partial-001')$$,'partial payment retry replays');
select is((select count(*) from app.wholesale_payments),1::bigint,'one receipt on replay');
select is((select count(*) from app.wholesale_payment_allocations),1::bigint,'one allocation on replay');
update app.employees set status='suspended' where id='7f000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.payment(10000,'payment-partial-001')$$,'HCAP3','Payment scope is unavailable','replay rechecks branch authorization');
update app.employees set status='active' where id='7f000000-0000-4000-8000-000000000001';
select is(app.wholesale_invoice_open_balance('2f000000-0000-4000-8000-000000000001',(select id from app.invoices where total=1800)),1700::numeric,'opening balance reduced exactly');
select is(app.wholesale_credit_exposure('2f000000-0000-4000-8000-000000000001',(select id from app.customers)),4400::numeric,'payment releases exact credit');
select throws_ok($$select pg_temp.payment(10001,'payment-partial-001')$$,'HCS08','Idempotency key conflict','changed payment replay denied');
select lives_ok($$select pg_temp.payment(15000,'payment-multi-001',jsonb_build_array(jsonb_build_object('invoiceId',(select id from app.invoices where total=1800),'amountMinor',5000),jsonb_build_object('invoiceId',(select id from app.invoices where total=2700),'amountMinor',10000)))$$,'one receipt allocates to opening and net invoices');
select is((select sum(amount) from app.wholesale_payments),250::numeric,'receipt total exact');
select is((select sum(amount) from app.wholesale_payment_allocations),250::numeric,'allocations reconcile to receipts');
select is(app.wholesale_credit_exposure('2f000000-0000-4000-8000-000000000001',(select id from app.customers)),4250::numeric,'whole customer balance net of both allocations');
select lives_ok($$select pg_temp.payment(425000,'payment-full-001',jsonb_build_array(jsonb_build_object('invoiceId',(select id from app.invoices where total=1800),'amountMinor',165000),jsonb_build_object('invoiceId',(select id from app.invoices where total=2700),'amountMinor',260000)))$$,'remaining balances settled exactly');
select is(app.wholesale_credit_exposure('2f000000-0000-4000-8000-000000000001',(select id from app.customers)),0::numeric,'settled customer debt zero');
select throws_ok($$select pg_temp.payment(1,'payment-paid-twice-001')$$,'HCAP5','Allocation exceeds open invoice balance','paid invoice cannot be paid twice');
select is((select count(*) from app.wholesale_payments),3::bigint,'denied payment leaves receipt count unchanged');
select is((select count(*) from audit.audit_events where action='wholesale_payment.recorded'),3::bigint,'one audit per successful receipt');
select is((select count(*) from integration.event_outbox where topic='wholesale_payment.recorded'),3::bigint,'one outbox per successful receipt');
select is((select sum(total) from app.invoices),4500::numeric,'invoice revenue unchanged');
select is((select on_hand from app.inventory_balances where tenant_id='2f000000-0000-4000-8000-000000000001'),15::numeric,'payments do not alter stock');
select is((select count(*) from app.sale_payments),0::bigint,'no invented POS tender');
select is((select count(*) from app.cash_movements),0::bigint,'no invented register cash');
select is((select count(*) from app.fund_ledger_entries),0::bigint,'no automatic fund allocation');
select throws_ok($$delete from app.wholesale_payments$$,'P0001','issued invoices are immutable','receipt append-only');
select throws_ok($$update app.wholesale_payment_allocations set amount=0.01$$,'P0001','issued invoices are immutable','allocation append-only');
select ok(has_function_privilege('hcs_hyperdrive','app.load_wholesale_payments(uuid,uuid)','execute'),'history narrowly executable');
select ok(not has_function_privilege('authenticated','app.load_wholesale_payments(uuid,uuid)','execute'),'browser history execute denied');
select is(jsonb_array_length(app.load_wholesale_payments('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001')->'payments'),3,'history has three receipts');
select is((app.load_wholesale_payments('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001')->>'canRecord')::boolean,true,'explicit permission exposed');
select is((select sum((value->>'openBalanceMinor')::bigint) from jsonb_array_elements(app.load_wholesale_payments('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001')->'invoices')),0::numeric,'context balances reconcile');
select is(jsonb_array_length(app.load_wholesale_payments('1f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000002')->'payments'),0,'other tenant cannot see receipts');
select is((select sum((payment->>'amountMinor')::bigint) from jsonb_array_elements(app.load_wholesale_payments('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001')->'payments') payment),450000::numeric,'history receipt total reconciles');
update app.employees set status='suspended';
select ok(not exists(select 1 from jsonb_array_elements(app.load_wholesale_payments('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001')->'invoices') invoice where (invoice->>'canAllocate')::boolean),'no allocation offered without branch assignment');
delete from app.role_permissions where permission_code='wholesale_payments.record';
select is((app.load_wholesale_payments('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001')->>'canRecord')::boolean,false,'reader history does not imply payment authority');
select is(jsonb_array_length(app.load_wholesale_payments('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001')->'payments'),3,'authorized reader retains history');
select throws_ok($$select app.load_wholesale_payments('1f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000001')$$,'HCAR1','Wholesale receivable access denied','foreign actor history denied');
select ok(has_function_privilege('hcs_hyperdrive','app.load_wholesale_settlement_report(uuid,uuid,date,date,uuid)','execute'),'report narrow API grant');
select ok(not has_function_privilege('authenticated','app.load_wholesale_settlement_report(uuid,uuid,date,date,uuid)','execute'),'no browser report execution');
select is((pg_temp.settlement()->'summary'->>'recordedReceiptsMinor')::bigint,450000::bigint,'receipts aggregate allocations once');
select is((pg_temp.settlement()->'summary'->>'receiptCount')::int,3,'multi-invoice receipt counted once');
select is((pg_temp.settlement()->'summary'->>'issuedMinor')::bigint,450000::bigint,'no cash revenue duplication');
select is((pg_temp.settlement()->'summary'->>'openingChargesMinor')::bigint,180000::bigint,'opening classification tracked separately');
select is((pg_temp.settlement()->'summary'->>'closingReceivablesMinor')::bigint,0::bigint,'fully paid closing receivable is zero');
select is((pg_temp.settlement()->'byPaymentMethod'->0->>'amountMinor')::bigint,450000::bigint,'cash method reconciles');
select is((pg_temp.settlement('2020-01-01','2020-01-01')->'scope'->>'asOf')::timestamptz,'2020-01-01 16:00:00+00'::timestamptz,'tenant local midnight defines exclusive cutoff');
select is((pg_temp.settlement('2020-01-01','2020-01-01')->'summary'->>'recordedReceiptsMinor')::bigint,0::bigint,'historical period excludes later receipts');
select is((pg_temp.settlement('2020-01-01','2020-01-01')->'summary'->>'closingReceivablesMinor')::bigint,0::bigint,'historical closing excludes later invoices');
select throws_ok($$select pg_temp.settlement('2026-10-12','2026-10-11')$$,'HCSD1','Reporting filters are invalid','reversed range denied');
select throws_ok($$select pg_temp.settlement('2020-01-01','2026-01-01')$$,'HCSD1','Reporting filters are invalid','unbounded date range denied');
select throws_ok($$select pg_temp.settlement('2026-10-11','2026-10-11','3f000000-0000-4000-8000-000000000002')$$,'HCSD2','Reporting location was not found','foreign location denied');
insert into app.locations(id,tenant_id,code,name) values('3f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000001','EMPTY','Empty branch');
select is((pg_temp.settlement((now() at time zone 'Asia/Manila')::date,(now() at time zone 'Asia/Manila')::date,'3f000000-0000-4000-8000-000000000002')->'summary'->>'recordedReceiptsMinor')::bigint,0::bigint,'location filter does not count unrelated receipt headers');
select is((app.load_wholesale_settlement_report('1f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Manila')::date,(now() at time zone 'Asia/Manila')::date,null)->'summary'->>'issuedMinor')::bigint,0::bigint,'other tenant reports no foreign invoice');
create function pg_temp.funds(p_capital bigint default 6000,p_operating bigint default 4000,p_key text default 'fund-allocation-001',p_confirm boolean default true) returns jsonb language sql as $$
 select app.allocate_wholesale_payment_funds('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
 jsonb_build_object('paymentId',(select id from app.wholesale_payments where amount=100),'capitalMinor',p_capital,'operatingMinor',p_operating,
 'settledConfirmed',p_confirm,'settlementReference','Cash physically confirmed','reason','Confirmed test allocation'),p_key,p_capital::text||':'||p_operating::text,p_key);
$$;
select throws_ok($$select pg_temp.funds()$$,'HCFD1','Fund permission required','wholesale permission does not grant funds');
update app.tenant_memberships set is_owner=true where tenant_id='2f000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.funds()$$,'HCFD5','Basic funds required','missing funds rolls back');
select lives_ok($$select app.create_basic_fund_setup('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','fund-setup-test-001','fund-setup-test-001','fund-setup-test-001')$$,'basic funds prepared');
select throws_ok($$select pg_temp.funds(6000,3999)$$,'HCFD2','Invalid fund allocation','split must equal receipt');
select throws_ok($$select pg_temp.funds(6000,4000,'unsettled-fund-001',false)$$,'HCFD2','Invalid fund allocation','unsettled money denied');
select throws_ok($$select pg_temp.funds(-1,10001)$$,'HCFD2','Invalid fund allocation','negative share denied');
select is((select count(*) from app.wholesale_fund_allocations),0::bigint,'denials do not post');
select lives_ok($$select pg_temp.funds()$$,'confirmed exact split posts');
select lives_ok($$select pg_temp.funds()$$,'identical retry succeeds');
select is((select count(*) from app.wholesale_fund_allocations),1::bigint,'receipt allocated once');
select is((select count(*) from app.fund_ledger_entries),2::bigint,'two nonzero shares');
select is((select sum(amount) from app.fund_ledger_entries),100::numeric,'fund total equals received cash');
select throws_ok($$select pg_temp.funds(5000,5000)$$,'HCS08','Idempotency key conflict','changed retry denied');
select throws_ok($$select pg_temp.funds(6000,4000,'fund-new-key-001')$$,'HCFD4','Receipt already allocated','different key cannot double allocate');
select is((app.load_wholesale_funds('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001')->>'canManage')::boolean,true,'owner fund authority exposed');
select is((select sum((f->>'balanceMinor')::bigint) from jsonb_array_elements(app.load_wholesale_funds('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001')->'funds') f),10000::numeric,'derived fund balances reconcile');
select throws_ok($$update app.wholesale_fund_allocations set reason='rewrite test'$$,'HCS90','Fund ledger entries are append-only','confirmation immutable');
select throws_ok($$delete from app.fund_ledger_entries$$,'HCS90','Fund ledger entries are append-only','fund ledger immutable');
select is((select sum(amount) from app.wholesale_payments),4500::numeric,'fund split does not change receipts');
select is((select sum(total) from app.invoices),4500::numeric,'no revenue created by fund split');
select is((select count(*) from app.cash_movements),0::bigint,'no bank or register transfer');
select is((select count(*) from audit.audit_events where action='wholesale_funds.allocated'),1::bigint,'allocation audited once');
select is((select count(*) from integration.event_outbox where topic='wholesale_funds.allocated'),1::bigint,'allocation outbox once');
select ok(not has_table_privilege('authenticated','app.wholesale_fund_allocations','insert'),'browser cannot insert confirmation');
select ok(not has_function_privilege('authenticated','app.allocate_wholesale_payment_funds(uuid,uuid,jsonb,text,text,text)','execute'),'browser cannot bypass API');
select throws_ok($$select app.load_wholesale_funds('1f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000001')$$,'HCAR1','Wholesale receivable access denied','foreign actor fund history denied');
select is(jsonb_array_length(app.load_wholesale_funds('1f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000002')->'payments'),0,'other tenant fund context cannot see receipts');
select lives_ok($$select app.allocate_wholesale_payment_funds('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',jsonb_build_object('paymentId',(select id from app.wholesale_payments where amount=150),'capitalMinor',15000,'operatingMinor',0,'settledConfirmed',true,'settlementReference','Cash confirmed','reason','Capital-only allocation'),'zero-share-test-001','zero-share-test-001','zero-share-test-001')$$,'zero operating share accepted');
select is((select count(*) from app.fund_ledger_entries),3::bigint,'zero share creates no ledger entry');
update app.tenant_memberships set is_owner=false where tenant_id='2f000000-0000-4000-8000-000000000001';
delete from app.role_permissions where permission_code='wholesale_orders.read';
select throws_ok($$select pg_temp.settlement()$$,'HCAR1','Wholesale receivable access denied','reports alone do not authorize wholesale debt');
select * from finish();
rollback;
