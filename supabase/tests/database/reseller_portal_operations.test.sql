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
  pg_temp.proof('b0000000-0000-4000-8000-000000000002', 492000, 'BDO-551902', 'bank_transfer'), 'rep-proof-key-0002', 'h5', 'r5');
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

-- Shipping fee: ₱150 per delivery, free from ₱5,000.
select is(app.save_reseller_shipping_settings('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', '{"feeMinor":15000,"freeAboveMinor":500000}', 'ship-1')->>'feeMinor', '15000', 'the owner sets a ₱150 shipping fee');
select throws_ok($$ select app.save_reseller_shipping_settings('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', '{"feeMinor":-1,"freeAboveMinor":null}', 'ship-2') $$, 'HCRP3', null, 'a negative fee is refused');
select throws_ok($$ select app.save_reseller_shipping_settings('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', '{"feeMinor":0,"freeAboveMinor":null}', 'ship-3') $$, 'HCRA1', null, 'resellers cannot change shipping');
select is(app.load_reseller_portal_catalog('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001')->'shipping', '{"feeMinor": 15000, "freeAboveMinor": 500000}'::jsonb, 'the catalog shows the shipping rule');
select is((app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000001","quantityMilli":12000},{"variantId":"ff000000-0000-4000-8000-000000000003","quantityMilli":6000}],"fulfillmentMethod":"delivery","deliveryAddress":"Purok 3, Brgy. Maitim II, Tagaytay City","paymentPreference":"gcash"}',
  'ops-order-00000004', 'h', 'r')->>'totalMinor')::bigint, 366000::bigint, 'a ₱3,510 delivery order adds ₱150 shipping');
select is((select shipping_fee from app.sales_orders where order_number = 'RP-000004'), 150.00::numeric(18,2), 'the order keeps its shipping fee');
select is((app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000003","quantityMilli":6000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}',
  'ops-order-00000005', 'h', 'r')->>'shippingFeeMinor')::bigint, 0::bigint, 'pickup is free');
update app.reseller_portal_settings set free_shipping_minimum = 3000 where tenant_id = 'bb000000-0000-4000-8000-000000000001';
select is((app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000001","quantityMilli":12000},{"variantId":"ff000000-0000-4000-8000-000000000003","quantityMilli":6000}],"fulfillmentMethod":"delivery","deliveryAddress":"Purok 3, Brgy. Maitim II, Tagaytay City","paymentPreference":"gcash"}',
  'ops-order-00000006', 'h', 'r')->>'shippingFeeMinor')::bigint, 0::bigint, 'orders above the free-shipping amount ship free');

-- Partial shipment of RP-000004: one parcel now, the rest later.
select app.record_payment_proof('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000004'),
  pg_temp.proof('b0000000-0000-4000-8000-000000000004', 366000, 'GC-4444-0001', 'gcash'), 'ops-proof-key-0004', 'h', 'r');
select app.review_reseller_portal_order('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000004'),
  '{"decision":"approve"}', 'ops-review-key-0004', 'h', 'r');
select is((select total from app.sales_orders where order_number = 'RP-000004'), 3660.00::numeric(18,2), 'confirming keeps the shipping fee in the order total');
create function pg_temp.line(n text, sku text) returns text language sql as $$
  select l.id::text from app.sales_order_lines l where l.sales_order_id = pg_temp.o(n) and l.sku_snapshot = sku $$;
select throws_ok(format($$ select app.ship_portal_parcel('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', %L, jsonb_build_object('courier', 'jnt', 'lines', jsonb_build_array(jsonb_build_object('salesOrderLineId', %L, 'quantityMilli', 12000), jsonb_build_object('salesOrderLineId', %L, 'quantityMilli', 6000))), 'p0') $$,
  pg_temp.o('RP-000004'), pg_temp.line('RP-000004', 'BRK-250'), pg_temp.line('RP-000004', 'TBL-10')), 'HCRS2', null, 'a parcel cannot take the whole order');
select throws_ok(format($$ select app.ship_portal_parcel('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', %L, jsonb_build_object('courier', 'jnt', 'lines', jsonb_build_array(jsonb_build_object('salesOrderLineId', %L, 'quantityMilli', 1000))), 'p0') $$,
  pg_temp.o('RP-000002'), pg_temp.line('RP-000002', 'BRK-1K')), 'HCRS1', null, 'pickup or finished orders cannot be sent in parts');
select is((app.ship_portal_parcel('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000004'),
  jsonb_build_object('courier', 'lalamove', 'trackingNumber', 'LLM-55821', 'lines', jsonb_build_array(jsonb_build_object('salesOrderLineId', pg_temp.line('RP-000004', 'BRK-250'), 'quantityMilli', 6000))), 'p1')->>'parcelNumber')::integer,
  1, 'the first parcel ships six pouches');
select is((select status from app.sales_orders where id = pg_temp.o('RP-000004')), 'partially_fulfilled', 'the order is partly released');
select is((select total::text || '/' || shipping_fee::text from app.invoices where sales_order_id = pg_temp.o('RP-000004')), '1530.00/150.00', 'the parcel invoice carries the shipping fee');
select is((select on_hand from app.inventory_balances where variant_id = 'ff000000-0000-4000-8000-000000000001'), 222::numeric, 'six pouches left stock with the parcel');
select is((select recorded_amount from app.payment_proofs where sales_order_id = pg_temp.o('RP-000004')), 1530.00::numeric(18,2), 'the verified payment covers the parcel invoice');
select is(app.wholesale_invoice_open_balance('bb000000-0000-4000-8000-000000000001', (select id from app.invoices where sales_order_id = pg_temp.o('RP-000004'))), 0::numeric, 'the parcel invoice is paid');
select is((select count(*)::int from jsonb_array_elements(app.load_reseller_notifications('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 50)->'items') x where x->>'kind' = 'parcel_shipped'), 1, 'the reseller is told a parcel is on the way');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000004'), '{"status":"packed"}', 'p2');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000004'), '{"status":"shipped","courier":"jnt","trackingNumber":"JT00112233"}', 'p3');
select is((select string_agg(total::text, ',' order by shipping_fee desc) from app.invoices where sales_order_id = pg_temp.o('RP-000004')), '1530.00,2130.00', 'the rest ships on a second invoice without another fee');
select is((select status from app.sales_orders where id = pg_temp.o('RP-000004')), 'fulfilled', 'the whole order is released');
select is((select recorded_amount from app.payment_proofs where sales_order_id = pg_temp.o('RP-000004')), 3660.00::numeric(18,2), 'the payment is recorded across both invoices');
select is((select count(*)::int from app.wholesale_payments where reference = 'GC-4444-0001'), 2, 'one payment per invoice');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000004'), '{"status":"delivered"}', 'p4');
select ok((select delivered_at is not null from app.portal_parcels where sales_order_id = pg_temp.o('RP-000004')), 'delivering the last shipment marks the parcel delivered');
select is(jsonb_array_length(app.reseller_order_json('bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000004'))->'parcels'), 1, 'the reseller sees the parcel');

-- Printable invoice.
select is((app.load_reseller_invoice('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001',
  (select id from app.invoices where sales_order_id = pg_temp.o('RP-000004') order by shipping_fee desc limit 1))
  - 'branding' - 'invoiceId' - 'invoiceNumber' - 'issuedAt' - 'lines' - 'settlements' - 'dueDate'),
  '{"status": "paid", "taxMinor": 0, "totalMinor": 153000, "orderNumber": "RP-000004", "paymentTerm": "prepaid", "balanceMinor": 0, "businessName": "Kape ni Juan Trading", "customerName": "Maria Santos", "locationName": "Tagaytay Warehouse", "discountMinor": 0, "subtotalMinor": 138000, "customerNumber": "CUST-000001", "shippingFeeMinor": 15000}'::jsonb,
  'the invoice shows items, shipping, and the balance');
select throws_ok($$ select app.load_reseller_invoice('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001') $$, 'HCRI1', null, 'other invoices are not shown');

-- A return on the invoice that carried shipping refunds only the items.
select is((app.post_wholesale_return('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001',
  jsonb_build_object('invoiceId', (select id from app.invoices where sales_order_id = pg_temp.o('RP-000004') order by shipping_fee desc limit 1), 'reason', 'One pouch was damaged',
    'lines', jsonb_build_array(jsonb_build_object('invoiceLineId', (select l.id from app.invoice_lines l join app.invoices i on i.id = l.invoice_id where i.sales_order_id = pg_temp.o('RP-000004') and l.sku = 'BRK-250' order by i.shipping_fee desc limit 1), 'quantityMilli', 1000, 'returnToStock', true))),
  'ops-return-key-00001', 'h', 'r')->>'amountMinor')::bigint, 23000::bigint, 'returns work on invoices with shipping');

-- Return requests.
create function pg_temp.il(order_number text, sku text) returns text language sql as $$
  select l.id::text from app.invoice_lines l join app.invoices i on i.id = l.invoice_id where i.order_number_snapshot = order_number and l.sku = sku
  order by i.issued_at limit 1 $$;
select throws_ok(format($$ select app.submit_reseller_return_request('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId', (select id from app.invoices where order_number_snapshot = 'RP-000001'), 'reason', 'Torn pouches', 'lines', jsonb_build_array(jsonb_build_object('invoiceLineId', %L, 'quantityMilli', 11000))), 'rr-key-000000000001', 'h', 'r') $$, pg_temp.il('RP-000001', 'BRK-250')),
  'HCRR2', null, 'more than was invoiced less returns is refused');
select is((app.submit_reseller_return_request('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId', (select id from app.invoices where order_number_snapshot = 'RP-000001'), 'reason', 'Three more pouches were torn',
  'lines', jsonb_build_array(jsonb_build_object('invoiceLineId', pg_temp.il('RP-000001', 'BRK-250'), 'quantityMilli', 3000))), 'rr-key-000000000002', 'h', 'r')->>'status'), 'pending', 'the reseller asks to return three pouches');
select throws_ok(format($$ select app.submit_reseller_return_request('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId', (select id from app.invoices where order_number_snapshot = 'RP-000001'), 'reason', 'Another request', 'lines', jsonb_build_array(jsonb_build_object('invoiceLineId', %L, 'quantityMilli', 1000))), 'rr-key-000000000003', 'h', 'r') $$, pg_temp.il('RP-000001', 'TBL-10')),
  'HCRR1', null, 'one pending request per invoice');
select is((select x->>'returnableMilli' from jsonb_array_elements(app.reseller_order_json('bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000001'))->'invoices'->0->'lines') x where x->>'productName' = 'Barako Coffee Beans'), '7000', 'returnable quantity counts the pending request');
select lives_ok($$ select app.record_return_photo('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', (select id from app.reseller_return_requests limit 1),
  jsonb_build_object('fileId', 'b1000000-0000-4000-8000-000000000001', 'mimeType', 'image/jpeg', 'sizeBytes', 200000, 'thumbSizeBytes', 20000, 'sha256', repeat('d', 64), 'originalFilename', 'torn.jpg'), 'rr-photo-key-0000001', 'h', 'r') $$, 'the reseller adds a photo');
select app.sync_portal_notifications('bb000000-0000-4000-8000-000000000001');
select is((select count(*)::int from app.notifications where group_key = 'portal:return-request'), 1, 'the team is told about the request');
select is(jsonb_array_length(app.load_reseller_return_requests('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001')->'requests'->0->'photos'), 1, 'the team sees the photo');
select throws_ok($$ select app.decide_reseller_return_request('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', (select id from app.reseller_return_requests limit 1), '{"decision":"decline"}', 'r') $$, 'HCRP3', null, 'declining needs a reason');
select is(app.decide_reseller_return_request('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', (select id from app.reseller_return_requests limit 1), '{"decision":"approve"}', 'r')->>'status', 'approved', 'the team approves');
select throws_ok($$ select app.decide_reseller_return_request('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', (select id from app.reseller_return_requests limit 1), '{"decision":"approve"}', 'r') $$, 'HCRA5', null, 'a request is decided once');
select throws_ok($$ select app.assert_return_photo_upload('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', (select id from app.reseller_return_requests limit 1)) $$, 'HCRR5', null, 'no more photos after review');
select is((select x->>'title' from jsonb_array_elements(app.load_reseller_notifications('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 50)->'items') x where x->>'kind' = 'return_request_approved'),
  'Return request for ' || (select invoice_number::text from app.invoices where order_number_snapshot = 'RP-000001') || ' approved', 'the reseller is told it was approved');

select * from finish();
rollback;
