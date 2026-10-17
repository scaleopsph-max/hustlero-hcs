begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

select has_table('app', 'product_categories', 'product categories table exists');
select has_table('app', 'products', 'products table exists');
select has_table('app', 'product_variants', 'product variants table exists');
select has_table('app', 'product_barcodes', 'product barcodes table exists');
select ok((select relrowsecurity from pg_class where oid = 'app.products'::regclass), 'products have RLS enabled');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.products', 'SELECT'), 'API login cannot select products directly');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.products', 'INSERT'), 'API login cannot insert products directly');
select ok(not has_function_privilege('anon', 'app.list_catalog_products(uuid,uuid)', 'EXECUTE'), 'anon cannot list catalog');
select ok(not has_function_privilege(
  'authenticated',
  'app.create_catalog_product(uuid,uuid,text,text,text,text,text,numeric,numeric,boolean,text[],text,text,text)',
  'EXECUTE'
), 'authenticated cannot call catalog command directly');
select ok(has_function_privilege('hcs_hyperdrive', 'app.list_catalog_products(uuid,uuid)', 'EXECUTE'), 'API login can list catalog');
select ok(has_function_privilege(
  'hcs_hyperdrive',
  'app.create_catalog_product(uuid,uuid,text,text,text,text,text,numeric,numeric,boolean,text[],text,text,text)',
  'EXECUTE'
), 'API login can create catalog product');

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('13000000-0000-4000-8000-000000000001', 'catalog-owner@example.invalid', 'authenticated', 'authenticated', now()),
  ('13000000-0000-4000-8000-000000000002', 'catalog-employee@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('23000000-0000-4000-8000-000000000001', 'catalog-one', 'Catalog One'),
  ('23000000-0000-4000-8000-000000000002', 'catalog-two', 'Catalog Two');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('23000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('23000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002', 'active', false, now()),
  ('23000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001', 'active', true, now());

select throws_ok(
  $$select app.list_catalog_products('13000000-0000-4000-8000-000000000002', '23000000-0000-4000-8000-000000000001')$$,
  'HCS09', 'Catalog access is not allowed', 'member without catalog permission cannot list'
);
select throws_ok(
  $$select app.create_catalog_product(
    '13000000-0000-4000-8000-000000000002', '23000000-0000-4000-8000-000000000001',
    'Coffee', null, 'Drinks', 'Default', 'COF-001', 120, 60, true, array['480000000001'],
    'catalog-denied-001', 'hash-denied', 'request-denied'
  )$$,
  'HCS09', 'Catalog management is not allowed', 'member without catalog permission cannot create'
);
select lives_ok(
  $$select app.create_catalog_product(
    '13000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001',
    'Iced Coffee', 'House blend', 'Drinks', 'Regular', ' cof-001 ', 120.50, 55.25, true,
    array[' 480000000001 ', '480000000001', '480000000002'],
    'catalog-create-001', 'hash-create-001', 'request-create-001'
  )$$,
  'owner can create a product atomically'
);
select is((select count(*)::integer from app.products where tenant_id = '23000000-0000-4000-8000-000000000001'), 1, 'one product is created');
select is((select sku::text from app.product_variants where tenant_id = '23000000-0000-4000-8000-000000000001'), 'COF-001', 'SKU is normalized');
select is((select retail_price from app.product_variants where tenant_id = '23000000-0000-4000-8000-000000000001'), 120.50::numeric, 'retail price remains exact numeric');
select is((select count(*)::integer from app.product_barcodes where tenant_id = '23000000-0000-4000-8000-000000000001'), 2, 'barcodes are normalized and deduplicated');
select is((select count(*)::integer from app.product_barcodes where tenant_id = '23000000-0000-4000-8000-000000000001' and is_primary), 1, 'one barcode is primary');
select ok(app.tenant_has_products('23000000-0000-4000-8000-000000000001'), 'tenant product completion is detected');
select is((select count(*)::integer from audit.audit_events where tenant_id = '23000000-0000-4000-8000-000000000001' and action = 'catalog.product.created'), 1, 'product creation is audited');
select is((select count(*)::integer from integration.event_outbox where tenant_id = '23000000-0000-4000-8000-000000000001' and topic = 'catalog.product.created'), 1, 'product creation emits one outbox event');
select lives_ok(
  $$select app.create_catalog_product(
    '13000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001',
    'Iced Coffee', 'House blend', 'Drinks', 'Regular', 'COF-001', 120.50, 55.25, true,
    array['480000000001', '480000000002'], 'catalog-create-001', 'hash-create-001', 'request-retry'
  )$$,
  'identical idempotent retry succeeds'
);
select is((select count(*)::integer from app.products where tenant_id = '23000000-0000-4000-8000-000000000001'), 1, 'idempotent retry does not duplicate product');
select throws_ok(
  $$select app.create_catalog_product(
    '13000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001',
    'Different', null, null, 'Default', 'NEW-001', 10, null, false, '{}',
    'catalog-create-001', 'different-hash', 'request-conflict'
  )$$,
  'HCS08', 'Idempotency key was reused with different product details', 'idempotency key conflict is rejected'
);
select lives_ok(
  $$select app.create_catalog_product(
    '13000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002',
    'Other Tenant Item', null, 'Drinks', 'Default', 'COF-001', 99, null, false,
    array['480000000001'], 'catalog-create-002', 'hash-create-002', 'request-create-002'
  )$$,
  'same SKU and barcode can exist in a different tenant'
);
select is((app.list_catalog_products('13000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001')->'products'->0->>'name'), 'Iced Coffee', 'catalog list returns only requested tenant product');

select * from finish();
rollback;
