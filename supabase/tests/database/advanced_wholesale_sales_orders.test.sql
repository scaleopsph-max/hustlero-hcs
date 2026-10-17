begin;

create extension if not exists pgtap with schema extensions;
select plan(44);

select has_table('app', 'sales_orders', 'sales orders table exists');
select has_table('app', 'sales_order_lines', 'sales order lines table exists');
select has_table('app', 'sales_order_reservation_ledger', 'reservation ledger exists');
select has_function('app', 'load_wholesale_order_context', array['uuid','uuid'], 'protected wholesale context exists');
select has_function('app', 'save_wholesale_order_draft', array['uuid','uuid','jsonb','text','text','text'], 'draft command exists');
select has_function('app', 'confirm_wholesale_order', array['uuid','uuid','uuid','text','text','text'], 'confirmation command exists');
select has_function('app', 'cancel_wholesale_order_remaining', array['uuid','uuid','uuid','text','text','text','text'], 'cancellation command exists');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.sales_orders', 'select'), 'API login cannot read orders directly');
select ok(has_function_privilege('hcs_hyperdrive', 'app.load_wholesale_order_context(uuid,uuid)', 'execute'), 'API login can execute protected context');
select ok((select platform_available from app.features where code = 'advanced_wholesale'), 'advanced wholesale is platform available');

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('1e000000-0000-4000-8000-000000000001', 'advanced-wholesale-a@example.invalid', 'authenticated', 'authenticated', now()),
  ('1e000000-0000-4000-8000-000000000002', 'advanced-wholesale-b@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('2e000000-0000-4000-8000-000000000001', 'advanced-wholesale-a', 'Advanced Wholesale A'),
  ('2e000000-0000-4000-8000-000000000002', 'advanced-wholesale-b', 'Advanced Wholesale B');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('2e000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('2e000000-0000-4000-8000-000000000002', '1e000000-0000-4000-8000-000000000002', 'active', true, now());

select throws_ok($$
  select app.load_wholesale_order_context(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001'
  )
$$, 'HCSQ0', 'Advanced wholesale is not enabled', 'disabled tenant cannot use advanced wholesale');

update app.tenant_entitlements set entitled = true, enabled = true
where tenant_id in ('2e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000002')
  and feature_code = 'advanced_wholesale';

select lives_ok($$
  select app.create_customer(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
    'Wholesale Partner', 'partner@example.invalid', null, null, 'reseller', false, false,
    'advanced-customer-001', 'customer-hash', 'customer-request'
  )
$$, 'reseller customer is created');

select app.save_wholesale_customer_credit_settings('1e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001',
  jsonb_build_object('customerId',(select id from app.customers where tenant_id='2e000000-0000-4000-8000-000000000001'),
    'paymentTerm','net_7','creditLimitMinor',1000000,'reason','Explicit test agreement'),
  'aw1-credit-settings-001','aw1-credit-hash','aw1-credit-request');

insert into app.locations (id, tenant_id, code, name) values
  ('3e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001', 'MAIN', 'Main Warehouse');
insert into app.products (id, tenant_id, name, created_by) values
  ('4e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
   'Shared Inventory Shirt', '1e000000-0000-4000-8000-000000000001');
insert into app.product_variants (id, tenant_id, product_id, name, sku, retail_price, unit_cost, created_by) values
  ('5e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
   '4e000000-0000-4000-8000-000000000001', 'Black / Small', 'AW-BLK-S', 799.00, 250.00,
   '1e000000-0000-4000-8000-000000000001');
insert into app.inventory_balances (tenant_id, location_id, variant_id, on_hand, reserved, average_unit_cost) values
  ('2e000000-0000-4000-8000-000000000001', '3e000000-0000-4000-8000-000000000001',
   '5e000000-0000-4000-8000-000000000001', 25.000, 0, 250.00);

select lives_ok($$
  select app.upsert_price_list(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'code', 'AW-WHOLESALE', 'name', 'Advanced Wholesale', 'pricingType', 'wholesale',
      'isDefault', true, 'isActive', true,
      'pricingGroup', jsonb_build_object('code', 'AW-CORE', 'name', 'AW core', 'thresholdMilli', 10000),
      'customerIds', '[]'::jsonb,
      'entries', jsonb_build_array(jsonb_build_object(
        'variantId', '5e000000-0000-4000-8000-000000000001', 'unitPriceMinor', 45000
      ))
    ),
    'advanced-price-list-001', 'price-list-hash', 'price-list-request'
  )
$$, 'advanced wholesale price list is created');

select is(
  jsonb_array_length(app.load_wholesale_order_context(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001'
  )->'customers'),
  1,
  'context returns the tenant reseller'
);

select lives_ok($$
  select app.save_wholesale_order_draft(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'orderNumber', 'SO-AW-001',
      'customerId', (select id from app.customers where tenant_id = '2e000000-0000-4000-8000-000000000001'),
      'locationId', '3e000000-0000-4000-8000-000000000001',
      'priceListId', (select id from app.price_lists where tenant_id = '2e000000-0000-4000-8000-000000000001'),
      'pricingType', 'wholesale', 'notes', 'Draft below threshold',
      'lines', jsonb_build_array(jsonb_build_object(
        'variantId', '5e000000-0000-4000-8000-000000000001', 'quantityMilli', 9000
      ))
    ),
    'advanced-draft-001', 'draft-hash-1', 'draft-request-1'
  )
$$, 'below-threshold quantity can be saved as a draft');
select is((select reserved from app.inventory_balances where tenant_id = '2e000000-0000-4000-8000-000000000001'), 0.000::numeric, 'draft does not reserve stock');
select is((select status from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001'), 'draft', 'new sales order remains draft');
select throws_ok($$
  select app.confirm_wholesale_order(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001'),
    'advanced-confirm-low-001', 'confirm-low-hash', 'confirm-low-request'
  )
$$, 'HCSQ9', 'A pricing-group quantity threshold has not been met', 'confirmation enforces the current group threshold');
select is((select status from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001'), 'draft', 'failed confirmation leaves the order draft');

select lives_ok($$
  select app.save_wholesale_order_draft(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'id', (select id from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001'),
      'orderNumber', 'SO-AW-001',
      'customerId', (select id from app.customers where tenant_id = '2e000000-0000-4000-8000-000000000001'),
      'locationId', '3e000000-0000-4000-8000-000000000001',
      'priceListId', (select id from app.price_lists where tenant_id = '2e000000-0000-4000-8000-000000000001'),
      'pricingType', 'wholesale', 'notes', 'Ready to confirm',
      'lines', jsonb_build_array(jsonb_build_object(
        'variantId', '5e000000-0000-4000-8000-000000000001', 'quantityMilli', 10000
      ))
    ),
    'advanced-draft-002', 'draft-hash-2', 'draft-request-2'
  )
$$, 'draft is updated to the minimum quantity');
select is((select count(*)::integer from app.sales_order_lines where tenant_id = '2e000000-0000-4000-8000-000000000001'), 1, 'draft update replaces lines without duplicates');

select lives_ok($$
  select app.confirm_wholesale_order(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001'),
    'advanced-confirm-001', 'confirm-hash', 'confirm-request'
  )
$$, 'qualified order confirms and reserves inventory');
select is((select status from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001'), 'confirmed', 'order status is confirmed');
select is((select reserved from app.inventory_balances where tenant_id = '2e000000-0000-4000-8000-000000000001'), 10.000::numeric, 'confirmation reserves shared inventory');
select is((select on_hand from app.inventory_balances where tenant_id = '2e000000-0000-4000-8000-000000000001'), 25.000::numeric, 'reservation does not decrement on-hand stock');
select is((select quantity_delta from app.sales_order_reservation_ledger where tenant_id = '2e000000-0000-4000-8000-000000000001'), 10.000::numeric, 'positive reservation ledger entry is appended');
select is((select customer_name_snapshot from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001'), 'Wholesale Partner', 'confirmation snapshots the customer name');
select is((select total from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001'), 4500.00::numeric, 'order total uses server-authoritative price');
select is((select count(*)::integer from audit.audit_events where tenant_id = '2e000000-0000-4000-8000-000000000001' and action = 'sales_order.confirmed'), 1, 'confirmation is audited once');
select is((select count(*)::integer from integration.event_outbox where tenant_id = '2e000000-0000-4000-8000-000000000001' and topic = 'sales_order.confirmed'), 1, 'confirmation emits one outbox event');

select lives_ok($$
  select app.confirm_wholesale_order(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001'),
    'advanced-confirm-001', 'confirm-hash', 'confirm-retry'
  )
$$, 'confirmation retry returns its stored response');
select is((select count(*)::integer from app.sales_order_reservation_ledger where tenant_id = '2e000000-0000-4000-8000-000000000001'), 1, 'confirmation retry creates no duplicate reservation');

select throws_ok($$
  select app.load_wholesale_order_context(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000002'
  )
$$, 'HCSQ1', 'Wholesale order access is not allowed', 'cross-tenant context access is rejected');

select lives_ok($$
  select app.cancel_wholesale_order_remaining(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001'),
    'Customer cancelled', 'advanced-cancel-001', 'cancel-hash', 'cancel-request'
  )
$$, 'confirmed order cancellation releases its remainder');
select is((select status from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001'), 'cancelled', 'cancelled order has terminal status');
select is((select reserved from app.inventory_balances where tenant_id = '2e000000-0000-4000-8000-000000000001'), 0.000::numeric, 'cancellation releases shared inventory');
select is((select sum(quantity_delta) from app.sales_order_reservation_ledger where tenant_id = '2e000000-0000-4000-8000-000000000001'), 0.000::numeric, 'reservation ledger nets to zero after cancellation');
select is((select cancelled_quantity from app.sales_order_lines where tenant_id = '2e000000-0000-4000-8000-000000000001'), 10.000::numeric, 'line records its cancelled remainder');
select is((select reason from audit.audit_events where tenant_id = '2e000000-0000-4000-8000-000000000001' and action = 'sales_order.cancelled'), 'Customer cancelled', 'cancellation reason is audited');
select lives_ok($$
  select app.cancel_wholesale_order_remaining(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001'),
    'Customer cancelled', 'advanced-cancel-001', 'cancel-hash', 'cancel-retry'
  )
$$, 'cancellation retry returns its stored response');
select is((select count(*)::integer from app.sales_order_reservation_ledger where tenant_id = '2e000000-0000-4000-8000-000000000001'), 2, 'cancellation retry creates no duplicate release');
select throws_ok($$
  update app.sales_order_reservation_ledger set quantity_delta = 1
  where tenant_id = '2e000000-0000-4000-8000-000000000001'
$$, 'P0001', 'sales order reservations are append-only', 'reservation ledger rejects mutation');

select lives_ok($$
  select app.save_wholesale_order_draft(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'orderNumber', 'SO-AW-002',
      'customerId', (select id from app.customers where tenant_id = '2e000000-0000-4000-8000-000000000001'),
      'locationId', '3e000000-0000-4000-8000-000000000001',
      'priceListId', (select id from app.price_lists where tenant_id = '2e000000-0000-4000-8000-000000000001'),
      'pricingType', 'wholesale', 'notes', null,
      'lines', jsonb_build_array(jsonb_build_object(
        'variantId', '5e000000-0000-4000-8000-000000000001', 'quantityMilli', 30000
      ))
    ),
    'advanced-draft-003', 'draft-hash-3', 'draft-request-3'
  )
$$, 'oversized order can be drafted without reservation');
select throws_ok($$
  select app.confirm_wholesale_order(
    '1e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id = '2e000000-0000-4000-8000-000000000001' and order_number = 'SO-AW-002'),
    'advanced-confirm-002', 'confirm-hash-2', 'confirm-request-2'
  )
$$, 'HCQ10', 'Available stock is insufficient for this order', 'confirmation rejects insufficient available shared stock');

select * from finish();
rollback;
