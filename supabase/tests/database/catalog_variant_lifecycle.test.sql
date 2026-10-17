begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select ok(not has_function_privilege(
  'anon',
  'app.update_catalog_variant(uuid,uuid,uuid,uuid,text,text,numeric,numeric,boolean,text[],text,text,text)',
  'EXECUTE'
), 'anon cannot update variants directly');
select ok(has_function_privilege(
  'hcs_hyperdrive',
  'app.update_catalog_variant(uuid,uuid,uuid,uuid,text,text,numeric,numeric,boolean,text[],text,text,text)',
  'EXECUTE'
), 'API login can update variants');
select ok(not has_function_privilege(
  'authenticated',
  'app.deactivate_catalog_variant(uuid,uuid,uuid,uuid,text,text,text)',
  'EXECUTE'
), 'authenticated clients cannot deactivate variants directly');
select ok(has_function_privilege(
  'hcs_hyperdrive',
  'app.deactivate_catalog_variant(uuid,uuid,uuid,uuid,text,text,text)',
  'EXECUTE'
), 'API login can deactivate variants');

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('15000000-0000-4000-8000-000000000001', 'variant-life@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('25000000-0000-4000-8000-000000000001', 'variant-life-one', 'Variant Life One'),
  ('25000000-0000-4000-8000-000000000002', 'variant-life-two', 'Variant Life Two');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('25000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('25000000-0000-4000-8000-000000000002', '15000000-0000-4000-8000-000000000001', 'active', true, now());

select lives_ok(
  $$select app.create_catalog_product(
    '15000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001',
    'Lifecycle Tee', null, 'Shirts', 'Small', 'LIFE-S', 899, 500, true,
    array['480000000201'], 'life-base-001', 'life-base-hash', 'life-base-request'
  )$$,
  'base product is created'
);
select lives_ok(
  $$select app.create_catalog_variant(
    '15000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001',
    (select id from app.products where tenant_id = '25000000-0000-4000-8000-000000000001'),
    'Large', 'LIFE-L', 999, 550, true, array['480000000202'],
    'life-add-001', 'life-add-hash', 'life-add-request'
  )$$,
  'second variant is created'
);
select lives_ok(
  $$select app.update_catalog_variant(
    '15000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001',
    (select id from app.products where tenant_id = '25000000-0000-4000-8000-000000000001'),
    (select id from app.product_variants where tenant_id = '25000000-0000-4000-8000-000000000001' and sku = 'LIFE-L'),
    'Black / Large', 'LIFE-BLK-L', 1099, 600, false, array['480000000203'],
    'life-update-001', 'life-update-hash', 'life-update-request'
  )$$,
  'variant can be updated'
);
select is(
  (select name::text from app.product_variants where tenant_id = '25000000-0000-4000-8000-000000000001' and sku = 'LIFE-BLK-L'),
  'Black / Large', 'updated variant name and SKU are stored'
);
select is(
  (select barcode::text from app.product_barcodes where tenant_id = '25000000-0000-4000-8000-000000000001' and barcode = '480000000203'),
  '480000000203', 'barcode replacement is stored'
);
select is(
  (select count(*)::integer from audit.audit_events where tenant_id = '25000000-0000-4000-8000-000000000001' and action = 'catalog.variant.updated'),
  1, 'variant update is audited once'
);
select is(
  (select count(*)::integer from integration.event_outbox where tenant_id = '25000000-0000-4000-8000-000000000001' and topic = 'catalog.variant.updated'),
  1, 'variant update emits one outbox event'
);
select throws_ok(
  $$select app.update_catalog_variant(
    '15000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000002',
    (select id from app.products where tenant_id = '25000000-0000-4000-8000-000000000001'),
    (select id from app.product_variants where tenant_id = '25000000-0000-4000-8000-000000000001' and sku = 'LIFE-BLK-L'),
    'Cross Tenant', 'CROSS-L', 1099, 600, true, array[]::text[],
    'life-cross-001', 'life-cross-hash', 'life-cross-request'
  )$$,
  'HCS12', 'Variant was not found', 'cross-tenant variant update is blocked'
);
select lives_ok(
  $$select app.deactivate_catalog_variant(
    '15000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001',
    (select id from app.products where tenant_id = '25000000-0000-4000-8000-000000000001'),
    (select id from app.product_variants where tenant_id = '25000000-0000-4000-8000-000000000001' and sku = 'LIFE-BLK-L'),
    'life-delete-001', 'life-delete-hash', 'life-delete-request'
  )$$,
  'variant can be deactivated'
);
select is(
  (select is_active from app.product_variants where tenant_id = '25000000-0000-4000-8000-000000000001' and sku = 'LIFE-BLK-L'),
  false, 'deactivation preserves the variant row'
);
select lives_ok(
  $$select app.deactivate_catalog_variant(
    '15000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001',
    (select id from app.products where tenant_id = '25000000-0000-4000-8000-000000000001'),
    (select id from app.product_variants where tenant_id = '25000000-0000-4000-8000-000000000001' and sku = 'LIFE-BLK-L'),
    'life-delete-001', 'life-delete-hash', 'life-delete-retry'
  )$$,
  'identical deactivation retry succeeds'
);
select is(
  (select count(*)::integer from audit.audit_events where tenant_id = '25000000-0000-4000-8000-000000000001' and action = 'catalog.variant.deactivated'),
  1, 'idempotent deactivation is audited once'
);
select is(
  (select count(*)::integer from integration.event_outbox where tenant_id = '25000000-0000-4000-8000-000000000001' and topic = 'catalog.variant.deactivated'),
  1, 'deactivation emits one outbox event'
);
select throws_ok(
  $$select app.deactivate_catalog_variant(
    '15000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001',
    (select id from app.products where tenant_id = '25000000-0000-4000-8000-000000000001'),
    (select id from app.product_variants where tenant_id = '25000000-0000-4000-8000-000000000001' and sku = 'LIFE-S'),
    'life-delete-last', 'life-delete-last-hash', 'life-delete-last-request'
  )$$,
  'HCS13', 'Product must keep one active variant', 'last active variant cannot be deactivated'
);

select * from finish();
rollback;
