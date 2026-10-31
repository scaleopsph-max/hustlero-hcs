begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- Reseller tiers: referrals, thresholds, Platinum credit, points per tier.
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('aa000000-0000-4000-8000-000000000001', 'owner@demo.invalid', 'authenticated', 'authenticated', now()),
  ('aa000000-0000-4000-8000-000000000002', 'maria@demo.invalid', 'authenticated', 'authenticated', now()),
  ('aa000000-0000-4000-8000-000000000003', 'jun@demo.invalid', 'authenticated', 'authenticated', now());
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

select app.decide_reseller_application('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001',
  (select id from app.reseller_applications where email = 'maria@demo.invalid'),
  jsonb_build_object('decision', 'approve',
    'priceListId', (select id from app.price_lists where tenant_id = 'bb000000-0000-4000-8000-000000000001' and code = 'RESELLER'),
    'paymentTerm', 'prepaid', 'creditLimitMinor', 1500000), 'seed-approve-00001', 'seed', 'seed');
select app.load_reseller_portal_session('aa000000-0000-4000-8000-000000000002');
create function pg_temp.acct(u uuid) returns uuid language sql as $$ select id from app.reseller_accounts where auth_user_id = u $$;
create function pg_temp.o(n text) returns uuid language sql as $$ select id from app.sales_orders where order_number = n $$;
create function pg_temp.credit(u uuid) returns text language sql as $$
  select s.payment_term || ':' || s.credit_limit from app.wholesale_customer_credit_settings s
  where s.customer_id = (select customer_id from app.reseller_accounts where auth_user_id = u) order by s.revision desc limit 1 $$;
create function pg_temp.proof(file_id text, amount bigint) returns jsonb language sql as $$
  select jsonb_build_object('fileId', file_id, 'mimeType', 'image/png', 'sizeBytes', 400000, 'sha256', repeat('c', 64),
    'originalFilename', 'proof.png', 'amountMinor', amount, 'reference', 'GC-7000-' || right(file_id, 4), 'method', 'gcash') $$;

-- Every reseller starts as Silver, without credit, and has a referral code.
select is((select tier from app.reseller_accounts where id = pg_temp.acct('aa000000-0000-4000-8000-000000000002')), 'silver', 'a new reseller is Silver');
select is(pg_temp.credit('aa000000-0000-4000-8000-000000000002'), 'prepaid:0.00', 'Silver has no credit, whatever the approval chose');
select ok((select referral_code ~ '^[A-Z0-9]{8}$' from app.reseller_accounts where id = pg_temp.acct('aa000000-0000-4000-8000-000000000002')), 'each reseller gets a referral code');

-- Referral link: Jun applies with Maria's code and is linked to her once approved.
select app.submit_reseller_application('kape-ni-juan', jsonb_build_object('fullName', 'Jun dela Cruz', 'email', 'jun@demo.invalid',
  'phone', '09181112222', 'referralCode', (select lower(referral_code) from app.reseller_accounts where id = pg_temp.acct('aa000000-0000-4000-8000-000000000002'))), 'jun');
select is((select status from app.reseller_applications where email = 'jun@demo.invalid'), 'pending', 'the application is received');
select is(app.submit_reseller_application('kape-ni-juan', '{"fullName":"Ana Reyes","email":"ana@demo.invalid","phone":"09170000000","referralCode":"NOPE1234"}', 'ana')->>'status',
  'received', 'an unknown referral code is ignored');
select app.decide_reseller_application('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', (select id from app.reseller_applications where email = 'jun@demo.invalid'),
  jsonb_build_object('decision', 'approve', 'priceListId', (select id from app.price_lists where code = 'RESELLER'),
    'paymentTerm', 'net_30', 'creditLimitMinor', 1000000), 'tier-approve-jun-01', 'h', 'r');
select app.load_reseller_portal_session('aa000000-0000-4000-8000-000000000003');
select is((select referred_by_account_id from app.reseller_accounts where id = pg_temp.acct('aa000000-0000-4000-8000-000000000003')), pg_temp.acct('aa000000-0000-4000-8000-000000000002'), 'Jun is Maria''s referral');
select is(pg_temp.credit('aa000000-0000-4000-8000-000000000003'), 'prepaid:0.00', 'credit chosen at approval is replaced by the tier''s');
select is((app.reseller_tier_metrics('bb000000-0000-4000-8000-000000000001', pg_temp.acct('aa000000-0000-4000-8000-000000000002'))->>'activeReferrals')::int, 0, 'a referral counts once they buy');

-- Settings: owners only, and higher tiers must need more.
select throws_ok($$ select app.save_reseller_tier_settings('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', '{"goldMinReferrals":5,"goldMinSalesMinor":20000000,"platinumMinReferrals":5,"platinumMinSalesMinor":50000000,"silverSpendPerPointMinor":10000,"goldSpendPerPointMinor":8000,"platinumSpendPerPointMinor":5000,"platinumCreditLimitMinor":2000000,"platinumPaymentTerm":"net_15","activeDays":90}', 'r') $$,
  'HCRP3', null, 'Platinum must need more referrals than Gold');
select throws_ok($$ select app.save_reseller_tier_settings('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', '{"goldMinReferrals":1,"goldMinSalesMinor":20000000,"platinumMinReferrals":15,"platinumMinSalesMinor":50000000,"silverSpendPerPointMinor":10000,"goldSpendPerPointMinor":8000,"platinumSpendPerPointMinor":5000,"platinumCreditLimitMinor":2000000,"platinumPaymentTerm":"net_15","activeDays":90}', 'r') $$,
  'HCRA1', null, 'resellers cannot change tier settings');
select is(app.save_reseller_tier_settings('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', '{"goldMinReferrals":1,"goldMinSalesMinor":20000000,"platinumMinReferrals":15,"platinumMinSalesMinor":50000000,"silverSpendPerPointMinor":10000,"goldSpendPerPointMinor":8000,"platinumSpendPerPointMinor":5000,"platinumCreditLimitMinor":2000000,"platinumPaymentTerm":"net_15","activeDays":90}', 'r')->>'goldMinReferrals',
  '1', 'the owner sets Gold at one active referral');

-- Silver pays in full: a downpayment does not confirm the order.
select app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000001', '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000003","quantityMilli":6000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}', 'tier-order-jun-0001', 'h', 'r');
select app.record_payment_proof('aa000000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000001'), pg_temp.proof('b9000000-0000-4000-8000-000000000001', 30000), 'tier-proof-jun-0001', 'h', 'r');
select throws_ok($$ select app.review_reseller_portal_order('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000001'), '{"decision":"approve"}', 'tier-review-jun-0001', 'h', 'r') $$,
  'HCRT1', null, 'a Silver downpayment does not confirm the order');
select app.record_payment_proof('aa000000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000001'), pg_temp.proof('b9000000-0000-4000-8000-000000000002', 45000), 'tier-proof-jun-0002', 'h', 'r');
select is(app.review_reseller_portal_order('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000001'), '{"decision":"approve"}', 'tier-review-jun-0002', 'h', 'r')->>'status',
  'confirmed', 'paid in full, the order is confirmed');

-- Jun's first sale makes him an active referral: Maria moves up to Gold and is told.
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000001'), '{"status":"packed"}', 'r');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000001'), '{"status":"delivered"}', 'r');
select is((select tier from app.reseller_accounts where id = pg_temp.acct('aa000000-0000-4000-8000-000000000002')), 'gold', 'one active referral makes Maria Gold');
select is((select title from app.reseller_notifications where reseller_account_id = pg_temp.acct('aa000000-0000-4000-8000-000000000002') and kind = 'tier_changed'), 'You are now Gold!', 'Maria is told');
select is(pg_temp.credit('aa000000-0000-4000-8000-000000000002'), 'prepaid:0.00', 'Gold still has no credit');

-- Platinum by sales: credit at the Platinum term and limit.
update app.reseller_portal_settings set tier_platinum_min_sales = 1000 where tenant_id = 'bb000000-0000-4000-8000-000000000001';
select app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000001","quantityMilli":6000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}', 'tier-order-maria-001', 'h', 'r');
select app.record_payment_proof('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000002'), pg_temp.proof('b9000000-0000-4000-8000-000000000003', 138000), 'tier-proof-maria-001', 'h', 'r');
select app.review_reseller_portal_order('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000002'), '{"decision":"approve"}', 'tier-review-maria-01', 'h', 'r');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000002'), '{"status":"packed"}', 'r');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000002'), '{"status":"delivered"}', 'r');
select is((select tier from app.reseller_accounts where id = pg_temp.acct('aa000000-0000-4000-8000-000000000002')), 'platinum', '₱1,380 in sales passes the test Platinum threshold');
select is(pg_temp.credit('aa000000-0000-4000-8000-000000000002'), 'net_15:20000.00', 'Platinum gets ₱20,000 at net 15');
select is((app.load_reseller_portal_catalog('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001')->'account'->>'creditOrderingMinor')::bigint, 2000000::bigint, 'the cart knows Maria can order on credit');

-- A Platinum order within the limit is confirmed at once, on credit.
select is(app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000001","quantityMilli":10000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}', 'tier-order-maria-002', 'h', 'r')->>'status',
  'confirmed', 'a credit order is confirmed without a payment');
select is((select on_credit::text || ':' || coalesce(payment_due_at::text, 'none') from app.sales_orders where id = pg_temp.o('RP-000003')), 'true:none', 'no payment window');
select is((select status from app.sales_order_shipments where sales_order_id = pg_temp.o('RP-000003')), 'to_pack', 'it goes straight to Logistics');
select is((app.load_reseller_portal_catalog('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001')->'account'->>'creditOrderingMinor')::bigint, 2000000::bigint - 230000, 'the order uses ₱2,300 of the limit');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000003'), '{"status":"packed"}', 'r');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000003'), '{"status":"delivered"}', 'r');
select is((select payment_term || ':' || (due_date - (issued_at at time zone 'Asia/Manila')::date) from app.wholesale_invoice_charges c join app.invoices i on i.id = c.invoice_id where i.sales_order_id = pg_temp.o('RP-000003')),
  'net_15:15', 'the invoice is due in 15 days');
select is((select count(*)::int from app.loyalty_transactions t join app.invoices i on i.sale_id = t.sale_id where i.sales_order_id = pg_temp.o('RP-000003')), 0,
  'an unpaid credit order earns no points yet');

-- Over the limit, the order is pay-first.
select is(app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000001","quantityMilli":90000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}', 'tier-order-maria-003', 'h', 'r')->>'reviewReason',
  'awaiting_payment', 'an order above the available credit waits for payment');

-- Paying the credit invoice earns points at the Platinum rate (₱50 per point).
update app.loyalty_policies set enabled = true, spend_per_point = 100 where tenant_id = 'bb000000-0000-4000-8000-000000000001';
select app.record_payment_proof('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000003'), pg_temp.proof('b9000000-0000-4000-8000-000000000004', 230000), 'tier-proof-maria-004', 'h', 'r');
select app.review_payment_proof('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', (select id from app.payment_proofs where file_id = 'b9000000-0000-4000-8000-000000000004'), '{"decision":"accept"}', 'r');
select is((select t.points_delta::text || '@' || t.spend_per_point_centavos from app.loyalty_transactions t join app.invoices i on i.sale_id = t.sale_id
  where i.sales_order_id = pg_temp.o('RP-000003')), '46@5000', 'paid in full, the order earns 46 points at ₱50 each');

-- Credit hold and overdue invoices stop credit ordering; the tier stays.
select is(app.save_reseller_account_controls('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.acct('aa000000-0000-4000-8000-000000000002'), '{"creditHold":true}', 'r')->>'creditHold', 'true', 'the owner puts Maria on credit hold');
select is(pg_temp.credit('aa000000-0000-4000-8000-000000000002'), 'prepaid:0.00', 'credit hold removes the credit');
select is(app.reseller_credit_block_reason('bb000000-0000-4000-8000-000000000001', pg_temp.acct('aa000000-0000-4000-8000-000000000002')), 'on_hold', 'the portal says why');
select is((select tier from app.reseller_accounts where id = pg_temp.acct('aa000000-0000-4000-8000-000000000002')), 'platinum', 'the tier stays');
select app.save_reseller_account_controls('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.acct('aa000000-0000-4000-8000-000000000002'), '{"creditHold":false,"creditLimitOverrideMinor":3000000}', 'r');
select is(pg_temp.credit('aa000000-0000-4000-8000-000000000002'), 'net_15:30000.00', 'releasing the hold restores credit, here with a ₱30,000 limit just for Maria');
select app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000001","quantityMilli":6000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}', 'tier-order-maria-005', 'h', 'r');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000005'), '{"status":"packed"}', 'r');
select app.update_portal_shipment('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.o('RP-000005'), '{"status":"delivered"}', 'r');
-- Test only: age the invoice past its due date.
alter table app.wholesale_invoice_charges disable trigger user;
update app.wholesale_invoice_charges set due_date = current_date - 3 where sales_order_id = pg_temp.o('RP-000005');
alter table app.wholesale_invoice_charges enable trigger user;
select is(app.reseller_credit_block_reason('bb000000-0000-4000-8000-000000000001', pg_temp.acct('aa000000-0000-4000-8000-000000000002')), 'overdue', 'an overdue invoice stops credit ordering');
select is(app.submit_reseller_portal_order('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', '{"lines":[{"variantId":"ff000000-0000-4000-8000-000000000003","quantityMilli":6000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}', 'tier-order-maria-006', 'h', 'r')->>'reviewReason',
  'awaiting_payment', 'with an overdue invoice, orders are pay-first');

-- Referrals cannot loop.
select throws_ok($$ select app.save_reseller_account_controls('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', pg_temp.acct('aa000000-0000-4000-8000-000000000002'), jsonb_build_object('referredByAccountId', pg_temp.acct('aa000000-0000-4000-8000-000000000003')), 'r') $$,
  'HCRP3', null, 'Maria cannot be referred by her own referral');

-- The tier card.
select is((select jsonb_build_object('tier', x->'tier', 'referrals', jsonb_array_length(x->'referrals'), 'active', x->'referrals'->0->'active', 'blocked', x->'credit'->'blockedReason')
  from app.load_reseller_tier('aa000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001') x), '{"tier": "platinum", "active": true, "blocked": "overdue", "referrals": 1}'::jsonb, 'Maria sees her tier, her referral, and why credit is paused');

select * from finish();
rollback;
