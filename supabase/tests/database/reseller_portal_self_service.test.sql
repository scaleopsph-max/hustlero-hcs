begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- Reseller self-service: credit, points, and reminders, on the same demo business the screenshots use.
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('aa000000-0000-4000-8000-000000000001', 'owner@demo.invalid', 'authenticated', 'authenticated', now()),
  ('aa000000-0000-4000-8000-000000000002', 'maria@demo.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values ('bb000000-0000-4000-8000-000000000001', 'kape-ni-juan', 'Kape ni Juan Trading');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('bb000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'active', true, now());
update app.tenant_entitlements set entitled = true, enabled = true
where tenant_id = 'bb000000-0000-4000-8000-000000000001' and feature_code in ('advanced_wholesale', 'reseller_portal', 'customers', 'inventory');
insert into app.locations (id, tenant_id, code, name) values
  ('cc000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'TAGAYTAY', 'Tagaytay Warehouse');
insert into app.product_categories (id, tenant_id, name, created_by) values
  ('dd000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'Coffee', 'aa000000-0000-4000-8000-000000000001'),
  ('dd000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 'Snacks', 'aa000000-0000-4000-8000-000000000001');
insert into app.products (id, tenant_id, name, category_id, created_by) values
  ('ee000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'Barako Coffee Beans', 'dd000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001'),
  ('ee000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 'Tablea Tsokolate', 'dd000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001'),
  ('ee000000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000001', 'Buko Pie Bites', 'dd000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000001');
insert into app.product_variants (id, tenant_id, product_id, name, sku, retail_price, unit_cost, created_by) values
  ('ff000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'ee000000-0000-4000-8000-000000000001', '250g pouch', 'BRK-250', 320.00, 150.00, 'aa000000-0000-4000-8000-000000000001'),
  ('ff000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 'ee000000-0000-4000-8000-000000000001', '1kg bag', 'BRK-1K', 1150.00, 560.00, 'aa000000-0000-4000-8000-000000000001'),
  ('ff000000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000001', 'ee000000-0000-4000-8000-000000000002', '10 tablets', 'TBL-10', 180.00, 70.00, 'aa000000-0000-4000-8000-000000000001'),
  ('ff000000-0000-4000-8000-000000000004', 'bb000000-0000-4000-8000-000000000001', 'ee000000-0000-4000-8000-000000000003', 'Box of 12', 'BKO-12', 240.00, 110.00, 'aa000000-0000-4000-8000-000000000001');
insert into app.inventory_balances (tenant_id, location_id, variant_id, on_hand, average_unit_cost) values
  ('bb000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000001', 240, 150.00),
  ('bb000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000002', 6, 560.00),
  ('bb000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000003', 120, 70.00);
insert into app.inventory_reorder_policies (tenant_id, location_id, variant_id, reorder_level, updated_by) values
  ('bb000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000002', 10, 'aa000000-0000-4000-8000-000000000001');
select app.upsert_price_list('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001',
  jsonb_build_object('code', 'RESELLER', 'name', 'Reseller price', 'pricingType', 'wholesale', 'isDefault', false, 'isActive', true,
    'pricingGroup', jsonb_build_object('code', 'RESELLER-MIN', 'name', 'Reseller items', 'thresholdMilli', 6000),
    'customerIds', jsonb_build_array(),
    'entries', jsonb_build_array(
      jsonb_build_object('variantId', 'ff000000-0000-4000-8000-000000000001', 'unitPriceMinor', 23000),
      jsonb_build_object('variantId', 'ff000000-0000-4000-8000-000000000002', 'unitPriceMinor', 82000),
      jsonb_build_object('variantId', 'ff000000-0000-4000-8000-000000000003', 'unitPriceMinor', 12500),
      jsonb_build_object('variantId', 'ff000000-0000-4000-8000-000000000004', 'unitPriceMinor', 17000))),
  'seed-price-list-0001', 'seed', 'seed');
select app.save_reseller_portal_settings('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001',
  jsonb_build_object('fulfillmentLocationId', 'cc000000-0000-4000-8000-000000000001',
    'defaultPriceListId', (select id from app.price_lists where tenant_id = 'bb000000-0000-4000-8000-000000000001' and code = 'RESELLER'),
    'applicationsOpen', true, 'autoConfirm', true), 'seed-settings-00001', 'seed', 'seed');
select app.submit_reseller_application('kape-ni-juan',
  '{"fullName":"Maria Santos","businessName":"Maria Sari-Sari Store","email":"maria@demo.invalid","phone":"09171234567","city":"Tagaytay"}', 'seed');
select app.submit_reseller_application('kape-ni-juan',
  '{"fullName":"Jun dela Cruz","email":"jun@demo.invalid","phone":"09181112222","city":"Silang","message":"May tindahan po ako malapit sa palengke."}', 'seed');
select app.decide_reseller_application('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001',
  (select id from app.reseller_applications where email = 'maria@demo.invalid'),
  jsonb_build_object('decision', 'approve',
    'priceListId', (select id from app.price_lists where tenant_id = 'bb000000-0000-4000-8000-000000000001' and code = 'RESELLER'),
    'paymentTerm', 'prepaid', 'creditLimitMinor', 1500000), 'seed-approve-00001', 'seed', 'seed');
select app.load_reseller_portal_session('aa000000-0000-4000-8000-000000000002');
-- One confirmed and one held order for the screenshots.
select app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000001","quantityMilli":12000},{"variantId":"ff000000-0000-4000-8000-000000000003","quantityMilli":6000}],"fulfillmentMethod":"delivery","deliveryAddress":"Purok 3, Brgy. Maitim II, Tagaytay City","paymentPreference":"gcash"}',
  'seed-order-0000001', 'seed-1', 'seed');
select app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000002","quantityMilli":6000}],"fulfillmentMethod":"pickup","paymentPreference":"bank_transfer"}',
  'seed-order-0000002', 'seed-2', 'seed');
-- Pay, confirm, and ship the orders.
create function pg_temp.proof(file_id text, amount bigint, ref text, method text) returns jsonb language sql as $$
  select jsonb_build_object('fileId', file_id, 'mimeType', 'image/png', 'sizeBytes', 400000, 'thumbSizeBytes', 30000,
    'sha256', repeat('c', 64), 'originalFilename', 'proof.png', 'amountMinor', amount, 'reference', ref, 'method', method)
$$;
create function pg_temp.o(n text) returns uuid language sql as $$
  select id from app.sales_orders where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number = n $$;
select app.record_payment_proof('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000001'),
  pg_temp.proof('b0000000-0000-4000-8000-000000000001', 351000, 'GC-7731-2045', 'gcash'), 'rep-proof-key-0001', 'h1', 'r1');
select app.review_reseller_portal_order('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000001'),
  '{"decision":"approve"}', 'rep-review-key-0001', 'h2', 'r2');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000001'), '{"status":"packed"}', 'r3');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000001'),
  '{"status":"shipped","courier":"jnt","trackingNumber":"JT0098765432"}', 'r4');
select app.record_payment_proof('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000002'),
  pg_temp.proof('b0000000-0000-4000-8000-000000000002', 300000, 'BDO-551902', 'bank_transfer'), 'rep-proof-key-0002', 'h5', 'r5');
select app.review_reseller_portal_order('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000002'),
  '{"decision":"approve"}', 'rep-review-key-0002', 'h6', 'r6');
select app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000003","quantityMilli":6000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}',
  'rep-order-0000003', 'h7', 'r7');
-- Loyalty on, RP-000002 picked up with a balance owed, and a return on the paid RP-000001 (credit).
update app.loyalty_policies set enabled = true, spend_per_point = 100 where tenant_id = 'bb000000-0000-4000-8000-000000000001';
select app.award_portal_loyalty('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where order_number = 'RP-000001'), 'seed-loyalty');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where order_number = 'RP-000002'), '{"status":"packed"}', 's1');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where order_number = 'RP-000002'), '{"status":"delivered"}', 's2');
select app.post_wholesale_return('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001',
  jsonb_build_object('invoiceId', (select id from app.invoices where order_number_snapshot = 'RP-000001'), 'reason', 'Two pouches arrived torn',
    'lines', jsonb_build_array(jsonb_build_object('invoiceLineId', (select id from app.invoice_lines where invoice_id =
      (select id from app.invoices where order_number_snapshot = 'RP-000001') and sku = 'BRK-250'), 'quantityMilli', 2000, 'returnToStock', false))),
  'seed-return-key-00001', 'h', 'r');

-- Points settings: owners and admins only.
select is(app.save_reseller_points_settings('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', '{"redeemValueMinor":100,"minimumPoints":10}', 'points-settings')->>'redeemValueMinor', '100',
  'the owner sets ₱1 per point with a 10-point minimum');
select throws_ok($$ select app.save_reseller_points_settings('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', '{"redeemValueMinor":-5,"minimumPoints":10}', 'r') $$, 'HCRP3', null,
  'a negative point value is refused');

-- Credit from the return pays part of the open invoice.
select is((app.load_reseller_statement('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001')->'summary'->>'creditAvailableMinor')::bigint, 46000::bigint, 'the return left ₱460 credit');
select throws_ok($$ select app.apply_reseller_credit('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId', (select id from app.invoices where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number_snapshot = 'RP-000002'), 'amountMinor', 50000), 'credit-key-0000000001', 'h', 'r') $$,
  'HCRB3', null, 'credit cannot exceed what is available');
select is((app.apply_reseller_credit('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId', (select id from app.invoices where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number_snapshot = 'RP-000002'), 'amountMinor', 46000), 'credit-key-0000000002', 'h2', 'r')->>'balanceMinor')::bigint,
  146000::bigint, 'applying ₱460 credit lowers the ₱1,920 balance to ₱1,460');
select is((app.apply_reseller_credit('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId', (select id from app.invoices where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number_snapshot = 'RP-000002'), 'amountMinor', 46000), 'credit-key-0000000002', 'h2', 'r')->>'balanceMinor')::bigint,
  146000::bigint, 'a repeated request applies the credit once');
select ok((select reseller_account_id is not null and recorded_by is null from app.wholesale_credit_applications where tenant_id = 'bb000000-0000-4000-8000-000000000001' limit 1),
  'the application is recorded as the reseller''s');
select throws_ok($$ select app.apply_reseller_credit('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId', (select id from app.invoices where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number_snapshot = 'RP-000001'), 'amountMinor', 100), 'credit-key-0000000003', 'h3', 'r') $$,
  'HCRB1', null, 'a paid invoice takes no more payment');

-- Points pay part of the invoice.
select throws_ok($$ select app.redeem_reseller_points('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId', (select id from app.invoices where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number_snapshot = 'RP-000002'), 'points', 5), 'points-key-000000001', 'h', 'r') $$,
  'HCRB5', null, 'fewer than the minimum points is refused');
select throws_ok($$ select app.redeem_reseller_points('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId', (select id from app.invoices where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number_snapshot = 'RP-000002'), 'points', 100000), 'points-key-000000002', 'h', 'r') $$,
  'HCRB2', null, 'points worth more than the balance are refused');
select is((app.redeem_reseller_points('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId', (select id from app.invoices where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number_snapshot = 'RP-000002'), 'points', 50), 'points-key-000000003', 'h', 'r')->>'balanceMinor')::bigint,
  141000::bigint, '50 points at ₱1 pay ₱50 of the invoice');
select is((select m.name || ':' || m.is_active from app.wholesale_payments p join app.payment_methods m on m.tenant_id = p.tenant_id and m.id = p.payment_method_id
  where p.tenant_id = 'bb000000-0000-4000-8000-000000000001' and p.reference = '50 points'), 'Loyalty points:false', 'the points payment uses a hidden Loyalty points method');
select ok(exists(select 1 from jsonb_array_elements(app.load_reseller_loyalty('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001')->'history') x where x->>'type' = 'redemption' and (x->>'points')::integer = -50), 'the redemption is in the points history');
select is((select lifetime_earned_points - balance_points from app.loyalty_accounts where tenant_id = 'bb000000-0000-4000-8000-000000000001'
  and customer_id = (select customer_id from app.reseller_accounts where tenant_id = 'bb000000-0000-4000-8000-000000000001')), 55::bigint, 'earned 84, gave back 5, spent 50');
select throws_ok($$ select app.redeem_reseller_points('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId', (select id from app.invoices where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number_snapshot = 'RP-000002'), 'points', 30), 'points-key-000000004', 'h', 'r') $$,
  'HCRB6', null, 'more points than the reseller has are refused');
update app.reseller_portal_settings set points_redeem_value = null where tenant_id = 'bb000000-0000-4000-8000-000000000001';
select throws_ok($$ select app.redeem_reseller_points('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId', (select id from app.invoices where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number_snapshot = 'RP-000002'), 'points', 10), 'points-key-000000005', 'h', 'r') $$,
  'HCRB4', null, 'paying with points is off until the business sets a value');

-- Reminder while the payment window is closing.
update app.sales_orders set payment_due_at = now() + interval '30 minutes' where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number = 'RP-000003';
select is((select x->>'title' from jsonb_array_elements(app.load_reseller_notifications('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 50)->'items') x where x->>'kind' = 'payment_window_closing'),
  'Send your payment for RP-000003', 'the reseller is reminded within the last hour of the payment window');

-- Branding.
select is(app.load_reseller_portal_catalog('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001')->'branding'->>'portalName', 'Kape ni Juan Trading', 'the portal uses the business name until branding is set');
select is(app.save_reseller_portal_branding('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', '{"portalName":"Kape Resellers","accentColor":"emerald"}', 'brand-1')->>'accentColor', 'emerald',
  'the owner picks an accent color');
select throws_ok($$ select app.save_reseller_portal_branding('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', '{"portalName":"Kape","accentColor":"neon"}', 'brand-2') $$, 'HCRP3', null,
  'only the offered colors are allowed');
select lives_ok($$ select app.record_brand_logo('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('fileId', 'be200000-0000-4000-8000-000000000001', 'mimeType', 'image/png',
  'sizeBytes', 20000, 'sha256', repeat('a', 64), 'originalFilename', 'logo.png'), 'brand-logo-key-00001', 'h', 'r') $$, 'the owner uploads a logo');
select is(app.load_reseller_portal_public('kape-ni-juan')->'branding'->>'logoStorageKey',
  't/bb000000-0000-4000-8000-000000000001/brand_logo/be200000-0000-4000-8000-000000000001/main', 'the application page shows the logo');
select is(app.load_reseller_portal_catalog('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001')->'branding'->>'portalName', 'Kape Resellers', 'resellers see the portal name');
select is(app.save_reseller_portal_branding('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', '{"portalName":null,"accentColor":"gold","removeLogo":true}', 'brand-3')->>'logoStorageKey', null,
  'removing the logo goes back to the default');
select throws_ok($$ select app.save_reseller_portal_branding('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', '{"portalName":null,"accentColor":"gold"}', 'brand-4') $$, 'HCRA1', null,
  'resellers cannot change branding');

select * from finish();
rollback;
