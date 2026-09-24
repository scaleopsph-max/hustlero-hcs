begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select has_table('app', 'inventory_movements', 'inventory movement ledger exists');
select has_table('app', 'inventory_balances', 'inventory balance projection exists');
select ok((select relrowsecurity from pg_class where oid = 'app.inventory_movements'::regclass), 'movement ledger has RLS');
select ok((select relrowsecurity from pg_class where oid = 'app.inventory_balances'::regclass), 'balance projection has RLS');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.inventory_movements', 'SELECT'), 'API login cannot read ledger directly');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.inventory_balances', 'UPDATE'), 'API login cannot edit balances directly');
select ok(not has_function_privilege('anon', 'app.list_opening_inventory(uuid,uuid,uuid)', 'EXECUTE'), 'anon cannot list opening inventory');
select ok(not has_function_privilege(
  'authenticated', 'app.record_opening_inventory(uuid,uuid,uuid,jsonb,text,text,text)', 'EXECUTE'
), 'authenticated cannot record opening inventory directly');
select ok(has_function_privilege('hcs_hyperdrive', 'app.list_opening_inventory(uuid,uuid,uuid)', 'EXECUTE'), 'API login can list opening inventory');
select ok(has_function_privilege(
  'hcs_hyperdrive', 'app.record_opening_inventory(uuid,uuid,uuid,jsonb,text,text,text)', 'EXECUTE'
), 'API login can record opening inventory');

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('16000000-0000-4000-8000-000000000001', 'inventory-owner@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('26000000-0000-4000-8000-000000000001', 'inventory-one', 'Inventory One'),
  ('26000000-0000-4000-8000-000000000002', 'inventory-two', 'Inventory Two');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('26000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('26000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000001', 'active', true, now());
insert into app.locations (id, tenant_id, code, name) values
  ('36000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001', 'MAIN', 'Main Store'),
  ('36000000-0000-4000-8000-000000000002', '26000000-0000-4000-8000-000000000002', 'MAIN', 'Other Store');
update app.tenant_entitlements set enabled = true
where tenant_id in ('26000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000002')
  and feature_code = 'inventory';

select lives_ok(
  $$select app.create_catalog_product(
    '16000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001',
    'Opening Tee', null, 'Shirts', 'Small', 'OPEN-S', 899, 450, true,
    array['480000000301'], 'opening-product-001', 'opening-product-hash', 'opening-product-request'
  )$$,
  'owner creates an inventory-tracked product'
);
select is(
  app.list_opening_inventory(
    '16000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001', null
  )->>'selectedLocationId',
  '36000000-0000-4000-8000-000000000001',
  'opening inventory selects an accessible active location'
);
select lives_ok(
  $$select app.record_opening_inventory(
    '16000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'variantId', (select id from app.product_variants where tenant_id = '26000000-0000-4000-8000-000000000001'),
      'quantity', '12.500', 'unitCost', '450.25'
    )),
    'opening-record-001', 'opening-record-hash', 'opening-record-request'
  )$$,
  'opening inventory is recorded atomically'
);
select is((select count(*)::integer from app.inventory_movements where tenant_id = '26000000-0000-4000-8000-000000000001'), 1, 'one immutable movement is created');
select is((select on_hand from app.inventory_balances where tenant_id = '26000000-0000-4000-8000-000000000001'), 12.500::numeric, 'balance projection stores exact quantity');
select is((select average_unit_cost from app.inventory_balances where tenant_id = '26000000-0000-4000-8000-000000000001'), 450.25::numeric, 'balance projection stores exact cost');
select is((select count(*)::integer from audit.audit_events where tenant_id = '26000000-0000-4000-8000-000000000001' and action = 'inventory.opening.recorded'), 1, 'opening inventory is audited');
select is((select count(*)::integer from integration.event_outbox where tenant_id = '26000000-0000-4000-8000-000000000001' and topic = 'inventory.opening.recorded'), 1, 'opening inventory emits one outbox event');
select ok(app.tenant_has_opening_inventory('26000000-0000-4000-8000-000000000001'), 'onboarding completion detects opening inventory');
select lives_ok(
  $$select app.record_opening_inventory(
    '16000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'variantId', (select id from app.product_variants where tenant_id = '26000000-0000-4000-8000-000000000001'),
      'quantity', '12.500', 'unitCost', '450.25'
    )),
    'opening-record-001', 'opening-record-hash', 'opening-record-retry'
  )$$,
  'identical opening inventory retry succeeds'
);
select is((select count(*)::integer from app.inventory_movements where tenant_id = '26000000-0000-4000-8000-000000000001'), 1, 'idempotent retry creates no duplicate movement');
select throws_ok(
  $$select app.record_opening_inventory(
    '16000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'variantId', (select id from app.product_variants where tenant_id = '26000000-0000-4000-8000-000000000001'),
      'quantity', '13.000', 'unitCost', '450.25'
    )),
    'opening-record-001', 'different-hash', 'opening-conflict-request'
  )$$,
  'HCS08', 'Idempotency key was reused with different opening inventory', 'changed idempotent retry is rejected'
);
select throws_ok(
  $$select app.record_opening_inventory(
    '16000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'variantId', (select id from app.product_variants where tenant_id = '26000000-0000-4000-8000-000000000001'),
      'quantity', '1.000', 'unitCost', '450.25'
    )),
    'opening-record-002', 'opening-record-hash-002', 'opening-duplicate-request'
  )$$,
  'HCS16', 'Opening inventory already exists or stock has moved', 'opening inventory cannot overwrite movement history'
);
select throws_ok(
  $$update app.inventory_movements set quantity = 99
    where tenant_id = '26000000-0000-4000-8000-000000000001'$$,
  'P0001', 'inventory movements are append-only', 'movement rows cannot be edited'
);
select throws_ok(
  $$select app.record_opening_inventory(
    '16000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000002',
    jsonb_build_array(jsonb_build_object(
      'variantId', (select id from app.product_variants where tenant_id = '26000000-0000-4000-8000-000000000001'),
      'quantity', '1.000', 'unitCost', '450.25'
    )),
    'opening-cross-tenant', 'opening-cross-hash', 'opening-cross-request'
  )$$,
  'HCS19', 'Inventory location was not found', 'cross-tenant location is blocked'
);
select is((select on_hand from app.inventory_balances where tenant_id = '26000000-0000-4000-8000-000000000001'), 12.500::numeric, 'failed commands do not change the balance');

select * from finish();
rollback;
