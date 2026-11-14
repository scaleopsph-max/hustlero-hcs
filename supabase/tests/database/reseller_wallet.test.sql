begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- Reseller wallet: credit from returns spent at checkout (setup shared with the self-service test).
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
  '{"fullName":"Maria Santos","businessName":"Maria Sari-Sari Store","email":"maria@demo.invalid","phone":"09171234567","address":{"line":"Blk 4 Lot 12, Mabini St.","barangayCode":"0402119001","barangay":"Kaybagal Central","cityCode":"0402119000","city":"Tagaytay City","provinceCode":"0402100000","province":"Cavite"}}', 'seed');
select app.submit_reseller_application('kape-ni-juan',
  '{"fullName":"Jun dela Cruz","email":"jun@demo.invalid","phone":"09181112222","message":"May tindahan po ako malapit sa palengke.","address":{"line":"Blk 4 Lot 12, Mabini St.","barangayCode":"0402119001","barangay":"Kaybagal Central","cityCode":"0402119000","city":"Tagaytay City","provinceCode":"0402100000","province":"Cavite"}}', 'seed');
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
select app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000003","quantityMilli":6000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}',
  'rep-order-0000003', 'h7', 'r7');
-- Maria reaches Platinum (a low threshold for the test), so RP-000002 can be confirmed with a downpayment on credit.
update app.reseller_portal_settings set tier_platinum_min_sales = 1000 where tenant_id = 'bb000000-0000-4000-8000-000000000001';
select app.evaluate_reseller_tier('bb000000-0000-4000-8000-000000000001', (select id from app.reseller_accounts where auth_user_id = 'aa000000-0000-4000-8000-000000000002'));
select app.record_payment_proof('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000002'),
  pg_temp.proof('b0000000-0000-4000-8000-000000000002', 300000, 'BDO-551902', 'bank_transfer'), 'rep-proof-key-0002', 'h5', 'r5');
select app.review_reseller_portal_order('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000002'),
  '{"decision":"approve"}', 'rep-review-key-0002', 'h6', 'r6');
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


-- Maria pays first from here on, so the wallet, not credit, decides each order.
update app.reseller_accounts set credit_hold = true where tenant_id = 'bb000000-0000-4000-8000-000000000001';
create function pg_temp.wallet() returns bigint language sql as $$
  select (app.load_reseller_portal_catalog('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001')->'account'->>'walletMinor')::bigint $$;
create function pg_temp.order(lines text, use_wallet boolean, key text) returns jsonb language sql as $$
  select app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001',
    ('{"lines":' || lines || ',"fulfillmentMethod":"pickup","paymentPreference":"gcash","useWallet":' || use_wallet || '}')::jsonb,
    key, key || '-h', key || '-r') $$;

select is(pg_temp.wallet(), 46000::bigint, 'the ₱460 return credit is in the wallet');

-- Part wallet, part payment.
select is(pg_temp.order('[{"variantId":"ff000000-0000-4000-8000-000000000003","quantityMilli":6000}]', true, 'wallet-order-0000001')
  - 'salesOrderId' - 'orderNumber' - 'paymentDueAt' - 'lineCount',
  '{"status":"submitted","onCredit":false,"totalMinor":75000,"walletMinor":46000,"reviewReason":"awaiting_payment","amountDueMinor":29000,"shippingFeeMinor":0}'::jsonb,
  'the wallet pays ₱460 of a ₱750 order and ₱290 is left to pay');
select is(pg_temp.wallet(), 0::bigint, 'the wallet is held for that order');
select is((app.load_reseller_statement('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001')->'summary'->>'walletHeldMinor')::bigint, 46000::bigint, 'the statement shows what is held');
select throws_ok($$ select app.apply_reseller_credit('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', jsonb_build_object('invoiceId',
  (select id from app.invoices where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number_snapshot = 'RP-000002'), 'amountMinor', 100), 'wallet-credit-00001', 'h', 'r') $$,
  'HCRB3', null, 'held wallet cannot be applied elsewhere');
select is(pg_temp.order('[{"variantId":"ff000000-0000-4000-8000-000000000003","quantityMilli":6000}]', true, 'wallet-order-0000001')->>'walletMinor',
  '46000', 'a repeated order request returns the same wallet use');

select app.record_payment_proof('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000004'),
  pg_temp.proof('b0000000-0000-4000-8000-000000000004', 29000, 'GC-4401-2201', 'gcash'), 'wallet-proof-key-0001', 'h', 'r');
select lives_ok($$ select app.review_reseller_portal_order('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000004'), '{"decision":"approve"}', 'wallet-review-00001', 'h', 'r') $$,
  'the ₱290 payment plus the ₱460 wallet covers the order');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000004'), '{"status":"packed"}', 'w1');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000004'), '{"status":"delivered"}', 'w2');
select is((select app.wholesale_invoice_open_balance('bb000000-0000-4000-8000-000000000001', id) from app.invoices where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number_snapshot = 'RP-000004'),
  0::numeric, 'the invoice is paid by the proof and the wallet');
select is((select (wallet_amount, wallet_applied)::text from app.sales_orders where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number = 'RP-000004'),
  '(460.00,460.00)', 'the held wallet was applied when invoiced');
select is((select count(*)::integer from app.wholesale_credit_applications where tenant_id = 'bb000000-0000-4000-8000-000000000001' and request_body->>'source' = 'reseller_wallet'),
  1, 'the wallet use is a credit application');
select is((app.load_reseller_wallet('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001')->'history'->0->>'amountMinor')::bigint, -46000::bigint, 'the wallet history shows the use');

-- A second return refills the wallet; an order it fully covers is confirmed at once.
select app.post_wholesale_return('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001',
  jsonb_build_object('invoiceId', (select id from app.invoices where order_number_snapshot = 'RP-000001'), 'reason', 'Ten pouches past their date',
    'lines', jsonb_build_array(jsonb_build_object('invoiceLineId', (select id from app.invoice_lines where invoice_id =
      (select id from app.invoices where order_number_snapshot = 'RP-000001') and sku = 'BRK-250'), 'quantityMilli', 10000, 'returnToStock', false))),
  'wallet-return-key-0002', 'h', 'r');
select is(pg_temp.wallet(), 230000::bigint, 'the second return adds ₱2,300');
select is(pg_temp.order('[{"variantId":"ff000000-0000-4000-8000-000000000003","quantityMilli":6000}]', true, 'wallet-order-0000002')->>'status',
  'confirmed', 'an order the wallet fully covers is confirmed without a payment proof');
select is((select reason from app.sales_order_reservation_ledger where tenant_id = 'bb000000-0000-4000-8000-000000000001' and sales_order_id = pg_temp.o('RP-000005') limit 1),
  'order_confirmed', 'its stock is reserved for the confirmed order');
select is(pg_temp.wallet(), 155000::bigint, '₱750 of the wallet is held for it');
select is(pg_temp.order('[{"variantId":"ff000000-0000-4000-8000-000000000003","quantityMilli":6000}]', false, 'wallet-order-0000003')->>'walletMinor',
  '0', 'turning the wallet off keeps it for later');
select is(pg_temp.wallet(), 155000::bigint, 'an order without the wallet holds none');

-- An order that expires gives its held wallet back.
select is(pg_temp.order('[{"variantId":"ff000000-0000-4000-8000-000000000001","quantityMilli":12000}]', true, 'wallet-order-0000004')->>'amountDueMinor',
  '121000', 'a ₱2,760 order takes the remaining ₱1,550');
select is(pg_temp.wallet(), 0::bigint, 'the whole wallet is held');
update app.sales_orders set payment_due_at = now() - interval '1 minute' where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number = 'RP-000007';
select app.expire_reseller_payment_holds('bb000000-0000-4000-8000-000000000001');
select is(pg_temp.wallet(), 155000::bigint, 'the expired order released its wallet');

-- The business cannot refund credit that a reseller order holds.
select is((select app.reseller_wallet_held('bb000000-0000-4000-8000-000000000001', customer_id) from app.reseller_accounts where tenant_id = 'bb000000-0000-4000-8000-000000000001'), 750::numeric,
  'RP-000005 still holds ₱750');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000005'), '{"status":"packed"}', 'w3');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000005'), '{"status":"delivered"}', 'w4');
select is((select app.wholesale_invoice_open_balance('bb000000-0000-4000-8000-000000000001', id) from app.invoices where tenant_id = 'bb000000-0000-4000-8000-000000000001' and order_number_snapshot = 'RP-000005'),
  0::numeric, 'the wallet-paid order is fully paid when invoiced');
select is(pg_temp.wallet(), 155000::bigint, 'nothing is held once it is invoiced');

select * from finish();
rollback;
