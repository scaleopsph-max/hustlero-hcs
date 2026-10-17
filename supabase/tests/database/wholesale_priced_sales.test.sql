begin;

create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('1d000000-0000-4000-8000-000000000001', 'priced-sale-a@example.invalid', 'authenticated', 'authenticated', now()),
  ('1d000000-0000-4000-8000-000000000002', 'priced-sale-b@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('2d000000-0000-4000-8000-000000000001', 'priced-sale-a', 'Priced Sale A'),
  ('2d000000-0000-4000-8000-000000000002', 'priced-sale-b', 'Priced Sale B');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('2d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('2d000000-0000-4000-8000-000000000002', '1d000000-0000-4000-8000-000000000002', 'active', true, now());

select lives_ok($$
  select app.create_customer(
    '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
    'Reseller A', 'reseller-a@example.invalid', null, null, 'reseller', false, false,
    'priced-customer-a', 'customer-a-hash', 'customer-a-request'
  )
$$, 'tenant A reseller is created');
select lives_ok($$
  select app.create_customer(
    '1d000000-0000-4000-8000-000000000002', '2d000000-0000-4000-8000-000000000002',
    'Reseller B', 'reseller-b@example.invalid', null, null, 'reseller', false, false,
    'priced-customer-b', 'customer-b-hash', 'customer-b-request'
  )
$$, 'tenant B reseller is created');

insert into app.locations (id, tenant_id, code, name) values
  ('3d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001', 'MAIN', 'Main Store');
insert into app.employees (id, tenant_id, employee_code, display_name) values
  ('4d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001', 'CASH-1', 'Cashier One');
insert into app.employee_locations (tenant_id, employee_id, location_id) values
  ('2d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001');
insert into app.employee_roles (tenant_id, employee_id, role_id)
select '2d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', id
from app.roles where tenant_id = '2d000000-0000-4000-8000-000000000001' and code = 'cashier';
insert into app.registers (id, tenant_id, location_id, name, code) values
  ('5d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
   '3d000000-0000-4000-8000-000000000001', 'Register 1', 'REG-1');
insert into app.pos_devices (
  id, tenant_id, register_id, location_id, name, status, token_hash, activated_at, created_by_user_id
) values (
  '6d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
  '5d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001',
  'Priced Sale POS', 'active', repeat('a', 64), now(), '1d000000-0000-4000-8000-000000000001'
);
insert into app.pos_employee_sessions (
  tenant_id, device_id, register_id, location_id, employee_id, token_hash, expires_at
) values (
  '2d000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000001',
  '5d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001',
  '4d000000-0000-4000-8000-000000000001', repeat('b', 64), now() + interval '1 hour'
);
insert into app.products (id, tenant_id, name, created_by) values
  ('7d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
   'Shared Stock Shirt', '1d000000-0000-4000-8000-000000000001');
insert into app.product_variants (
  id, tenant_id, product_id, name, sku, retail_price, unit_cost, created_by
) values (
  '8d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
  '7d000000-0000-4000-8000-000000000001', 'Black / XL', 'SHARED-XL', 899.00, 450.00,
  '1d000000-0000-4000-8000-000000000001'
);
insert into app.inventory_balances (tenant_id, location_id, variant_id, on_hand, average_unit_cost) values
  ('2d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001',
   '8d000000-0000-4000-8000-000000000001', 100.000, 450.00);

select lives_ok($$
  select app.upsert_price_list(
    '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'code', 'WHOLESALE', 'name', 'Wholesale', 'pricingType', 'wholesale', 'isDefault', true, 'isActive', true,
      'pricingGroup', jsonb_build_object('code', 'WHOLESALE-GROUP', 'name', 'Wholesale group', 'thresholdMilli', 6000),
      'customerIds', jsonb_build_array((select id from app.customers where tenant_id = '2d000000-0000-4000-8000-000000000001')),
      'entries', jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'unitPriceMinor', 75000))
    ),
    'priced-list-wholesale', 'list-wholesale-hash', 'list-wholesale-request'
  )
$$, 'wholesale list is configured');
select lives_ok($$
  select app.upsert_price_list(
    '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'code', 'DEALER', 'name', 'Dealer', 'pricingType', 'dealer', 'isDefault', true, 'isActive', true,
      'pricingGroup', jsonb_build_object('code', 'DEALER-GROUP', 'name', 'Dealer group', 'thresholdMilli', 12000),
      'customerIds', jsonb_build_array((select id from app.customers where tenant_id = '2d000000-0000-4000-8000-000000000001')),
      'entries', jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'unitPriceMinor', 60000))
    ),
    'priced-list-dealer', 'list-dealer-hash', 'list-dealer-request'
  )
$$, 'dealer list is configured');
select lives_ok($$
  select app.open_pos_register_session(repeat('b', 64), 100000, 'priced-register-open', 'open-hash', 'open-request')
$$, 'cashier opens the shared-stock register');

select lives_ok($$
  select app.complete_pos_priced_sale(
    repeat('b', 64),
    jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'quantityMilli', 1000)),
    jsonb_build_array(jsonb_build_object(
      'paymentMethodId', (select id from app.payment_methods where tenant_id = '2d000000-0000-4000-8000-000000000001' and code = 'cash'),
      'amountCentavos', 89900, 'tenderedCentavos', 90000
    )),
    null, 'retail', 'priced-retail-sale', 'retail-sale-hash', 'retail-sale-request'
  )
$$, 'retail sale completes through the unified priced command');
select is((select pricing_type from app.sales where tenant_id = '2d000000-0000-4000-8000-000000000001'), 'retail', 'retail pricing type is snapshotted');
select is((select total from app.sales where tenant_id = '2d000000-0000-4000-8000-000000000001'), 899.00::numeric, 'retail total uses the variant retail price');
select is((select price_list_id from app.sales where tenant_id = '2d000000-0000-4000-8000-000000000001'), null::uuid, 'retail sale has no wholesale price-list snapshot');
select is((select unit_price from app.sale_lines where tenant_id = '2d000000-0000-4000-8000-000000000001'), 899.00::numeric, 'retail line keeps its server price');
select is((select on_hand from app.inventory_balances where tenant_id = '2d000000-0000-4000-8000-000000000001'), 99.000::numeric, 'retail sale decrements shared stock');

select throws_ok($$
  select app.complete_pos_priced_sale(
    repeat('b', 64),
    jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'quantityMilli', 6000)),
    jsonb_build_array(jsonb_build_object(
      'paymentMethodId', (select id from app.payment_methods where tenant_id = '2d000000-0000-4000-8000-000000000001' and code = 'cash'),
      'amountCentavos', 450000, 'tenderedCentavos', 450000
    )),
    null, 'wholesale', 'priced-no-reseller', 'no-reseller-hash', 'no-reseller-request'
  )
$$, 'HCSW1', 'An active reseller customer is required for wholesale or dealer pricing', 'wholesale requires an active reseller');
select throws_ok($$
  select app.complete_pos_priced_sale(
    repeat('b', 64),
    jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'quantityMilli', 5000)),
    jsonb_build_array(jsonb_build_object(
      'paymentMethodId', (select id from app.payment_methods where tenant_id = '2d000000-0000-4000-8000-000000000001' and code = 'cash'),
      'amountCentavos', 375000, 'tenderedCentavos', 375000
    )),
    (select id from app.customers where tenant_id = '2d000000-0000-4000-8000-000000000001'),
    'wholesale', 'priced-below-threshold', 'below-threshold-hash', 'below-threshold-request'
  )
$$, 'HCSW3', 'The pricing-group quantity threshold has not been met', 'below-threshold wholesale sale is rejected');
select is((select count(*)::integer from app.sales where tenant_id = '2d000000-0000-4000-8000-000000000001'), 1, 'rejected wholesale attempts leave no sale');

select lives_ok($$
  select app.complete_pos_priced_sale(
    repeat('b', 64),
    jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'quantityMilli', 6000)),
    jsonb_build_array(jsonb_build_object(
      'paymentMethodId', (select id from app.payment_methods where tenant_id = '2d000000-0000-4000-8000-000000000001' and code = 'cash'),
      'amountCentavos', 450000, 'tenderedCentavos', 450000
    )),
    (select id from app.customers where tenant_id = '2d000000-0000-4000-8000-000000000001'),
    'wholesale', 'priced-wholesale-sale', 'wholesale-sale-hash', 'wholesale-sale-request'
  )
$$, 'threshold-qualified wholesale sale completes');
select is((select total from app.sales where tenant_id = '2d000000-0000-4000-8000-000000000001' and pricing_type = 'wholesale'), 4500.00::numeric, 'wholesale total uses the wholesale price');
select ok((select price_list_id is not null from app.sales where tenant_id = '2d000000-0000-4000-8000-000000000001' and pricing_type = 'wholesale'), 'wholesale sale snapshots its price list');
select is((select unit_price from app.sale_lines line join app.sales sale on sale.tenant_id = line.tenant_id and sale.id = line.sale_id where sale.pricing_type = 'wholesale'), 750.00::numeric, 'wholesale line snapshots the server price');
select is((select on_hand from app.inventory_balances where tenant_id = '2d000000-0000-4000-8000-000000000001'), 93.000::numeric, 'wholesale sale decrements the same shared stock');
select lives_ok($$
  select app.complete_pos_priced_sale(
    repeat('b', 64),
    jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'quantityMilli', 6000)),
    jsonb_build_array(jsonb_build_object(
      'paymentMethodId', (select id from app.payment_methods where tenant_id = '2d000000-0000-4000-8000-000000000001' and code = 'cash'),
      'amountCentavos', 450000, 'tenderedCentavos', 450000
    )),
    (select id from app.customers where tenant_id = '2d000000-0000-4000-8000-000000000001'),
    'wholesale', 'priced-wholesale-sale', 'wholesale-sale-hash', 'wholesale-sale-retry'
  )
$$, 'wholesale sale retry returns its stored response');
select is((select count(*)::integer from app.sales where tenant_id = '2d000000-0000-4000-8000-000000000001' and pricing_type = 'wholesale'), 1, 'wholesale retry creates no duplicate sale');

select lives_ok($$
  select app.complete_pos_priced_sale(
    repeat('b', 64),
    jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'quantityMilli', 12000)),
    jsonb_build_array(jsonb_build_object(
      'paymentMethodId', (select id from app.payment_methods where tenant_id = '2d000000-0000-4000-8000-000000000001' and code = 'cash'),
      'amountCentavos', 720000, 'tenderedCentavos', 720000
    )),
    (select id from app.customers where tenant_id = '2d000000-0000-4000-8000-000000000001'),
    'dealer', 'priced-dealer-sale', 'dealer-sale-hash', 'dealer-sale-request'
  )
$$, 'threshold-qualified dealer sale completes');
select is((select total from app.sales where tenant_id = '2d000000-0000-4000-8000-000000000001' and pricing_type = 'dealer'), 7200.00::numeric, 'dealer total uses the dealer price');
select is((select unit_price from app.sale_lines line join app.sales sale on sale.tenant_id = line.tenant_id and sale.id = line.sale_id where sale.pricing_type = 'dealer'), 600.00::numeric, 'dealer line snapshots the server price');
select ok((select price_list_id is not null from app.sales where tenant_id = '2d000000-0000-4000-8000-000000000001' and pricing_type = 'dealer'), 'dealer sale snapshots its price list');
select is((select on_hand from app.inventory_balances where tenant_id = '2d000000-0000-4000-8000-000000000001'), 81.000::numeric, 'dealer sale decrements the same shared stock');

select throws_ok($$
  select app.complete_pos_priced_sale(
    repeat('b', 64),
    jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'quantityMilli', 6000)),
    jsonb_build_array(jsonb_build_object(
      'paymentMethodId', (select id from app.payment_methods where tenant_id = '2d000000-0000-4000-8000-000000000001' and code = 'cash'),
      'amountCentavos', 450000, 'tenderedCentavos', 450000
    )),
    (select id from app.customers where tenant_id = '2d000000-0000-4000-8000-000000000002'),
    'wholesale', 'priced-cross-tenant', 'cross-tenant-hash', 'cross-tenant-request'
  )
$$, 'HCSB1', 'Customer was not found', 'cross-tenant reseller cannot be used');
select is((select count(*)::integer from app.sales where tenant_id = '2d000000-0000-4000-8000-000000000002'), 0, 'other tenant receives no sale records');

select lives_ok($$
  select app.reverse_sale(
    '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
    (select id from app.sales where tenant_id = '2d000000-0000-4000-8000-000000000001' and pricing_type = 'wholesale'),
    'refund',
    jsonb_build_array(jsonb_build_object(
      'saleLineId', (select line.id from app.sale_lines line join app.sales sale on sale.tenant_id = line.tenant_id and sale.id = line.sale_id where sale.pricing_type = 'wholesale'),
      'quantityMilli', 6000, 'returnToStock', true
    )),
    'Wholesale return', 'priced-wholesale-refund', 'wholesale-refund-hash', 'wholesale-refund-request'
  )
$$, 'full wholesale refund completes');
select is((select status from app.sales where tenant_id = '2d000000-0000-4000-8000-000000000001' and pricing_type = 'wholesale'), 'refunded', 'wholesale sale becomes fully refunded');
select is((select amount from app.refunds where tenant_id = '2d000000-0000-4000-8000-000000000001'), 4500.00::numeric, 'refund uses the original wholesale line price');
select is((select on_hand from app.inventory_balances where tenant_id = '2d000000-0000-4000-8000-000000000001'), 87.000::numeric, 'refund restores quantity to the shared stock balance');
select is((select quantity from app.inventory_movements where tenant_id = '2d000000-0000-4000-8000-000000000001' and movement_type = 'REFUND'), 6.000::numeric, 'refund appends the stock return movement');
select is((select count(*)::integer from audit.audit_events where tenant_id = '2d000000-0000-4000-8000-000000000001' and action = 'sale.completed'), 3, 'three successful priced sales are audited once');
select is((select count(*)::integer from integration.event_outbox where tenant_id = '2d000000-0000-4000-8000-000000000001' and topic = 'sale.completed'), 3, 'three successful priced sales emit one event each');
select is((select count(*)::integer from app.inventory_movements where tenant_id = '2d000000-0000-4000-8000-000000000001' and movement_type in ('SALE', 'REFUND')), 4, 'all retail, wholesale, dealer, and refund stock changes share one ledger');

select * from finish();
rollback;
