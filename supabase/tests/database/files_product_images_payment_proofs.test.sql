begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- Two tenants, an owner each, a member without catalog permission, and a reseller of tenant A.
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('1f200000-0000-4000-8000-000000000001', 'files-owner-a@example.invalid', 'authenticated', 'authenticated', now()),
  ('1f200000-0000-4000-8000-000000000002', 'files-owner-b@example.invalid', 'authenticated', 'authenticated', now()),
  ('1f200000-0000-4000-8000-000000000003', 'files-staff-a@example.invalid', 'authenticated', 'authenticated', now()),
  ('1f200000-0000-4000-8000-000000000010', 'files-reseller@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('2f200000-0000-4000-8000-000000000001', 'files-a', 'Files A'),
  ('2f200000-0000-4000-8000-000000000002', 'files-b', 'Files B');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('2f200000-0000-4000-8000-000000000001', '1f200000-0000-4000-8000-000000000001', 'active', true, now()),
  ('2f200000-0000-4000-8000-000000000002', '1f200000-0000-4000-8000-000000000002', 'active', true, now()),
  ('2f200000-0000-4000-8000-000000000001', '1f200000-0000-4000-8000-000000000003', 'active', false, now());
update app.tenant_entitlements set entitled = true, enabled = true
where tenant_id in ('2f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000002')
  and feature_code in ('advanced_wholesale', 'reseller_portal');
insert into app.locations (id, tenant_id, code, name) values
  ('3f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001', 'MAIN', 'Main');
insert into app.products (id, tenant_id, name, created_by) values
  ('7f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001', 'Coffee', '1f200000-0000-4000-8000-000000000001'),
  ('7f200000-0000-4000-8000-000000000002', '2f200000-0000-4000-8000-000000000002', 'Tea', '1f200000-0000-4000-8000-000000000002');
insert into app.product_variants (id, tenant_id, product_id, name, sku, retail_price, unit_cost, created_by) values
  ('8f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001', '7f200000-0000-4000-8000-000000000001',
   '250g', 'FCOF-250', 300.00, 150.00, '1f200000-0000-4000-8000-000000000001');
insert into app.inventory_balances (tenant_id, location_id, variant_id, on_hand, average_unit_cost) values
  ('2f200000-0000-4000-8000-000000000001', '3f200000-0000-4000-8000-000000000001', '8f200000-0000-4000-8000-000000000001', 100, 150);

create function pg_temp.image(file_id text) returns jsonb language sql as $$
  select jsonb_build_object('fileId', file_id, 'mimeType', 'image/jpeg', 'sizeBytes', 180000, 'thumbSizeBytes', 22000,
    'sha256', repeat('a', 64), 'originalFilename', 'coffee.jpg')
$$;

-- Product photos.
select throws_ok($$ select app.assert_product_image_upload('1f200000-0000-4000-8000-000000000003',
  '2f200000-0000-4000-8000-000000000001', '7f200000-0000-4000-8000-000000000001') $$,
  'HCFL1', null, 'a member without catalog permission cannot upload photos');
select throws_ok($$ select app.assert_product_image_upload('1f200000-0000-4000-8000-000000000001',
  '2f200000-0000-4000-8000-000000000001', '7f200000-0000-4000-8000-000000000002') $$,
  'HCFL3', null, 'another tenant''s product cannot receive photos');
select is(app.record_product_image('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  '7f200000-0000-4000-8000-000000000001', pg_temp.image('af200000-0000-4000-8000-000000000001'),
  'product-image-key-001', 'image-hash-1', 'image-request-1')->>'position', '0', 'the first photo is the primary photo');
select is(app.record_product_image('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  '7f200000-0000-4000-8000-000000000001', pg_temp.image('af200000-0000-4000-8000-000000000002'),
  'product-image-key-002', 'image-hash-2', 'image-request-2')->>'position', '1', 'later photos follow in order');
select is(app.record_product_image('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  '7f200000-0000-4000-8000-000000000001', pg_temp.image('af200000-0000-4000-8000-000000000099'),
  'product-image-key-002', 'image-hash-2', 'image-request-2b')->>'fileId', 'af200000-0000-4000-8000-000000000002',
  'a retried upload returns the first file and stores nothing new');
select is((select count(*)::integer from app.files where tenant_id = '2f200000-0000-4000-8000-000000000001'), 2,
  'retries do not create extra file records');
select is((select storage_key from app.files where id = 'af200000-0000-4000-8000-000000000001'),
  't/2f200000-0000-4000-8000-000000000001/product_image/af200000-0000-4000-8000-000000000001/main',
  'storage keys are derived from tenant, kind and file id');
select throws_ok($$ select app.record_product_image('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  '7f200000-0000-4000-8000-000000000001', pg_temp.image('af200000-0000-4000-8000-000000000003') - 'thumbSizeBytes',
  'product-image-key-003', 'image-hash-3', 'image-request-3') $$, 'HCFL2', null, 'product photos require a thumbnail');
select throws_ok($$ select app.record_product_image('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  '7f200000-0000-4000-8000-000000000001', pg_temp.image('af200000-0000-4000-8000-000000000003') || '{"mimeType":"application/pdf"}',
  'product-image-key-004', 'image-hash-4', 'image-request-4') $$, 'HCFL2', null, 'product photos must be images');
select throws_ok($$ select app.record_product_image('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  '7f200000-0000-4000-8000-000000000001', pg_temp.image('af200000-0000-4000-8000-000000000003') || '{"sizeBytes":3000000}',
  'product-image-key-005', 'image-hash-5', 'image-request-5') $$, 'HCFL2', null, 'oversized photos are rejected');

select is(app.reorder_product_images('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  '7f200000-0000-4000-8000-000000000001', '["af200000-0000-4000-8000-000000000002","af200000-0000-4000-8000-000000000001"]',
  'reorder-request')->>'primaryFileId', 'af200000-0000-4000-8000-000000000002', 'reordering changes the primary photo');
select throws_ok($$ select app.reorder_product_images('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  '7f200000-0000-4000-8000-000000000001', '["af200000-0000-4000-8000-000000000002"]', 'reorder-request-2') $$,
  'HCFL2', null, 'a reorder must list every current photo');
select is((app.list_catalog_images_for_member('1f200000-0000-4000-8000-000000000003', '2f200000-0000-4000-8000-000000000001')
  ->'images'->0->>'fileId'), 'af200000-0000-4000-8000-000000000002', 'members read photos in display order');
select throws_ok($$ select app.list_catalog_images_for_member('1f200000-0000-4000-8000-000000000002', '2f200000-0000-4000-8000-000000000001') $$,
  'HCFL1', null, 'another tenant''s owner cannot read photo keys');
select throws_ok($$ select app.list_catalog_images_for_pos(repeat('z', 64)) $$, 'HCFL1', null, 'an unknown POS session reads nothing');
select lives_ok($$ select app.archive_product_image('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  '7f200000-0000-4000-8000-000000000001', 'af200000-0000-4000-8000-000000000002', 'archive-request') $$, 'owner archives a photo');
select is(jsonb_array_length(app.list_catalog_images_for_member('1f200000-0000-4000-8000-000000000001',
  '2f200000-0000-4000-8000-000000000001')->'images'), 1, 'archived photos leave the catalog');
select throws_ok($$ update app.files set original_filename = 'renamed.jpg' where id = 'af200000-0000-4000-8000-000000000001' $$,
  'file records are immutable apart from archiving', 'file metadata cannot be rewritten');
select throws_ok($$ delete from app.files where id = 'af200000-0000-4000-8000-000000000001' $$,
  'files are archived, never deleted', 'file records cannot be deleted');

-- Payment proofs from a reseller.
select lives_ok($$
  select app.upsert_price_list('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
    jsonb_build_object('code', 'FILES', 'name', 'Files price', 'pricingType', 'wholesale', 'isDefault', true, 'isActive', true,
      'pricingGroup', jsonb_build_object('code', 'FILES-G', 'name', 'Group', 'thresholdMilli', 1000),
      'customerIds', jsonb_build_array(),
      'entries', jsonb_build_array(jsonb_build_object('variantId', '8f200000-0000-4000-8000-000000000001', 'unitPriceMinor', 20000))),
    'files-price-list-01', 'h', 'r')
$$, 'price list is configured');
select lives_ok($$
  select app.save_reseller_portal_settings('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
    jsonb_build_object('fulfillmentLocationId', '3f200000-0000-4000-8000-000000000001', 'applicationsOpen', true, 'autoConfirm', true),
    'files-settings-key-1', 'h', 'r')
$$, 'portal is configured');
select app.submit_reseller_application('files-a', '{"fullName":"Rosa Reyes","email":"files-reseller@example.invalid","phone":"09170000001"}', 'r');
select lives_ok($$
  select app.decide_reseller_application('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
    (select id from app.reseller_applications where tenant_id = '2f200000-0000-4000-8000-000000000001'),
    jsonb_build_object('decision', 'approve', 'priceListId', (select id from app.price_lists where code = 'FILES'),
      'paymentTerm', 'prepaid', 'creditLimitMinor', 1000000), 'files-approve-key-1', 'h', 'r')
$$, 'reseller is approved');
select app.load_reseller_portal_session('1f200000-0000-4000-8000-000000000010');
select is(jsonb_array_length(app.list_catalog_images_for_reseller('1f200000-0000-4000-8000-000000000010',
  '2f200000-0000-4000-8000-000000000001')->'images'), 1, 'resellers see the same product photos');
select throws_ok($$ select app.list_catalog_images_for_reseller('1f200000-0000-4000-8000-000000000010', '2f200000-0000-4000-8000-000000000002') $$,
  'HCRP1', null, 'resellers cannot read another tenant''s photos');
select is(app.submit_reseller_portal_order('1f200000-0000-4000-8000-000000000010', '2f200000-0000-4000-8000-000000000001',
  '{"lines":[{"variantId":"8f200000-0000-4000-8000-000000000001","quantityMilli":5000}],"fulfillmentMethod":"pickup","paymentPreference":"gcash"}',
  'files-order-key-0001', 'h1', 'r')->>'status', 'confirmed', 'reseller places an order');

create function pg_temp.proof(file_id text) returns jsonb language sql as $$
  select jsonb_build_object('fileId', file_id, 'mimeType', 'image/png', 'sizeBytes', 400000, 'thumbSizeBytes', 30000,
    'sha256', repeat('b', 64), 'originalFilename', 'gcash-receipt.png', 'amountMinor', 100000, 'reference', '1029 384 556 7', 'method', 'gcash')
$$;
select throws_ok($$ select app.record_payment_proof('1f200000-0000-4000-8000-000000000010', '2f200000-0000-4000-8000-000000000001',
  gen_random_uuid(), pg_temp.proof('bf200000-0000-4000-8000-000000000001'), 'payment-proof-key-00', 'p0', 'r') $$,
  'HCFL3', null, 'a proof needs one of the reseller''s own orders');
select is(app.record_payment_proof('1f200000-0000-4000-8000-000000000010', '2f200000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where order_number = 'RP-000001' and tenant_id = '2f200000-0000-4000-8000-000000000001'),
  pg_temp.proof('bf200000-0000-4000-8000-000000000001'), 'payment-proof-key-01', 'p1', 'r')->>'status', 'pending',
  'reseller uploads a GCash proof');
select is((select uploaded_by_reseller_account_id is not null from app.files where id = 'bf200000-0000-4000-8000-000000000001'), true,
  'the proof file records the reseller as uploader');
select throws_ok($$ select app.record_payment_proof('1f200000-0000-4000-8000-000000000010', '2f200000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where order_number = 'RP-000001' and tenant_id = '2f200000-0000-4000-8000-000000000001'),
  pg_temp.proof('bf200000-0000-4000-8000-000000000002') || '{"reference":"12"}', 'payment-proof-key-02', 'p2', 'r') $$,
  'HCFL2', null, 'a proof needs a payment reference');
select lives_ok($$ select app.record_payment_proof('1f200000-0000-4000-8000-000000000010', '2f200000-0000-4000-8000-000000000001',
  (select id from app.sales_orders where order_number = 'RP-000001' and tenant_id = '2f200000-0000-4000-8000-000000000001'),
  pg_temp.proof('bf200000-0000-4000-8000-000000000003') - 'thumbSizeBytes' || '{"mimeType":"application/pdf","originalFilename":"bank.pdf","method":"bank_transfer"}',
  'payment-proof-key-03', 'p3', 'r') $$, 'a bank transfer PDF proof is accepted without a thumbnail');
select is(jsonb_array_length((select o->'paymentProofs' from jsonb_array_elements(app.list_reseller_portal_orders(
  '1f200000-0000-4000-8000-000000000010', '2f200000-0000-4000-8000-000000000001')->'orders') o limit 1)), 2,
  'the reseller sees proofs on the order');
select is(jsonb_array_length(app.list_pending_payment_proofs('1f200000-0000-4000-8000-000000000001',
  '2f200000-0000-4000-8000-000000000001')->'proofs'), 2, 'the Back Office lists pending proofs');
select throws_ok($$ select app.list_pending_payment_proofs('1f200000-0000-4000-8000-000000000003', '2f200000-0000-4000-8000-000000000001') $$,
  'HCRA1', null, 'members without portal permission cannot review proofs');
select throws_ok($$ select app.review_payment_proof('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  (select id from app.payment_proofs where file_id = 'bf200000-0000-4000-8000-000000000003'), '{"decision":"reject"}', 'r') $$,
  'HCRP3', null, 'rejecting a proof requires a reason');
select is(app.review_payment_proof('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  (select id from app.payment_proofs where file_id = 'bf200000-0000-4000-8000-000000000001'), '{"decision":"accept"}', 'r')->>'status',
  'accepted', 'owner accepts the GCash proof');
select is(app.review_payment_proof('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  (select id from app.payment_proofs where file_id = 'bf200000-0000-4000-8000-000000000003'),
  '{"decision":"reject","reason":"Amount does not match the order"}', 'r')->>'status', 'rejected', 'owner rejects the bank proof');
select throws_ok($$ select app.review_payment_proof('1f200000-0000-4000-8000-000000000001', '2f200000-0000-4000-8000-000000000001',
  (select id from app.payment_proofs where file_id = 'bf200000-0000-4000-8000-000000000001'), '{"decision":"reject","reason":"Again"}', 'r') $$,
  'HCRA5', null, 'a reviewed proof cannot be reviewed again');
select is((select count(*)::integer from app.wholesale_payment_allocations where tenant_id = '2f200000-0000-4000-8000-000000000001'), 0,
  'accepting a proof does not post money');

-- Grants.
select ok(has_function_privilege('hcs_hyperdrive', 'app.record_payment_proof(uuid,uuid,uuid,jsonb,text,text,text)', 'execute'),
  'API role records proofs');
select ok(not has_function_privilege('hcs_hyperdrive', 'app.catalog_images_core(uuid)', 'execute'),
  'API role cannot read photo keys without a caller check');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.files', 'select'), 'API role has no direct file table access');

select * from finish();
rollback;
