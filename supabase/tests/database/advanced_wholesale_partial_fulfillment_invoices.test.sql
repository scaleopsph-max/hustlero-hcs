begin;

create extension if not exists pgtap with schema extensions;
select plan(56);

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
select lives_ok($$
  select app.confirm_wholesale_order(
    '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id = '2f000000-0000-4000-8000-000000000001'),
    'aw2-confirm-001', 'aw2-confirm-hash', 'aw2-confirm-request'
  )
$$, 'AW2 order confirms');
select is((select reserved from app.inventory_balances where tenant_id = '2f000000-0000-4000-8000-000000000001'), 10.000::numeric, 'confirmation reserves ten units');

select lives_ok($$
  select app.fulfill_wholesale_order(
    '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id = '2f000000-0000-4000-8000-000000000001'),
    jsonb_build_array(jsonb_build_object(
      'salesOrderLineId', (select id from app.sales_order_lines where tenant_id = '2f000000-0000-4000-8000-000000000001'),
      'quantityMilli', 4000
    )),
    'aw2-fulfill-001', 'aw2-fulfill-hash-1', 'aw2-fulfill-request-1'
  )
$$, 'four units are partially fulfilled');
select is((select status from app.sales_orders where tenant_id = '2f000000-0000-4000-8000-000000000001'), 'partially_fulfilled', 'order becomes partially fulfilled');
select is((select fulfilled_quantity from app.sales_order_lines where tenant_id = '2f000000-0000-4000-8000-000000000001'), 4.000::numeric, 'line records four fulfilled units');
select is((select count(*)::integer from app.invoices where tenant_id = '2f000000-0000-4000-8000-000000000001'), 1, 'one invoice is issued');
select is((select channel from app.sales where tenant_id = '2f000000-0000-4000-8000-000000000001'), 'wholesale', 'linked sale uses wholesale channel');
select is((select on_hand from app.inventory_balances where tenant_id = '2f000000-0000-4000-8000-000000000001'), 21.000::numeric, 'partial fulfillment reduces on-hand');
select is((select reserved from app.inventory_balances where tenant_id = '2f000000-0000-4000-8000-000000000001'), 6.000::numeric, 'partial fulfillment consumes matching reservation');
select is((select on_hand - reserved from app.inventory_balances where tenant_id = '2f000000-0000-4000-8000-000000000001'), 15.000::numeric, 'available stock remains unchanged by reserved fulfillment');
select is((select sum(quantity) from app.inventory_movements where tenant_id = '2f000000-0000-4000-8000-000000000001' and source_type = 'wholesale_invoice'), -4.000::numeric, 'partial fulfillment posts one stock deduction');
select is((select sum(quantity_delta) from app.sales_order_reservation_ledger where tenant_id = '2f000000-0000-4000-8000-000000000001'), 6.000::numeric, 'reservation ledger retains six units');
select is((select count(*)::integer from audit.audit_events where tenant_id = '2f000000-0000-4000-8000-000000000001' and action = 'wholesale_invoice.issued'), 1, 'partial fulfillment is audited once');
select is((select count(*)::integer from integration.event_outbox where tenant_id = '2f000000-0000-4000-8000-000000000001' and topic = 'wholesale_invoice.issued'), 1, 'partial fulfillment emits one outbox event');

select lives_ok($$
  select app.fulfill_wholesale_order(
    '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id = '2f000000-0000-4000-8000-000000000001'),
    jsonb_build_array(jsonb_build_object(
      'salesOrderLineId', (select id from app.sales_order_lines where tenant_id = '2f000000-0000-4000-8000-000000000001'),
      'quantityMilli', 4000
    )),
    'aw2-fulfill-001', 'aw2-fulfill-hash-1', 'aw2-fulfill-retry'
  )
$$, 'identical partial fulfillment retry replays');
select is((select count(*)::integer from app.invoices where tenant_id = '2f000000-0000-4000-8000-000000000001'), 1, 'retry creates no duplicate invoice');

select throws_ok($$
  select app.fulfill_wholesale_order(
    '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id = '2f000000-0000-4000-8000-000000000001'),
    jsonb_build_array(jsonb_build_object(
      'salesOrderLineId', (select id from app.sales_order_lines where tenant_id = '2f000000-0000-4000-8000-000000000001'),
      'quantityMilli', 7000
    )),
    'aw2-fulfill-over-001', 'aw2-over-hash', 'aw2-over-request'
  )
$$, 'HCSR3', 'Fulfillment exceeds the remaining order quantity', 'over-fulfillment is rejected');
select is((select count(*)::integer from app.invoices where tenant_id = '2f000000-0000-4000-8000-000000000001'), 1, 'failed over-fulfillment leaves no invoice');

select lives_ok($$
  select app.fulfill_wholesale_order(
    '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id = '2f000000-0000-4000-8000-000000000001'),
    jsonb_build_array(jsonb_build_object(
      'salesOrderLineId', (select id from app.sales_order_lines where tenant_id = '2f000000-0000-4000-8000-000000000001'),
      'quantityMilli', 6000
    )),
    'aw2-fulfill-002', 'aw2-fulfill-hash-2', 'aw2-fulfill-request-2'
  )
$$, 'remaining six units are fulfilled');
select is((select status from app.sales_orders where tenant_id = '2f000000-0000-4000-8000-000000000001'), 'fulfilled', 'order becomes fulfilled');
select is((select fulfilled_quantity from app.sales_order_lines where tenant_id = '2f000000-0000-4000-8000-000000000001'), 10.000::numeric, 'line records all fulfilled units');
select is((select count(*)::integer from app.invoices where tenant_id = '2f000000-0000-4000-8000-000000000001'), 2, 'partial deliveries create two invoices');
select is((select count(*)::integer from app.sales where tenant_id = '2f000000-0000-4000-8000-000000000001'), 2, 'partial deliveries create two linked sale snapshots');
select is((select on_hand from app.inventory_balances where tenant_id = '2f000000-0000-4000-8000-000000000001'), 15.000::numeric, 'full fulfillment deducts ten units total');
select is((select reserved from app.inventory_balances where tenant_id = '2f000000-0000-4000-8000-000000000001'), 0.000::numeric, 'full fulfillment clears the reservation');
select is((select on_hand - reserved from app.inventory_balances where tenant_id = '2f000000-0000-4000-8000-000000000001'), 15.000::numeric, 'final available stock reconciles');
select is((select sum(quantity) from app.inventory_movements where tenant_id = '2f000000-0000-4000-8000-000000000001' and source_type = 'wholesale_invoice'), -10.000::numeric, 'inventory movement ledger totals negative ten');
select is((select sum(quantity_delta) from app.sales_order_reservation_ledger where tenant_id = '2f000000-0000-4000-8000-000000000001'), 0.000::numeric, 'reservation ledger nets to zero');
select is((select count(distinct invoice_number)::integer from app.invoices where tenant_id = '2f000000-0000-4000-8000-000000000001'), 2, 'server invoice numbers are unique');
select is((app.load_reporting_by_channel(
  '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
  current_date - 1, current_date + 1, null, 'wholesale'
)->'summary'->>'transactionCount')::integer, 2, 'wholesale report counts both fulfillment invoices');
select is((app.load_reporting_by_channel(
  '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
  current_date - 1, current_date + 1, null, 'all'
)->'summary'->>'transactionCount')::integer, 2, 'all-channel report includes wholesale fulfillment invoices');
select is(jsonb_array_length(app.list_wholesale_invoices('1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001')), 2, 'invoice context lists both invoices');
select is(jsonb_array_length(app.list_sales_archive('1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001', 100)->'sales'), 2, 'Sales archive lists both wholesale sales');
select is(app.load_sale_archive_record(
  '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
  (select sale_id from app.invoices where tenant_id = '2f000000-0000-4000-8000-000000000001' order by issued_at, id limit 1)
)->>'channel', 'wholesale', 'sale detail identifies the wholesale channel');
select is((app.load_sale_archive_record(
  '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
  (select sale_id from app.invoices where tenant_id = '2f000000-0000-4000-8000-000000000001' order by issued_at, id limit 1)
)->>'invoiceId')::uuid,
  (select id from app.invoices where tenant_id = '2f000000-0000-4000-8000-000000000001' order by issued_at, id limit 1),
  'sale detail links the immutable invoice');
select is((select count(*)::integer from audit.audit_events where tenant_id = '2f000000-0000-4000-8000-000000000001' and action = 'wholesale_invoice.issued'), 2, 'two committed fulfillments create two audit events');
select is((select count(*)::integer from integration.event_outbox where tenant_id = '2f000000-0000-4000-8000-000000000001' and topic = 'wholesale_invoice.issued'), 2, 'two committed fulfillments create two outbox events');
select throws_ok($$update app.invoices set total = total + 1 where tenant_id = '2f000000-0000-4000-8000-000000000001'$$, 'P0001', 'issued invoices are immutable', 'invoice mutation is rejected');
select throws_ok($$delete from app.invoice_lines where tenant_id = '2f000000-0000-4000-8000-000000000001'$$, 'P0001', 'issued invoices are immutable', 'invoice line deletion is rejected');
select throws_ok($$
  select app.list_wholesale_invoices('1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000002')
$$, 'HCSQ1', 'Wholesale order access is not allowed', 'cross-tenant invoice listing is rejected');
select ok(not has_function_privilege('authenticated', 'app.fulfill_wholesale_order(uuid,uuid,uuid,jsonb,text,text,text)', 'execute'), 'browser role cannot fulfill orders directly');

select * from finish();
rollback;
