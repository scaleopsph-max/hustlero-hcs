begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

select has_table('app', 'inventory_reorder_policies', 'branch-variant reorder policy table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'app.inventory_reorder_policies'::regclass),
  'reorder policies have RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'app.inventory_reorder_policies', 'SELECT'),
  'authenticated cannot read reorder policies directly'
);
select has_function(
  'app', 'set_inventory_reorder_level',
  array['uuid','uuid','uuid','uuid','numeric','text','text','text'],
  'reorder-level command exists'
);
select ok(
  has_function_privilege(
    'hcs_hyperdrive',
    'app.set_inventory_reorder_level(uuid,uuid,uuid,uuid,numeric,text,text,text)',
    'EXECUTE'
  ),
  'API login can execute the reorder command'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'app.set_inventory_reorder_level(uuid,uuid,uuid,uuid,numeric,text,text,text)',
    'EXECUTE'
  ),
  'browser users cannot execute the reorder command directly'
);
select has_index(
  'app', 'inventory_reorder_policies', 'inventory_reorder_policies_variant_idx',
  'reorder policy variant foreign key has a covering index'
);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('1a000000-0000-4000-8000-000000000001', 'reorder-owner@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('2a000000-0000-4000-8000-000000000001', 'reorder-one', 'Reorder One'),
  ('2a000000-0000-4000-8000-000000000002', 'reorder-two', 'Reorder Two');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('2a000000-0000-4000-8000-000000000002', '1a000000-0000-4000-8000-000000000001', 'active', true, now());
insert into app.locations (id, tenant_id, code, name) values
  ('3a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001', 'MAIN', 'Main Store'),
  ('3a000000-0000-4000-8000-000000000002', '2a000000-0000-4000-8000-000000000002', 'MAIN', 'Other Store');
update app.tenant_entitlements set enabled = true
where tenant_id in ('2a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000002')
  and feature_code = 'inventory';

select lives_ok(
  $$select app.create_catalog_product(
    '1a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
    'Reorder Tee', null, 'Shirts', 'Small', 'REORDER-S', 899, 450, true,
    array['490000000901'], 'reorder-product-001', 'reorder-product-hash', 'reorder-product-request'
  )$$,
  'owner creates an inventory-tracked product'
);
select lives_ok(
  $$select app.record_opening_inventory(
    '1a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'variantId', (select id from app.product_variants where tenant_id = '2a000000-0000-4000-8000-000000000001'),
      'quantity', '7.000', 'unitCost', '450.00'
    )),
    'reorder-opening-001', 'reorder-opening-hash', 'reorder-opening-request'
  )$$,
  'opening stock exists before low-stock monitoring'
);
select lives_ok(
  $$select app.set_inventory_reorder_level(
    '1a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000001',
    (select id from app.product_variants where tenant_id = '2a000000-0000-4000-8000-000000000001'),
    10.000, 'reorder-level-001', 'reorder-level-hash', 'reorder-level-request'
  )$$,
  'owner sets a branch-variant reorder level'
);
select is(
  (select reorder_level from app.inventory_reorder_policies where tenant_id = '2a000000-0000-4000-8000-000000000001'),
  10.000::numeric,
  'policy stores the exact three-decimal threshold'
);
select is(
  (select app.list_inventory_stock_with_reorder(
    '1a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000001'
  ) #>> '{items,0,stockStatus}'),
  'low_stock',
  'stock projection classifies stock at or below the threshold'
);
select is(
  (select count(*)::integer from app.risk_alerts
    where tenant_id = '2a000000-0000-4000-8000-000000000001'
      and dedup_key like 'inventory.low_stock:%' and status = 'open'),
  1,
  'setting a breached threshold opens one deduplicated alert'
);
select is(
  (select app.load_reporting_with_inventory_policy(
    '1a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
    current_date, current_date, null, 'all'
  ) #>> '{inventory,lowStockCount}')::integer,
  1,
  'reporting includes the low-stock count'
);
select lives_ok(
  $$select app.set_inventory_reorder_level(
    '1a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000001',
    (select id from app.product_variants where tenant_id = '2a000000-0000-4000-8000-000000000001'),
    10.000, 'reorder-level-001', 'reorder-level-hash', 'reorder-level-retry'
  )$$,
  'identical command retry succeeds'
);
select is(
  (select count(*)::integer from audit.audit_events
    where tenant_id = '2a000000-0000-4000-8000-000000000001'
      and action = 'inventory.reorder_level.updated'),
  1,
  'idempotent retry does not duplicate the audit event'
);
select is(
  (select count(*)::integer from integration.event_outbox
    where tenant_id = '2a000000-0000-4000-8000-000000000001'
      and topic = 'inventory.reorder_level.updated'),
  1,
  'idempotent retry does not duplicate the outbox event'
);
select throws_ok(
  $$select app.set_inventory_reorder_level(
    '1a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000001',
    (select id from app.product_variants where tenant_id = '2a000000-0000-4000-8000-000000000001'),
    5.000, 'reorder-level-001', 'different-reorder-hash', 'reorder-level-conflict'
  )$$,
  'HCS08', 'Idempotency key conflict', 'changed retry is rejected'
);
select throws_ok(
  $$select app.set_inventory_reorder_level(
    '1a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000002',
    (select id from app.product_variants where tenant_id = '2a000000-0000-4000-8000-000000000001'),
    5.000, 'reorder-cross-tenant', 'reorder-cross-hash', 'reorder-cross-request'
  )$$,
  'HCS19', 'Inventory location was not found', 'cross-tenant location is rejected'
);
select lives_ok(
  $$select app.set_inventory_reorder_level(
    '1a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000001',
    (select id from app.product_variants where tenant_id = '2a000000-0000-4000-8000-000000000001'),
    5.000, 'reorder-level-002', 'reorder-level-hash-002', 'reorder-level-request-002'
  )$$,
  'owner lowers the reorder threshold'
);
select is(
  (select status from app.risk_alerts
    where tenant_id = '2a000000-0000-4000-8000-000000000001'
      and dedup_key like 'inventory.low_stock:%'),
  'resolved',
  'low-stock alert resolves when available stock clears the threshold'
);
select lives_ok(
  $$select app.set_inventory_reorder_level(
    '1a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000001',
    (select id from app.product_variants where tenant_id = '2a000000-0000-4000-8000-000000000001'),
    null, 'reorder-level-003', 'reorder-level-hash-003', 'reorder-level-request-003'
  )$$,
  'blank threshold disables monitoring without deleting history'
);
select ok(
  not (select is_active from app.inventory_reorder_policies
    where tenant_id = '2a000000-0000-4000-8000-000000000001'),
  'disabled policy remains as inactive configuration history'
);

select * from finish();
rollback;
