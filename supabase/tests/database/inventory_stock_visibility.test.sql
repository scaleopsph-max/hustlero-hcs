begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select has_function('app', 'list_inventory_stock', array['uuid', 'uuid', 'uuid'], 'stock reader exists');
select has_function(
  'app', 'list_inventory_movements', array['uuid', 'uuid', 'uuid', 'uuid', 'integer'], 'movement reader exists'
);
select ok(
  not has_function_privilege('anon', 'app.list_inventory_stock(uuid,uuid,uuid)', 'EXECUTE'),
  'anon cannot list stock'
);
select ok(
  not has_function_privilege('authenticated', 'app.list_inventory_movements(uuid,uuid,uuid,uuid,integer)', 'EXECUTE'),
  'authenticated cannot list movements directly'
);
select ok(
  has_function_privilege('hcs_hyperdrive', 'app.list_inventory_stock(uuid,uuid,uuid)', 'EXECUTE'),
  'API login can list stock'
);
select ok(
  has_function_privilege('hcs_hyperdrive', 'app.list_inventory_movements(uuid,uuid,uuid,uuid,integer)', 'EXECUTE'),
  'API login can list movements'
);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('17000000-0000-4000-8000-000000000001', 'stock-owner@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('27000000-0000-4000-8000-000000000001', 'stock-one', 'Stock One'),
  ('27000000-0000-4000-8000-000000000002', 'stock-two', 'Stock Two');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('27000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('27000000-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000001', 'active', true, now());
insert into app.locations (id, tenant_id, code, name) values
  ('37000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001', 'MAIN', 'Main Store'),
  ('37000000-0000-4000-8000-000000000002', '27000000-0000-4000-8000-000000000002', 'MAIN', 'Other Store');
update app.tenant_entitlements set enabled = true
where tenant_id in ('27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000002')
  and feature_code = 'inventory';

select lives_ok(
  $$select app.create_catalog_product(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001',
    'Stock Tee', null, 'Shirts', 'Small', 'STOCK-S', 899, 450, true,
    array['490000000301'], 'stock-product-001', 'stock-product-hash', 'stock-product-request'
  )$$,
  'owner creates an inventory-tracked product'
);
select is(
  app.list_inventory_stock(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001', null
  )->>'selectedLocationId',
  '37000000-0000-4000-8000-000000000001',
  'stock reader selects an accessible branch'
);
select is(
  jsonb_array_length(app.list_inventory_stock(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001', null
  )->'items'),
  1,
  'stock reader lists active inventory variants'
);
select is(
  app.list_inventory_stock(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001', null
  )->'items'->0->>'hasBalance',
  'false',
  'variant starts without a balance projection'
);
select lives_ok(
  $$select app.record_opening_inventory(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'variantId', (select id from app.product_variants where tenant_id = '27000000-0000-4000-8000-000000000001'),
      'quantity', '7.250', 'unitCost', '450.25'
    )),
    'stock-opening-001', 'stock-opening-hash', 'stock-opening-request'
  )$$,
  'opening inventory creates the live stock position'
);
select is(
  app.list_inventory_stock(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001', null
  )->'items'->0->>'onHand',
  '7.250',
  'stock reader returns exact on-hand quantity'
);
select is(
  app.list_inventory_stock(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001', null
  )->'items'->0->>'available',
  '7.250',
  'available stock is computed from on hand minus reserved'
);
select is(
  jsonb_array_length(app.list_inventory_movements(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000001', null, 100
  )->'items'),
  1,
  'movement reader returns the branch ledger'
);
select is(
  app.list_inventory_movements(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000001', null, 100
  )->'items'->0->>'movementType',
  'OPENING_BALANCE',
  'movement type is preserved'
);
select is(
  app.list_inventory_movements(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000001', null, 100
  )->'items'->0->>'balanceAfter',
  '7.250',
  'movement history calculates exact balance after'
);
select is(
  app.list_inventory_movements(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000001', null, 100
  )->'items'->0->>'actorLabel',
  'Business owner',
  'movement history resolves the actor label'
);
select throws_ok(
  $$select app.list_inventory_stock(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000002'
  )$$,
  'HCS19', 'Inventory location was not found', 'cross-tenant stock location is blocked'
);
select throws_ok(
  $$select app.list_inventory_movements(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000002', null, 100
  )$$,
  'HCS19', 'Inventory location was not found', 'cross-tenant movement location is blocked'
);
select throws_ok(
  $$select app.list_inventory_movements(
    '17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000001', null, 0
  )$$,
  'HCS20', 'Inventory movement limit is invalid', 'invalid movement limits are rejected'
);

select * from finish();
rollback;
