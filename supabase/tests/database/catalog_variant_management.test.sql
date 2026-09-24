begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select ok(not has_function_privilege(
  'anon',
  'app.create_catalog_variant(uuid,uuid,uuid,text,text,numeric,numeric,boolean,text[],text,text,text)',
  'EXECUTE'
), 'anon cannot call variant command directly');
select ok(has_function_privilege(
  'hcs_hyperdrive',
  'app.create_catalog_variant(uuid,uuid,uuid,text,text,numeric,numeric,boolean,text[],text,text,text)',
  'EXECUTE'
), 'API login can create variants');

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('14000000-0000-4000-8000-000000000001', 'variant-owner@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('24000000-0000-4000-8000-000000000001', 'variant-one', 'Variant One'),
  ('24000000-0000-4000-8000-000000000002', 'variant-two', 'Variant Two');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('24000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('24000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000001', 'active', true, now());

select lives_ok(
  $$select app.create_catalog_product(
    '14000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001',
    'Basic Tee', null, 'Shirts', 'Black / Small', 'TEE-BLK-S', 999, 600, true,
    array['480000000101'], 'variant-base-001', 'variant-base-hash', 'variant-base-request'
  )$$,
  'owner can create the base product'
);
select lives_ok(
  $$select app.create_catalog_variant(
    '14000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001',
    (select id from app.products where tenant_id = '24000000-0000-4000-8000-000000000001'),
    'Black / XL', 'TEE-BLK-XL', 999, 600, true, array['480000000102'],
    'variant-create-001', 'variant-create-hash', 'variant-create-request'
  )$$,
  'owner can add a variant'
);
select is((select count(*)::integer from app.product_variants where tenant_id = '24000000-0000-4000-8000-000000000001'), 2, 'product has two variants');
select is((select sku::text from app.product_variants where tenant_id = '24000000-0000-4000-8000-000000000001' and sku = 'TEE-BLK-XL'), 'TEE-BLK-XL', 'variant SKU is stored');
select is((select count(*)::integer from app.product_barcodes where tenant_id = '24000000-0000-4000-8000-000000000001' and barcode = '480000000102'), 1, 'variant barcode is stored');
select is((select count(*)::integer from audit.audit_events where tenant_id = '24000000-0000-4000-8000-000000000001' and action = 'catalog.variant.created'), 1, 'variant creation is audited');
select is((select count(*)::integer from integration.event_outbox where tenant_id = '24000000-0000-4000-8000-000000000001' and topic = 'catalog.variant.created'), 1, 'variant creation emits one outbox event');
select lives_ok(
  $$select app.create_catalog_variant(
    '14000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001',
    (select id from app.products where tenant_id = '24000000-0000-4000-8000-000000000001'),
    'Black / XL', 'TEE-BLK-XL', 999, 600, true, array['480000000102'],
    'variant-create-001', 'variant-create-hash', 'variant-retry-request'
  )$$,
  'identical variant retry succeeds'
);
select is((select count(*)::integer from app.product_variants where tenant_id = '24000000-0000-4000-8000-000000000001'), 2, 'idempotent variant retry does not duplicate');
select throws_ok(
  $$select app.create_catalog_variant(
    '14000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000002',
    (select id from app.products where tenant_id = '24000000-0000-4000-8000-000000000001'),
    'White / Medium', 'TEE-WHT-M', 999, 600, true, array['480000000103'],
    'variant-cross-tenant', 'variant-cross-hash', 'variant-cross-request'
  )$$,
  'HCS12', 'Product was not found', 'cross-tenant product variant creation is blocked'
);

select * from finish();
rollback;
