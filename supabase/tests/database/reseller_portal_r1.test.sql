begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- Tenants A and B, owners, one manager without portal permission, and reseller sign-in users.
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('1e100000-0000-4000-8000-000000000001', 'owner-a@example.invalid', 'authenticated', 'authenticated', now()),
  ('1e100000-0000-4000-8000-000000000002', 'owner-b@example.invalid', 'authenticated', 'authenticated', now()),
  ('1e100000-0000-4000-8000-000000000003', 'staff-a@example.invalid', 'authenticated', 'authenticated', now()),
  ('1e100000-0000-4000-8000-000000000010', 'maria@example.invalid', 'authenticated', 'authenticated', now()),
  ('1e100000-0000-4000-8000-000000000011', 'unverified@example.invalid', 'authenticated', 'authenticated', null),
  ('1e100000-0000-4000-8000-000000000012', 'stranger@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('2e100000-0000-4000-8000-000000000001', 'portal-a', 'Portal A Trading'),
  ('2e100000-0000-4000-8000-000000000002', 'portal-b', 'Portal B Trading');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('2e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-000000000001', 'active', true, now()),
  ('2e100000-0000-4000-8000-000000000002', '1e100000-0000-4000-8000-000000000002', 'active', true, now()),
  ('2e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-000000000003', 'active', false, now());
update app.tenant_entitlements set entitled = true, enabled = true
where tenant_id in ('2e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000002')
  and feature_code = 'advanced_wholesale';

select is((select count(*)::integer from app.tenant_entitlements
  where tenant_id = '2e100000-0000-4000-8000-000000000001' and feature_code = 'reseller_portal' and not entitled), 1,
  'new tenants receive a disabled reseller portal entitlement');
select ok(exists(select 1 from app.permissions where code = 'reseller_portal.manage'), 'portal management permission exists');

select throws_ok($$ select app.load_reseller_portal_admin('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001') $$,
  'HCRP0', null, 'portal is unavailable until the entitlement is enabled');
update app.tenant_entitlements set entitled = true, enabled = true
where tenant_id in ('2e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000002')
  and feature_code = 'reseller_portal';
select throws_ok($$ select app.load_reseller_portal_admin('1e100000-0000-4000-8000-000000000003', '2e100000-0000-4000-8000-000000000001') $$,
  'HCRA1', null, 'a member without portal permission cannot manage the portal');

-- Catalog fixtures: one location, three variants, one wholesale price list.
insert into app.locations (id, tenant_id, code, name) values
  ('3e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', 'MAIN', 'Main Warehouse'),
  ('3e100000-0000-4000-8000-000000000002', '2e100000-0000-4000-8000-000000000002', 'MAIN', 'B Warehouse');
insert into app.products (id, tenant_id, name, created_by) values
  ('7e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', 'Coffee Beans', '1e100000-0000-4000-8000-000000000001');
insert into app.product_variants (id, tenant_id, product_id, name, sku, retail_price, unit_cost, created_by) values
  ('8e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', '7e100000-0000-4000-8000-000000000001',
   '250g', 'COF-250', 350.00, 180.00, '1e100000-0000-4000-8000-000000000001'),
  ('8e100000-0000-4000-8000-000000000002', '2e100000-0000-4000-8000-000000000001', '7e100000-0000-4000-8000-000000000001',
   '500g', 'COF-500', 650.00, 340.00, '1e100000-0000-4000-8000-000000000001'),
  ('8e100000-0000-4000-8000-000000000003', '2e100000-0000-4000-8000-000000000001', '7e100000-0000-4000-8000-000000000001',
   '1kg', 'COF-1K', 1200.00, 640.00, '1e100000-0000-4000-8000-000000000001');
insert into app.inventory_balances (tenant_id, location_id, variant_id, on_hand, average_unit_cost) values
  ('2e100000-0000-4000-8000-000000000001', '3e100000-0000-4000-8000-000000000001', '8e100000-0000-4000-8000-000000000001', 100.000, 180.00),
  ('2e100000-0000-4000-8000-000000000001', '3e100000-0000-4000-8000-000000000001', '8e100000-0000-4000-8000-000000000002', 8.000, 340.00);
insert into app.inventory_reorder_policies (tenant_id, location_id, variant_id, reorder_level, updated_by) values
  ('2e100000-0000-4000-8000-000000000001', '3e100000-0000-4000-8000-000000000001', '8e100000-0000-4000-8000-000000000002', 10.000,
   '1e100000-0000-4000-8000-000000000001');
select lives_ok($$
  select app.upsert_price_list('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
    jsonb_build_object('code', 'RESELLER', 'name', 'Reseller price', 'pricingType', 'wholesale', 'isDefault', false, 'isActive', true,
      'pricingGroup', jsonb_build_object('code', 'RESELLER-GROUP', 'name', 'Reseller group', 'thresholdMilli', 2000),
      'customerIds', jsonb_build_array(),
      'entries', jsonb_build_array(
        jsonb_build_object('variantId', '8e100000-0000-4000-8000-000000000001', 'unitPriceMinor', 25000),
        jsonb_build_object('variantId', '8e100000-0000-4000-8000-000000000002', 'unitPriceMinor', 48000),
        jsonb_build_object('variantId', '8e100000-0000-4000-8000-000000000003', 'unitPriceMinor', 90000))),
    'portal-list-reseller-01', 'list-hash', 'list-request')
$$, 'reseller price list is configured');

-- Public application form.
select throws_ok($$ select app.submit_reseller_application('portal-a', '{"fullName":"Maria Santos","email":"maria@example.invalid","phone":"09171234567"}', 'req-app-0') $$,
  'HCRP6', null, 'applications are closed until the portal is configured');
select lives_ok($$
  select app.save_reseller_portal_settings('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
    jsonb_build_object('fulfillmentLocationId', '3e100000-0000-4000-8000-000000000001',
      'defaultPriceListId', (select id from app.price_lists where tenant_id = '2e100000-0000-4000-8000-000000000001' and code = 'RESELLER'),
      'applicationsOpen', true, 'autoConfirm', true),
    'portal-settings-key-01', 'settings-hash', 'settings-request')
$$, 'owner saves portal settings');
select is(app.load_reseller_portal_public('PORTAL-A')->>'applicationsOpen', 'true', 'public portal info is resolved by tenant slug');
select throws_ok($$ select app.load_reseller_portal_public('no-such-business') $$, 'HCRP0', null, 'unknown slugs are not disclosed');
select is(app.submit_reseller_application('portal-a',
  '{"fullName":"Maria Santos","businessName":"Maria Sari-Sari","email":"Maria@Example.invalid","phone":"0917-123-4567","city":"Tagaytay"}',
  'req-app-1')->>'status', 'received', 'a public application is received');
select is(app.submit_reseller_application('portal-a',
  '{"fullName":"Maria Again","email":"maria@example.invalid","phone":"09171234567"}', 'req-app-2')->>'status', 'received',
  'a duplicate pending application is acknowledged the same way');
select is((select count(*)::integer from app.reseller_applications where tenant_id = '2e100000-0000-4000-8000-000000000001'), 1,
  'duplicate pending applications are not stored twice');
select throws_ok($$ select app.submit_reseller_application('portal-a', '{"fullName":"X","email":"bad","phone":"1"}', 'req-app-3') $$,
  'HCRP3', null, 'invalid applications are rejected');
select throws_ok($$ select app.submit_reseller_application('portal-a', '{"fullName":"Maria Santos","email":"m@example.invalid","phone":"09171234567","role":"owner"}', 'req-app-4') $$,
  'HCRP3', null, 'unknown application fields are rejected');

-- Approval creates the reseller customer, credit terms, and an invited account.
select is(app.decide_reseller_application('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.reseller_applications where tenant_id = '2e100000-0000-4000-8000-000000000001'),
  jsonb_build_object('decision', 'approve',
    'priceListId', (select id from app.price_lists where tenant_id = '2e100000-0000-4000-8000-000000000001' and code = 'RESELLER'),
    'paymentTerm', 'prepaid', 'creditLimitMinor', 2000000),
  'portal-approve-key-01', 'approve-hash', 'approve-request')->>'status', 'approved', 'owner approves the application');
select is((select customer_type from app.customers where tenant_id = '2e100000-0000-4000-8000-000000000001' and email = 'maria@example.invalid'),
  'reseller', 'approval creates a reseller customer');
select is((select credit_limit from app.wholesale_customer_credit_settings where tenant_id = '2e100000-0000-4000-8000-000000000001'),
  20000.00::numeric, 'approval records explicit credit settings');
select is((select status from app.reseller_accounts where tenant_id = '2e100000-0000-4000-8000-000000000001'), 'invited',
  'approval creates an invited portal account');
select ok(exists(select 1 from app.customer_price_list_assignments where tenant_id = '2e100000-0000-4000-8000-000000000001'),
  'approval assigns the non-default price list');
select throws_ok($$ select app.decide_reseller_application('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.reseller_applications where tenant_id = '2e100000-0000-4000-8000-000000000001'),
  '{"decision":"reject","reason":"Second decision"}', 'portal-approve-key-02', 'reject-hash', 'reject-request') $$,
  'HCRA5', null, 'a decided application cannot be decided again');

-- Sign-in linking requires the invited, verified email.
select is(jsonb_array_length(app.load_reseller_portal_session('1e100000-0000-4000-8000-000000000011')->'accounts'), 0,
  'an unverified user is not linked');
select is(jsonb_array_length(app.load_reseller_portal_session('1e100000-0000-4000-8000-000000000012')->'accounts'), 0,
  'a verified user with another email is not linked');
select is(app.load_reseller_portal_session('1e100000-0000-4000-8000-000000000010')->'accounts'->0->>'customerName', 'Maria Santos',
  'the invited verified email links and returns the reseller account');
select is((select status from app.reseller_accounts where tenant_id = '2e100000-0000-4000-8000-000000000001'), 'active',
  'linking activates the account');

-- Catalog: reseller price, SRP, and stock badges only.
select is(jsonb_array_length(app.load_reseller_portal_catalog('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001')->'items'), 3,
  'reseller sees every variant in the assigned price list');
select is((select item->>'stockStatus' from jsonb_array_elements(app.load_reseller_portal_catalog('1e100000-0000-4000-8000-000000000010',
  '2e100000-0000-4000-8000-000000000001')->'items') item where item->>'sku' = 'COF-250'), 'in_stock', 'stock above reorder level is in stock');
select is((select item->>'stockStatus' from jsonb_array_elements(app.load_reseller_portal_catalog('1e100000-0000-4000-8000-000000000010',
  '2e100000-0000-4000-8000-000000000001')->'items') item where item->>'sku' = 'COF-500'), 'low_stock', 'stock at or under reorder level is low');
select is((select item->>'stockStatus' from jsonb_array_elements(app.load_reseller_portal_catalog('1e100000-0000-4000-8000-000000000010',
  '2e100000-0000-4000-8000-000000000001')->'items') item where item->>'sku' = 'COF-1K'), 'out_of_stock', 'missing stock is out of stock');
select is((select (item->>'srpMinor')::bigint from jsonb_array_elements(app.load_reseller_portal_catalog('1e100000-0000-4000-8000-000000000010',
  '2e100000-0000-4000-8000-000000000001')->'items') item where item->>'sku' = 'COF-250'), 35000::bigint, 'SRP comes from the retail price');
select ok(not (app.load_reseller_portal_catalog('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001')::text ~ 'onHand|availableMilli|unitCost'),
  'catalog never exposes quantities or cost');
select throws_ok($$ select app.load_reseller_portal_catalog('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000002') $$,
  'HCRP1', null, 'a reseller cannot read another tenant''s portal');
select throws_ok($$ select app.load_reseller_portal_catalog('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001') $$,
  'HCRP1', null, 'a Back Office owner session is not a reseller session');

-- Auto-confirmed order reserves shared stock with the reseller as actor.
select throws_ok($$ select app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":1000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}',
  'portal-order-key-00', 'order-hash-0', 'order-request-0') $$, 'HCRP5', null, 'wholesale minimum quantity is enforced');
select throws_ok($$ select app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":5000}],"fulfillmentMethod":"delivery","paymentPreference":"gcash"}',
  'portal-order-key-0a', 'order-hash-0a', 'order-request-0a') $$, 'HCRP3', null, 'delivery requires an address');
select is(app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":10000}],"fulfillmentMethod":"delivery","deliveryAddress":"Blk 4 Lot 2, Tagaytay City","paymentPreference":"gcash"}',
  'portal-order-key-01', 'order-hash-1', 'order-request-1')->>'status', 'confirmed', 'an order with stock and credit auto-confirms');
select is((select reserved from app.inventory_balances where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and variant_id = '8e100000-0000-4000-8000-000000000001'), 10.000::numeric, 'auto-confirm reserves the shared branch stock');
select is((select count(*)::integer from app.sales_order_reservation_ledger where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and actor_reseller_account_id is not null and actor_user_id is null), 1, 'reservation ledger records the reseller actor');
select is((select order_number::text from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and status = 'confirmed'),
  'RP-000001', 'portal orders receive server-generated numbers');
select ok(exists(select 1 from app.wholesale_order_credit_snapshots s join app.sales_orders o on o.tenant_id = s.tenant_id and o.id = s.sales_order_id
  where o.order_number = 'RP-000001'), 'auto-confirm snapshots the credit terms like Back Office confirmation');
select is(app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":10000}],"fulfillmentMethod":"delivery","deliveryAddress":"Blk 4 Lot 2, Tagaytay City","paymentPreference":"gcash"}',
  'portal-order-key-01', 'order-hash-1', 'order-request-1b')->>'orderNumber', 'RP-000001', 'a retried submit returns the first result');
select is((select reserved from app.inventory_balances where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and variant_id = '8e100000-0000-4000-8000-000000000001'), 10.000::numeric, 'a retried submit does not reserve twice');
select throws_ok($$ select app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":20000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}',
  'portal-order-key-01', 'different-hash', 'order-request-1c') $$, 'HCS08', null, 'a reused key with a different order is rejected');

-- Holds: insufficient stock and credit go to the review queue without touching stock.
select is(app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000002","quantityMilli":9000}],"fulfillmentMethod":"pickup","paymentPreference":"bank_transfer"}',
  'portal-order-key-02', 'order-hash-2', 'order-request-2')->>'reviewReason', 'stock_insufficient', 'insufficient stock goes to review');
select is((select reserved from app.inventory_balances where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and variant_id = '8e100000-0000-4000-8000-000000000002'), 0.000::numeric, 'a held order reserves nothing');
select is(app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":80000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}',
  'portal-order-key-03', 'order-hash-3', 'order-request-3')->>'reviewReason', 'credit_limit', 'orders over the credit limit go to review');
select is((select count(*)::integer from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and status = 'submitted'), 2,
  'both held orders wait in the review queue');
select is(jsonb_array_length(app.load_reseller_portal_admin('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001')->'reviewQueue'), 2,
  'the Back Office review queue lists held orders');
select ok(exists(select 1 from (select jsonb_array_elements(app.load_wholesale_order_context('1e100000-0000-4000-8000-000000000001',
  '2e100000-0000-4000-8000-000000000001')->'orders') o) x where x.o->>'status' = 'submitted'),
  'held orders also appear in the wholesale order list');

-- Review: reject one, approve the other after restock through the Back Office confirmation path.
select throws_ok($$ select app.review_reseller_portal_order('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and review_reason = 'stock_insufficient'),
  '{"decision":"approve"}', 'portal-review-key-01', 'review-hash-1', 'review-request-1') $$,
  'HCQ10', null, 'approval still enforces available stock');
select is((select status from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and review_reason = 'stock_insufficient'),
  'submitted', 'a failed approval leaves the order in review');
update app.inventory_balances set on_hand = 50.000
where tenant_id = '2e100000-0000-4000-8000-000000000001' and variant_id = '8e100000-0000-4000-8000-000000000002';
select is(app.review_reseller_portal_order('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and review_reason = 'stock_insufficient'),
  '{"decision":"approve","reason":"Restocked this morning"}', 'portal-review-key-02', 'review-hash-2', 'review-request-2')->>'status',
  'confirmed', 'owner approves the held order after restock');
select is((select reserved from app.inventory_balances where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and variant_id = '8e100000-0000-4000-8000-000000000002'), 9.000::numeric, 'approval reserves stock');
select is((select actor_user_id from app.sales_order_reservation_ledger where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and variant_id = '8e100000-0000-4000-8000-000000000002'), '1e100000-0000-4000-8000-000000000001'::uuid, 'approval records the Back Office actor');
select throws_ok($$ select app.review_reseller_portal_order('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and review_reason = 'credit_limit'),
  '{"decision":"reject"}', 'portal-review-key-03', 'review-hash-3', 'review-request-3') $$,
  'HCRP3', null, 'rejection requires a reason');
select is(app.review_reseller_portal_order('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and review_reason = 'credit_limit'),
  '{"decision":"reject","reason":"Please settle the open balance first"}', 'portal-review-key-04', 'review-hash-4', 'review-request-4')->>'status',
  'cancelled', 'owner rejects the over-limit order');
select is((select jsonb_array_length(app.list_reseller_portal_orders('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001')->'orders')),
  3, 'reseller sees every portal order with its status');
select is((select o->>'reviewDecisionReason' from jsonb_array_elements(app.list_reseller_portal_orders('1e100000-0000-4000-8000-000000000010',
  '2e100000-0000-4000-8000-000000000001')->'orders') o where o->>'status' = 'cancelled'), 'Please settle the open balance first',
  'reseller sees the rejection reason');

-- Manual review setting and suspension.
select lives_ok($$
  select app.save_reseller_portal_settings('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
    jsonb_build_object('fulfillmentLocationId', '3e100000-0000-4000-8000-000000000001', 'applicationsOpen', false, 'autoConfirm', false),
    'portal-settings-key-02', 'settings-hash-2', 'settings-request-2')
$$, 'owner switches to manual review');
select is(app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":2000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}',
  'portal-order-key-04', 'order-hash-4', 'order-request-4')->>'reviewReason', 'manual_review', 'manual review holds every order');
select lives_ok($$ select app.set_reseller_account_status('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.reseller_accounts where tenant_id = '2e100000-0000-4000-8000-000000000001'), 'suspended', 'suspend-request') $$,
  'owner suspends the reseller account');
select throws_ok($$ select app.list_reseller_portal_orders('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001') $$,
  'HCRP1', null, 'a suspended reseller loses portal access');

-- Database roles: only the API role may execute the entry points.
select ok(has_function_privilege('hcs_hyperdrive', 'app.submit_reseller_portal_order(uuid,uuid,jsonb,text,text,text)', 'execute'),
  'API role executes portal order submission');
select ok(not has_function_privilege('anon', 'app.submit_reseller_application(text,jsonb,text)', 'execute'),
  'anonymous database role cannot submit applications directly');
select ok(not has_function_privilege('hcs_hyperdrive', 'app.create_reseller_account_core(uuid,uuid,uuid,text,uuid,uuid,text)', 'execute'),
  'API role cannot call private portal helpers');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.reseller_accounts', 'select'), 'API role has no direct table access');

select * from finish();
rollback;
