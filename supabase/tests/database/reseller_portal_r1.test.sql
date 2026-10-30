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
select ok(exists(select 1 from app.role_permissions rp join app.roles r on r.tenant_id = rp.tenant_id and r.id = rp.role_id
  where rp.tenant_id = '2e100000-0000-4000-8000-000000000001' and r.code = 'admin' and rp.permission_code = 'reseller_portal.manage'),
  'the admin role receives portal management');
select ok(not exists(select 1 from app.role_permissions rp join app.roles r on r.tenant_id = rp.tenant_id and r.id = rp.role_id
  where rp.tenant_id = '2e100000-0000-4000-8000-000000000001' and r.code in ('manager', 'cashier') and rp.permission_code = 'reseller_portal.manage'),
  'managers and cashiers do not manage the portal by default');

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

-- Pay first: every order holds its stock for four hours and waits for a payment proof.
select throws_ok($$ select app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":1000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}',
  'portal-order-key-00', 'order-hash-0', 'order-request-0') $$, 'HCRP5', null, 'wholesale minimum quantity is enforced');
select throws_ok($$ select app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":5000}],"fulfillmentMethod":"delivery","paymentPreference":"gcash"}',
  'portal-order-key-0a', 'order-hash-0a', 'order-request-0a') $$, 'HCRP3', null, 'delivery requires an address');
select is(app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":10000}],"fulfillmentMethod":"delivery","deliveryAddress":"Blk 4 Lot 2, Tagaytay City","paymentPreference":"gcash"}',
  'portal-order-key-01', 'order-hash-1', 'order-request-1')->>'reviewReason', 'awaiting_payment', 'a new order waits for payment');
select is((select status from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), 'submitted',
  'portal orders receive server-generated numbers and stay submitted until reviewed');
select is((select reserved from app.inventory_balances where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and variant_id = '8e100000-0000-4000-8000-000000000001'), 10.000::numeric, 'the order holds the shared branch stock');
select is((select count(*)::integer from app.sales_order_reservation_ledger where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and reason = 'payment_hold' and actor_reseller_account_id is not null and actor_user_id is null), 1,
  'the payment hold is recorded with the reseller as actor');
select ok((select payment_due_at between now() + interval '3 hours 59 minutes' and now() + interval '4 hours 1 minute'
  from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), 'the payment window is four hours');
select is(app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":10000}],"fulfillmentMethod":"delivery","deliveryAddress":"Blk 4 Lot 2, Tagaytay City","paymentPreference":"gcash"}',
  'portal-order-key-01', 'order-hash-1', 'order-request-1b')->>'orderNumber', 'RP-000001', 'a retried submit returns the first result');
select is((select reserved from app.inventory_balances where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and variant_id = '8e100000-0000-4000-8000-000000000001'), 10.000::numeric, 'a retried submit does not hold twice');
select throws_ok($$ select app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":20000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}',
  'portal-order-key-01', 'different-hash', 'order-request-1c') $$, 'HCS08', null, 'a reused key with a different order is rejected');

-- Out-of-stock and short items cannot be ordered; nothing is saved.
select throws_ok($$ select app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":2000},{"variantId":"8e100000-0000-4000-8000-000000000003","quantityMilli":2000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}',
  'portal-order-key-oos', 'order-hash-oos', 'order-request-oos') $$, 'HCRP7', null, 'an order with an out-of-stock item is rejected');
select throws_ok($$ select app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000002","quantityMilli":9000}],"fulfillmentMethod":"pickup","paymentPreference":"bank_transfer"}',
  'portal-order-key-short', 'order-hash-short', 'order-request-short') $$, 'HCRP8', null, 'an order larger than available stock is rejected');
select is((select count(*)::integer from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and source = 'reseller_portal'), 1,
  'rejected orders save nothing');
select is((select reserved from app.inventory_balances where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and variant_id = '8e100000-0000-4000-8000-000000000002'), 0.000::numeric, 'a rejected order holds nothing');

-- The team sees an order only after a payment proof arrives.
select is(jsonb_array_length(app.load_reseller_portal_admin('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001')->'reviewQueue'), 0,
  'orders awaiting payment are not in the review queue');
select is(jsonb_array_length(app.load_reseller_portal_admin('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001')->'awaitingPayment'), 1,
  'the Back Office sees how many orders await payment');
select throws_ok($$ select app.review_reseller_portal_order('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'),
  '{"decision":"approve"}', 'portal-review-key-00', 'review-hash-0', 'review-request-0') $$,
  'HCRA6', null, 'an order cannot be confirmed before the reseller pays');

create function pg_temp.proof(file_id text, amount bigint) returns jsonb language sql as $$
  select jsonb_build_object('fileId', file_id, 'mimeType', 'image/png', 'sizeBytes', 400000, 'thumbSizeBytes', 30000,
    'sha256', repeat('c', 64), 'originalFilename', 'gcash.png', 'amountMinor', amount, 'reference', 'GC-1029-3845', 'method', 'gcash')
$$;
select is(app.record_payment_proof('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'),
  pg_temp.proof('be100000-0000-4000-8000-000000000001', 50000), 'portal-proof-key-01', 'proof-hash-1', 'proof-request-1')->>'status',
  'pending', 'a downpayment proof is accepted');
select is((select review_reason from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), 'payment_review',
  'the first proof sends the order to review');
select is(jsonb_array_length(app.load_reseller_portal_admin('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001')->'reviewQueue'->0->'paymentProofs'), 1,
  'the review queue shows the order with its proof');
select is(jsonb_array_length(app.list_pending_payment_proofs('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001')->'proofs'), 0,
  'proofs on orders in review are handled from the review card');

-- One step: verify the payment and confirm the order.
select is(app.review_reseller_portal_order('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'),
  '{"decision":"approve"}', 'portal-review-key-01', 'review-hash-1', 'review-request-1')->>'status',
  'confirmed', 'owner verifies the payment and confirms the order');
select is((select status from app.payment_proofs where file_id = 'be100000-0000-4000-8000-000000000001'), 'accepted',
  'confirming verifies the pending proof');
select is((select reserved from app.inventory_balances where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and variant_id = '8e100000-0000-4000-8000-000000000001'), 10.000::numeric, 'the hold becomes the confirmed reservation');
select is((select array_agg(reason || ':' || quantity_delta order by reason) from app.sales_order_reservation_ledger
  where tenant_id = '2e100000-0000-4000-8000-000000000001' and sales_order_id = (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001')),
  array['order_confirmed:10.000', 'payment_hold:10.000', 'payment_hold_released:-10.000'], 'the ledger shows hold, release, and confirmation');
select ok(exists(select 1 from app.wholesale_order_credit_snapshots s join app.sales_orders o on o.tenant_id = s.tenant_id and o.id = s.sales_order_id
  where o.order_number = 'RP-000001'), 'confirmation snapshots the credit terms like Back Office confirmation');
select is(app.wholesale_verified_prepayments('2e100000-0000-4000-8000-000000000001', (select customer_id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001')), 500.00::numeric,
  'the verified downpayment counts as paid toward credit exposure');
select is(app.wholesale_credit_exposure('2e100000-0000-4000-8000-000000000001', (select customer_id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001')), 2000.00::numeric, 'exposure is the order total less the verified payment');

-- Logistics: the confirmed order waits to be packed, then moves forward one step at a time.
select is((select status from app.sales_order_shipments where tenant_id = '2e100000-0000-4000-8000-000000000001' and sales_order_id = (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001')), 'to_pack',
  'a confirmed portal order goes to Logistics as to pack');
select is(jsonb_array_length(app.load_reseller_portal_admin('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001')->'shipments'), 1, 'the Back Office lists the shipment');
select throws_ok($$ select app.update_portal_shipment('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), '{"status":"shipped","courier":"jnt"}', 'ship-1') $$,
  'HCRA5', null, 'an order must be packed before it ships');
select is(app.update_portal_shipment('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), '{"status":"packed"}', 'ship-2')->>'status', 'packed', 'owner marks the order packed');
select throws_ok($$ select app.update_portal_shipment('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), '{"status":"shipped"}', 'ship-3') $$,
  'HCRP3', null, 'shipping a delivery needs a courier');
select is(app.update_portal_shipment('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), '{"status":"shipped","courier":"jnt","trackingNumber":"JT0012345678"}', 'ship-4')->>'status',
  'shipped', 'owner ships with J&T and a tracking number');
select is((select o->'shipment'->>'trackingNumber' from jsonb_array_elements(app.list_reseller_portal_orders('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001')->'orders') o
  where o->>'orderNumber' = 'RP-000001'), 'JT0012345678', 'the reseller sees the courier tracking number');

-- Shipping completes the sale: stock leaves the warehouse, the invoice is issued, and the verified downpayment is recorded.
select is((select status from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), 'fulfilled', 'shipping fulfills the portal order');
select is((select sum(quantity) from app.inventory_movements where tenant_id = '2e100000-0000-4000-8000-000000000001' and movement_type = 'SALE'
  and source_reference = (select id::text from app.invoices where tenant_id = '2e100000-0000-4000-8000-000000000001' and sales_order_id = (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'))), -10.000::numeric, 'shipping takes the 10 units out of stock');
select is((select reserved from app.inventory_balances where tenant_id = '2e100000-0000-4000-8000-000000000001' and variant_id = '8e100000-0000-4000-8000-000000000001'), 0.000::numeric,
  'the shipped units are no longer reserved');
select is((select total from app.invoices where tenant_id = '2e100000-0000-4000-8000-000000000001' and sales_order_id = (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001')), 2500.00::numeric, 'one invoice covers the whole order');
select is((select payment_term from app.wholesale_invoice_charges where tenant_id = '2e100000-0000-4000-8000-000000000001' and sales_order_id = (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001')),
  (select payment_term from app.wholesale_order_credit_snapshots where tenant_id = '2e100000-0000-4000-8000-000000000001' and sales_order_id = (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001')), 'the invoice is charged with the confirmed credit term');
select is((select p.amount || ':' || p.reference || ':' || m.method_type || ':' || r.reference_last_four from app.payment_proofs proof
  join app.wholesale_payments p on p.tenant_id = proof.tenant_id and p.id = proof.wholesale_payment_id
  join app.payment_methods m on m.tenant_id = p.tenant_id and m.id = p.payment_method_id
  join app.wholesale_payment_references r on r.tenant_id = p.tenant_id and r.payment_id = p.id
  where proof.file_id = 'be100000-0000-4000-8000-000000000001'), '500.00:GC-1029-3845:e_wallet:3845',
  'the verified GCash proof is recorded as an e-wallet payment with its reference');
select is(app.wholesale_invoice_open_balance('2e100000-0000-4000-8000-000000000001', (select id from app.invoices where tenant_id = '2e100000-0000-4000-8000-000000000001' and sales_order_id = (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'))), 2000.00::numeric,
  'the invoice balance is the order total less the downpayment');
select is(app.wholesale_credit_exposure('2e100000-0000-4000-8000-000000000001', (select customer_id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001')), 2000.00::numeric,
  'exposure is unchanged by completing the sale');
select is((select payload->>'invoiceNumber' from app.portal_shipment_json('2e100000-0000-4000-8000-000000000001', (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001')) payload), (select invoice_number::text from app.invoices where tenant_id = '2e100000-0000-4000-8000-000000000001' and sales_order_id = (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001')),
  'Logistics shows the invoice number');
select is(app.fulfill_portal_order('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), 'again')->>'recordedPaymentMinor', '0', 'completing again records nothing twice');
-- A balance payment accepted after shipping is recorded right away.
select lives_ok($$ select app.record_payment_proof('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'),
  pg_temp.proof('be100000-0000-4000-8000-000000000009', 200000), 'portal-proof-key-09', 'proof-hash-9', 'proof-request-9') $$, 'the reseller sends the balance after shipping');
select lives_ok($$ select app.review_payment_proof('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.payment_proofs where file_id = 'be100000-0000-4000-8000-000000000009'), '{"decision":"accept"}', 'balance-review') $$, 'owner verifies the balance payment');
select is(app.wholesale_invoice_open_balance('2e100000-0000-4000-8000-000000000001', (select id from app.invoices where tenant_id = '2e100000-0000-4000-8000-000000000001' and sales_order_id = (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'))), 0.00::numeric,
  'the balance payment is recorded against the invoice as soon as it is verified');
select is((select count(*)::integer from app.wholesale_payments where tenant_id = '2e100000-0000-4000-8000-000000000001' and customer_id = (select customer_id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001')), 2,
  'each verified proof is one recorded payment');
select throws_ok($$ select app.update_portal_shipment('1e100000-0000-4000-8000-000000000003', '2e100000-0000-4000-8000-000000000001', (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), '{"status":"delivered"}', 'ship-5') $$,
  'HCRA1', null, 'members without portal permission cannot update shipments');
select is(app.update_portal_shipment('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), '{"status":"delivered"}', 'ship-6')->>'status', 'delivered', 'owner marks it delivered');
select throws_ok($$ select app.update_portal_shipment('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), '{"status":"delivered"}', 'ship-7') $$,
  'HCRA5', null, 'a delivered shipment cannot move again');

-- Reject: the hold is released and the pending proof is rejected with the same reason.
select is(app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000002","quantityMilli":6000}],"fulfillmentMethod":"pickup","paymentPreference":"bank_transfer"}',
  'portal-order-key-02', 'order-hash-2', 'order-request-2')->>'orderNumber', 'RP-000002', 'reseller places a second order');
select lives_ok($$ select app.record_payment_proof('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000002'),
  pg_temp.proof('be100000-0000-4000-8000-000000000002', 288000), 'portal-proof-key-02', 'proof-hash-2', 'proof-request-2') $$,
  'reseller sends the full payment');
select throws_ok($$ select app.review_reseller_portal_order('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000002'),
  '{"decision":"reject"}', 'portal-review-key-03', 'review-hash-3', 'review-request-3') $$,
  'HCRP3', null, 'rejection requires a reason');
select is(app.review_reseller_portal_order('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000002'),
  '{"decision":"reject","reason":"Reference not found in our GCash"}', 'portal-review-key-04', 'review-hash-4', 'review-request-4')->>'status',
  'cancelled', 'owner rejects the order');
select is((select reserved from app.inventory_balances where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and variant_id = '8e100000-0000-4000-8000-000000000002'), 0.000::numeric, 'rejection releases the hold');
select is((select status || ':' || review_reason from app.payment_proofs where file_id = 'be100000-0000-4000-8000-000000000002'),
  'rejected:Reference not found in our GCash', 'rejection also rejects the pending proof');

-- No proof within four hours: the order is cancelled and the stock comes back.
select is(app.submit_reseller_portal_order('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":2000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}',
  'portal-order-key-03', 'order-hash-3', 'order-request-3')->>'orderNumber', 'RP-000003', 'reseller places a third order');
select is(app.expire_reseller_payment_holds('2e100000-0000-4000-8000-000000000001'), 0, 'orders inside their window are kept');
update app.sales_orders set payment_due_at = now() - interval '1 minute' where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000003';
select throws_ok($$ select app.record_payment_proof('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000003'),
  pg_temp.proof('be100000-0000-4000-8000-000000000003', 50000), 'portal-proof-key-03', 'proof-hash-3', 'proof-request-3') $$,
  'HCFL6', null, 'a proof after the window is refused');
select is(app.expire_reseller_payment_holds(null), 1, 'the sweep cancels the expired order');
select is((select status || ':' || review_decision_reason from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000003'),
  'cancelled:Payment was not received within 4 hours.', 'the reseller sees why the order was cancelled');
select is((select reserved from app.inventory_balances where tenant_id = '2e100000-0000-4000-8000-000000000001'
  and variant_id = '8e100000-0000-4000-8000-000000000001'), 0.000::numeric, 'expiry releases the hold (the shipped order no longer reserves stock)');
select is(app.expire_reseller_payment_holds(null), 0, 'the sweep is idempotent');
select is((select jsonb_array_length(app.list_reseller_portal_orders('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001')->'orders')),
  3, 'reseller sees every portal order with its status');
select ok((select o ? 'paymentDueAt' from jsonb_array_elements(app.list_reseller_portal_orders('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001')->'orders') o limit 1),
  'orders carry the payment deadline');

-- Settings: payment instructions reach the reseller; auto-confirm is optional and ignored.
select lives_ok($$
  select app.save_reseller_portal_settings('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
    jsonb_build_object('fulfillmentLocationId', '3e100000-0000-4000-8000-000000000001', 'applicationsOpen', false,
      'paymentInstructions', 'GCash 0917 123 4567 (Juan D.)'),
    'portal-settings-key-02', 'settings-hash-2', 'settings-request-2')
$$, 'owner saves payment instructions');
select is(app.load_reseller_portal_catalog('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001')->'payment'->>'instructions', 'GCash 0917 123 4567 (Juan D.)',
  'the reseller sees where to pay');
select throws_ok($$
  select app.save_reseller_portal_settings('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
    jsonb_build_object('fulfillmentLocationId', '3e100000-0000-4000-8000-000000000001', 'applicationsOpen', false,
      'paymentInstructions', ''),
    'portal-settings-key-03', 'settings-hash-3', 'settings-request-3')
$$, 'HCRP3', null, 'blank payment instructions are refused; send null to clear them');
-- Payment accounts: GCash and bank details with QR images, shown to resellers by method.
select is(app.save_reseller_payment_account('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  '{"method":"gcash","providerName":"GCash","accountName":"Juan Dela Cruz","accountNumber":"0917 123 4567"}',
  'portal-pay-acct-key-01', 'acct-hash-1', 'acct-request-1')->>'status', 'saved', 'owner adds a GCash account');
select lives_ok($$ select app.save_reseller_payment_account('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  '{"method":"bank_transfer","providerName":"BDO Savings","accountName":"Kape ni Juan","accountNumber":"0012 3456 7890"}',
  'portal-pay-acct-key-02', 'acct-hash-2', 'acct-request-2') $$, 'owner adds a bank account');
select is((select count(*)::integer from app.reseller_payment_accounts where tenant_id = '2e100000-0000-4000-8000-000000000001'), 2,
  'two accounts are saved');
select is(app.save_reseller_payment_account('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  '{"method":"gcash","providerName":"GCash","accountName":"Juan Dela Cruz","accountNumber":"0917 123 4567"}',
  'portal-pay-acct-key-01', 'acct-hash-1', 'acct-request-1b')->>'accountId',
  (select id::text from app.reseller_payment_accounts where tenant_id = '2e100000-0000-4000-8000-000000000001' and method = 'gcash'), 'a retried save returns the first result');
select throws_ok($$ select app.save_reseller_payment_account('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  '{"method":"cash","providerName":"X","accountName":"Juan","accountNumber":"1"}',
  'portal-pay-acct-key-03', 'acct-hash-3', 'acct-request-3') $$, 'HCRP3', null, 'account details are validated');
select throws_ok($$ select app.save_reseller_payment_account('1e100000-0000-4000-8000-000000000003', '2e100000-0000-4000-8000-000000000001',
  '{"method":"gcash","providerName":"GCash","accountName":"Juan Dela Cruz","accountNumber":"0917 123 4567"}',
  'portal-pay-acct-key-04', 'acct-hash-4', 'acct-request-4') $$, 'HCRA1', null, 'members without portal permission cannot edit accounts');
select is(app.record_payment_qr('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', (select id from app.reseller_payment_accounts where tenant_id = '2e100000-0000-4000-8000-000000000001' and method = 'gcash'),
  jsonb_build_object('fileId', 'be100000-0000-4000-8000-0000000000a1', 'mimeType', 'image/png', 'sizeBytes', 20000,
    'thumbSizeBytes', 5000, 'sha256', repeat('d', 64), 'originalFilename', 'gcash-qr.png'),
  'portal-pay-qr-key-001', 'qr-hash-1', 'qr-request-1')->>'status', 'uploaded', 'owner uploads the GCash QR');
select lives_ok($$ select app.record_payment_qr('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', (select id from app.reseller_payment_accounts where tenant_id = '2e100000-0000-4000-8000-000000000001' and method = 'gcash'),
  jsonb_build_object('fileId', 'be100000-0000-4000-8000-0000000000a2', 'mimeType', 'image/png', 'sizeBytes', 20000,
    'sha256', repeat('e', 64), 'originalFilename', 'gcash-qr-new.png'),
  'portal-pay-qr-key-002', 'qr-hash-2', 'qr-request-2') $$, 'owner replaces the QR');
select is((select status from app.files where id = 'be100000-0000-4000-8000-0000000000a1'), 'archived', 'the old QR is archived');
select is(jsonb_array_length(app.load_reseller_portal_catalog('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001')->'payment'->'accounts'), 2, 'the reseller sees both accounts');
select is(app.load_reseller_portal_catalog('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001')->'payment'->'accounts'->0->>'qrStorageKey',
  't/2e100000-0000-4000-8000-000000000001/payment_qr/be100000-0000-4000-8000-0000000000a2/main', 'GCash comes first with its current QR');
select lives_ok($$ select app.save_reseller_payment_account('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  jsonb_build_object('id', (select id from app.reseller_payment_accounts where tenant_id = '2e100000-0000-4000-8000-000000000001' and method = 'bank_transfer'),
    'method', 'bank_transfer', 'providerName', 'BDO Savings', 'accountName', 'Kape ni Juan', 'accountNumber', '0012 3456 7890',
    'isActive', false), 'portal-pay-acct-key-05', 'acct-hash-5', 'acct-request-5') $$, 'owner hides the bank account');
select is(jsonb_array_length(app.load_reseller_portal_catalog('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001')->'payment'->'accounts'), 1, 'hidden accounts are not shown to resellers');
select is(jsonb_array_length(app.load_reseller_portal_admin('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001')->'paymentAccounts'), 2, 'the Back Office still lists hidden accounts');

-- Reseller notifications: one per event, derived from the orders, shipments, and proofs.
select is((select array_agg(x->>'kind' order by x->>'kind') from jsonb_array_elements(app.load_reseller_notifications('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', 50)->'items') x),
  array['delivered', 'order_confirmed', 'order_expired', 'order_rejected', 'payment_verified', 'shipped'],
  'the reseller is told about confirmation, shipping, delivery, a balance payment, expiry, and rejection');
select is((select x->>'message' from jsonb_array_elements(app.load_reseller_notifications('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', 50)->'items') x where x->>'kind' = 'shipped'),
  'Shipped by J&T Express · tracking JT0012345678.', 'the shipped notice names the courier and tracking number');
select is((select x->>'message' from jsonb_array_elements(app.load_reseller_notifications('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', 50)->'items') x where x->>'kind' = 'order_expired'),
  'Payment was not received within 4 hours.', 'the expiry notice says why');
select is((select count(*)::integer from app.reseller_notifications where tenant_id = '2e100000-0000-4000-8000-000000000001'), 6, 'loading again adds no duplicates');
select is((app.load_reseller_notifications('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', 50)->>'unreadCount')::integer, 6, 'all are unread at first');
select is((app.mark_reseller_notifications_read('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', (select id from app.reseller_notifications where tenant_id = '2e100000-0000-4000-8000-000000000001' and kind = 'shipped'))->>'unreadCount')::integer, 5,
  'opening one marks it read');
select is((app.mark_reseller_notifications_read('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', null)->>'unreadCount')::integer, 0, 'mark all read clears the badge');
select throws_ok($$ select app.mark_reseller_notifications_read('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', gen_random_uuid()) $$, 'HCRA4', null, 'unknown notifications are refused');
select throws_ok($$ select app.load_reseller_notifications('1e100000-0000-4000-8000-000000000012', '2e100000-0000-4000-8000-000000000001', 10) $$, 'HCRP1', null,
  'a stranger cannot read reseller notifications');
select throws_ok($$ update app.reseller_notifications set title = 'changed' where tenant_id = '2e100000-0000-4000-8000-000000000001' $$, 'P0001', null, 'notification history cannot be rewritten');
-- Back Office bell: a pending balance payment reaches the portal managers.
select lives_ok($$ select app.record_payment_proof('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', (select id from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'),
  pg_temp.proof('be100000-0000-4000-8000-00000000000a', 1000), 'portal-proof-key-10', 'proof-hash-10', 'proof-request-10') $$, 'the reseller sends another payment');
select is((select x->>'title' from jsonb_array_elements(app.load_notification_center('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', false, 50, 0)->'items') x
  where x->>'title' like 'Balance payment%'), 'Balance payment for RP-000001', 'the owner is told a balance payment is waiting');
select ok(not exists(select 1 from jsonb_array_elements(app.load_notification_center('1e100000-0000-4000-8000-000000000003', '2e100000-0000-4000-8000-000000000001', false, 50, 0)->'items') x
  where x->>'title' like 'Balance payment%'), 'members without portal permission are not told');
-- Cart stock check names the short items.
select is(app.reseller_cart_stock_issues('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', '[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":999000}]')->'stockIssues'->0->>'variantName',
  '250g', 'the cart check names the item without enough stock');
select is(jsonb_array_length(app.reseller_cart_stock_issues('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', '[{"variantId":"8e100000-0000-4000-8000-000000000001","quantityMilli":1000}]')->'stockIssues'), 0,
  'items with enough stock are not listed');

-- Web Push: subscriptions, one push per new notification, and dead endpoints switched off.
select throws_ok($$ select app.save_reseller_push_subscription('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', '{"endpoint":"http://insecure","p256dh":"x","auth":"y"}') $$, 'HCPU1', null,
  'push subscriptions must be valid https endpoints with keys');
select is(app.save_reseller_push_subscription('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', '{"endpoint":"https://push.example.test/sub/1","p256dh":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","auth":"aaaaaaaaaaaaaaaaaaaaaa"}')->>'enabled', 'true', 'the reseller turns on push');
select is(app.save_member_push_subscription('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', '{"endpoint":"https://push.example.test/sub/2","p256dh":"CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC","auth":"bbbbbbbbbbbbbbbbbbbbbb"}')->>'enabled', 'true', 'the owner turns on push');
select throws_ok($$ select app.save_member_push_subscription('1e100000-0000-4000-8000-000000000012', '2e100000-0000-4000-8000-000000000001', '{"endpoint":"https://push.example.test/sub/2","p256dh":"CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC","auth":"bbbbbbbbbbbbbbbbbbbbbb"}') $$, 'HCSN0', null,
  'only members can subscribe for Back Office pushes');
select is(jsonb_array_length(app.collect_push_batch(100)->'items'), 0, 'turning push on does not replay older notifications');
update app.push_subscriptions set created_at = now() - interval '1 hour' where tenant_id = '2e100000-0000-4000-8000-000000000001';
update app.reseller_notifications set read_at = null where tenant_id = '2e100000-0000-4000-8000-000000000001' and kind = 'shipped';
select is((select count(*)::integer from jsonb_array_elements(app.collect_push_batch(100)->'items') x where x->>'audience' = 'reseller'), 1,
  'unread reseller notifications after subscribing are pushed');
select is((select x->>'url' from jsonb_array_elements(app.collect_push_batch(100)->'items') x where x->>'audience' = 'reseller'),
  '/?order=' || (select id::text from app.sales_orders where tenant_id = '2e100000-0000-4000-8000-000000000001' and order_number = 'RP-000001'), 'the push opens the order');
select is((select x->>'url' from jsonb_array_elements(app.collect_push_batch(100)->'items') x where x->>'audience' = 'member' limit 1),
  '/reseller-portal', 'Back Office pushes open the reseller portal');
select ok(not exists(select 1 from jsonb_array_elements(app.collect_push_batch(100)->'items') x where x->>'title' like '%stock%'),
  'stock alerts and other bell items are not pushed');
select is((app.complete_push_batch(jsonb_build_object(
    'notifications', (select jsonb_agg(jsonb_build_object('audience', x->>'audience', 'notificationId', x->>'notificationId')) from jsonb_array_elements(app.collect_push_batch(100)->'items') x),
    'subscriptions', jsonb_build_array(
      jsonb_build_object('id', (select id from app.push_subscriptions where endpoint = 'https://push.example.test/sub/1'), 'outcome', 'sent'),
      jsonb_build_object('id', (select id from app.push_subscriptions where endpoint = 'https://push.example.test/sub/2'), 'outcome', 'gone'))))->>'disabled')::integer, 1,
  'a gone endpoint is switched off');
select is(jsonb_array_length(app.collect_push_batch(100)->'items'), 0, 'each notification is pushed once');
select ok((select last_success_at is not null from app.push_subscriptions where endpoint = 'https://push.example.test/sub/1'), 'working subscriptions are stamped');
select is(app.remove_push_subscription('1e100000-0000-4000-8000-000000000012', '2e100000-0000-4000-8000-000000000001', 'https://push.example.test/sub/1')->>'enabled', 'false', 'removing someone else''s endpoint changes nothing');
select ok((select disabled_at is null from app.push_subscriptions where endpoint = 'https://push.example.test/sub/1'), 'the reseller''s subscription stays on');
select lives_ok($$ select app.remove_push_subscription('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001', 'https://push.example.test/sub/1') $$, 'the reseller turns push off');
select ok((select disabled_at is not null from app.push_subscriptions where endpoint = 'https://push.example.test/sub/1'), 'push is off for that browser');
select throws_ok($$ update app.reseller_notifications set title = 'x', push_sent_at = now() where tenant_id = '2e100000-0000-4000-8000-000000000001' $$, 'P0001', null,
  'marking a push never allows rewriting the notification');

select lives_ok($$ select app.set_reseller_account_status('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001',
  (select id from app.reseller_accounts where tenant_id = '2e100000-0000-4000-8000-000000000001'), 'suspended', 'suspend-request') $$,
  'owner suspends the reseller account');
select throws_ok($$ select app.list_reseller_portal_orders('1e100000-0000-4000-8000-000000000010', '2e100000-0000-4000-8000-000000000001') $$,
  'HCRP1', null, 'a suspended reseller loses portal access');

-- Reseller portal report: one range covers every order placed in this test.
select is((app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', current_date - 1, current_date + 1)->'summary'->>'orderCount')::integer, 3, 'the report counts every portal order in the range');
select is((app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', current_date - 1, current_date + 1)->'summary'->>'salesMinor')::bigint, 250000::bigint, 'sales count confirmed orders only');
select is((app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', current_date - 1, current_date + 1)->'summary'->>'verifiedPaymentsMinor')::bigint, 250000::bigint, 'only accepted proofs count as received');
select is((app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', current_date - 1, current_date + 1)->'summary'->>'outstandingMinor')::bigint, 0::bigint, 'outstanding is confirmed sales minus verified payments');
select is((select jsonb_object_agg(x->>'status', (x->>'orderCount')::integer) from jsonb_array_elements(app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', current_date - 1, current_date + 1)->'byStatus') x),
  '{"awaiting_payment": 0, "for_confirmation": 0, "confirmed": 1, "expired": 1, "rejected": 1}'::jsonb,
  'orders are split into awaiting payment, for confirmation, confirmed, expired, and rejected');
select is(app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', current_date - 1, current_date + 1)->'byReseller'->0->>'customerName', 'Maria Santos', 'sales are grouped per reseller');
select is(app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', current_date - 1, current_date + 1)->'topProducts'->0->>'sku', 'COF-250', 'top products list the best-selling variant');
select is(app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', current_date - 1, current_date + 1)->'payments'->'receipts'->1->>'reference', 'GC-1029-3845', 'payments list each verified reference');
select is(app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', current_date - 1, current_date + 1)->'logistics'->'byCourier'->0->>'courier', 'jnt', 'logistics groups shipments per courier');
select is(app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', current_date - 1, current_date + 1)->'logistics'->'shipments'->0->>'trackingNumber', 'JT0012345678', 'logistics lists tracking numbers');
select is((app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', current_date + 2, current_date + 3)->'summary'->>'orderCount')::integer, 0,
  'a later range shows nothing');
select throws_ok($$ select app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000003', '2e100000-0000-4000-8000-000000000001', current_date, current_date) $$,
  'HCSD0', null, 'staff without reports or portal permission cannot read the report');
select throws_ok($$ select app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', current_date, current_date - 1) $$,
  'HCSD1', null, 'an inverted range is rejected');
select is((app.load_reseller_portal_report('1e100000-0000-4000-8000-000000000002', '2e100000-0000-4000-8000-000000000002', current_date - 1, current_date + 1)->'summary'->>'orderCount')::integer, 0,
  'another business sees none of these orders');

-- Database roles: only the API role may execute the entry points.
select ok(has_function_privilege('hcs_hyperdrive', 'app.submit_reseller_portal_order(uuid,uuid,jsonb,text,text,text)', 'execute'),
  'API role executes portal order submission');
select ok(not has_function_privilege('hcs_hyperdrive', 'app.reseller_payment_accounts_json(uuid,boolean)', 'execute'),
  'API role cannot read payment accounts without a caller check');
select ok(has_function_privilege('hcs_hyperdrive', 'app.update_portal_shipment(uuid,uuid,uuid,jsonb,text)', 'execute'),
  'API role updates shipments');
select ok(has_function_privilege('hcs_hyperdrive', 'app.expire_reseller_payment_holds(uuid)', 'execute'),
  'API role runs the payment-window sweep');
select ok(not has_function_privilege('hcs_hyperdrive', 'app.release_reseller_payment_hold(uuid,uuid,uuid,uuid)', 'execute'),
  'API role cannot release holds directly');
select ok(not has_function_privilege('anon', 'app.submit_reseller_application(text,jsonb,text)', 'execute'),
  'anonymous database role cannot submit applications directly');
select ok(not has_function_privilege('hcs_hyperdrive', 'app.create_reseller_account_core(uuid,uuid,uuid,text,uuid,uuid,text)', 'execute'),
  'API role cannot call private portal helpers');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.reseller_accounts', 'select'), 'API role has no direct table access');

select ok(not has_function_privilege('hcs_hyperdrive', 'app.fulfill_portal_order(uuid,uuid,uuid,text)', 'execute'),
  'API role cannot complete sales outside the shipment command');
select ok(not has_function_privilege('hcs_hyperdrive', 'app.update_portal_shipment_core(uuid,uuid,uuid,jsonb,text)', 'execute'),
  'API role cannot skip sale completion');
select ok(has_function_privilege('hcs_hyperdrive', 'app.load_reseller_notifications(uuid,uuid,integer)', 'execute'), 'API role loads reseller notifications');
select ok(not has_function_privilege('hcs_hyperdrive', 'app.sync_reseller_notifications(uuid,uuid)', 'execute'), 'API role cannot write notifications directly');
select ok(has_function_privilege('hcs_hyperdrive', 'app.collect_push_batch(integer)', 'execute'), 'API role collects pushes');
select ok(not has_function_privilege('hcs_hyperdrive', 'app.save_push_subscription(uuid,uuid,uuid,jsonb)', 'execute'), 'API role cannot save subscriptions for anyone');
select ok(has_function_privilege('hcs_hyperdrive', 'app.load_reseller_portal_report(uuid,uuid,date,date)', 'execute'),
  'API role loads the reseller portal report');
select * from finish();
rollback;
