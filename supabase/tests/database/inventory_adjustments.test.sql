begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select has_function(
  'app', 'record_inventory_adjustment',
  array['uuid', 'uuid', 'uuid', 'uuid', 'numeric', 'numeric', 'text', 'text', 'text', 'text'],
  'inventory adjustment command exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'app.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,numeric,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated cannot adjust inventory directly'
);
select ok(
  has_function_privilege(
    'hcs_hyperdrive',
    'app.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,numeric,text,text,text,text)',
    'EXECUTE'
  ),
  'API login can adjust inventory'
);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('18000000-0000-4000-8000-000000000001', 'adjustment-owner@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('28000000-0000-4000-8000-000000000001', 'adjustment-one', 'Adjustment One'),
  ('28000000-0000-4000-8000-000000000002', 'adjustment-two', 'Adjustment Two');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('28000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000001', 'active', true, now());
insert into app.locations (id, tenant_id, code, name) values
  ('38000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', 'MAIN', 'Main Store'),
  ('38000000-0000-4000-8000-000000000002', '28000000-0000-4000-8000-000000000002', 'MAIN', 'Other Store');
update app.tenant_entitlements set enabled = true
where tenant_id in ('28000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000002')
  and feature_code = 'inventory';

select lives_ok(
  $$select app.create_catalog_product(
    '18000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001',
    'Adjustable Tee', null, 'Shirts', 'Small', 'ADJ-S', 899, 450, true,
    array['490000000401'], 'adjustment-product-001', 'adjustment-product-hash', 'adjustment-product-request'
  )$$,
  'owner creates an inventory-tracked product'
);
select lives_ok(
  $$select app.record_opening_inventory(
    '18000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'variantId', (select id from app.product_variants where tenant_id = '28000000-0000-4000-8000-000000000001'),
      'quantity', '7.250', 'unitCost', '450.25'
    )),
    'adjustment-opening-001', 'adjustment-opening-hash', 'adjustment-opening-request'
  )$$,
  'opening balance exists before adjustment'
);
select lives_ok(
  $$select app.record_inventory_adjustment(
    '18000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    (select id from app.product_variants where tenant_id = '28000000-0000-4000-8000-000000000001'),
    -2.000, null, 'Damaged during receiving',
    'adjustment-record-001', 'adjustment-record-hash', 'adjustment-record-request'
  )$$,
  'adjustment records a negative correction'
);
select is((select count(*)::integer from app.inventory_movements where tenant_id = '28000000-0000-4000-8000-000000000001'), 2, 'adjustment appends one movement');
select is((select on_hand from app.inventory_balances where tenant_id = '28000000-0000-4000-8000-000000000001'), 5.250::numeric, 'adjustment updates on hand atomically');
select is((select reason from audit.audit_events where tenant_id = '28000000-0000-4000-8000-000000000001' and action = 'inventory.adjustment.recorded'), 'Damaged during receiving', 'adjustment reason is audited');
select is((select count(*)::integer from integration.event_outbox where tenant_id = '28000000-0000-4000-8000-000000000001' and topic = 'inventory.adjustment.recorded'), 1, 'adjustment emits one outbox event');
select lives_ok(
  $$select app.record_inventory_adjustment(
    '18000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    (select id from app.product_variants where tenant_id = '28000000-0000-4000-8000-000000000001'),
    -2.000, null, 'Damaged during receiving',
    'adjustment-record-001', 'adjustment-record-hash', 'adjustment-retry-request'
  )$$,
  'identical adjustment retry succeeds'
);
select is((select count(*)::integer from app.inventory_movements where tenant_id = '28000000-0000-4000-8000-000000000001'), 2, 'idempotent retry creates no movement');
select throws_ok(
  $$select app.record_inventory_adjustment(
    '18000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    (select id from app.product_variants where tenant_id = '28000000-0000-4000-8000-000000000001'),
    1.000, null, 'Changed request',
    'adjustment-record-001', 'different-adjustment-hash', 'adjustment-conflict-request'
  )$$,
  'HCS08', 'Idempotency key was reused with different adjustment', 'changed adjustment retry is rejected'
);
select throws_ok(
  $$select app.record_inventory_adjustment(
    '18000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    (select id from app.product_variants where tenant_id = '28000000-0000-4000-8000-000000000001'),
    -6.000, null, 'Too much stock correction',
    'adjustment-record-002', 'adjustment-record-hash-002', 'adjustment-negative-request'
  )$$,
  'HCS22', 'Adjustment would make available stock negative', 'negative available stock is blocked'
);
select throws_ok(
  $$select app.record_inventory_adjustment(
    '18000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000002',
    (select id from app.product_variants where tenant_id = '28000000-0000-4000-8000-000000000001'),
    1.000, null, 'Cross tenant attempt',
    'adjustment-cross-tenant', 'adjustment-cross-hash', 'adjustment-cross-request'
  )$$,
  'HCS19', 'Inventory location was not found', 'cross-tenant adjustment is blocked'
);
select throws_ok(
  $$select app.record_inventory_adjustment(
    '18000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001', gen_random_uuid(),
    1.000, null, 'Unknown variant',
    'adjustment-unknown-variant', 'adjustment-unknown-hash', 'adjustment-unknown-request'
  )$$,
  'HCS21', 'Inventory variant was not found', 'unknown variant is blocked'
);

select * from finish();
rollback;
