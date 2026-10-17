begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

select has_table('app', 'inventory_import_batches', 'inventory import batch staging table exists');
select has_table('app', 'inventory_import_rows', 'inventory import row staging table exists');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'app.inventory_import_batches'::regclass), 'batch staging has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'app.inventory_import_rows'::regclass), 'row staging has RLS');
select ok(not has_table_privilege('authenticated', 'app.inventory_import_batches', 'SELECT'), 'browser cannot read batches directly');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.inventory_import_rows', 'SELECT'), 'API login cannot read rows directly');
select has_function(
  'app', 'preview_inventory_import',
  array['uuid','uuid','text','timestamp with time zone','jsonb','text','text','text'],
  'inventory import preview command exists'
);
select ok(
  has_function_privilege('hcs_hyperdrive', 'app.preview_inventory_import(uuid,uuid,text,timestamptz,jsonb,text,text,text)', 'EXECUTE'),
  'API login can execute inventory preview'
);
select ok(
  not has_function_privilege('authenticated', 'app.preview_inventory_import(uuid,uuid,text,timestamptz,jsonb,text,text,text)', 'EXECUTE'),
  'browser cannot execute inventory preview directly'
);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('8b000000-0000-4000-8000-000000000001', 'import-owner@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('8c000000-0000-4000-8000-000000000001', 'import-one', 'Import One'),
  ('8c000000-0000-4000-8000-000000000002', 'import-two', 'Import Two');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('8c000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('8c000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000001', 'active', true, now());
insert into app.locations (id, tenant_id, code, name) values
  ('8d000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000001', 'MAIN', 'Main Store'),
  ('8d000000-0000-4000-8000-000000000002', '8c000000-0000-4000-8000-000000000002', 'OTHER', 'Other Store');
update app.tenant_entitlements set enabled = true
where tenant_id in ('8c000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000002')
  and feature_code = 'inventory';

insert into app.products (id, tenant_id, name, created_by) values
  ('8e000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000001', 'Import Shirt', '8b000000-0000-4000-8000-000000000001'),
  ('8e000000-0000-4000-8000-000000000002', '8c000000-0000-4000-8000-000000000002', 'Other Shirt', '8b000000-0000-4000-8000-000000000001');
insert into app.product_variants (id, tenant_id, product_id, name, sku, retail_price, unit_cost, created_by) values
  ('8f000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000001', '8e000000-0000-4000-8000-000000000001', 'Small', 'IMPORT-S', 899, 450, '8b000000-0000-4000-8000-000000000001'),
  ('8f000000-0000-4000-8000-000000000002', '8c000000-0000-4000-8000-000000000001', '8e000000-0000-4000-8000-000000000001', 'Large', 'IMPORT-L', 999, null, '8b000000-0000-4000-8000-000000000001'),
  ('8f000000-0000-4000-8000-000000000003', '8c000000-0000-4000-8000-000000000002', '8e000000-0000-4000-8000-000000000002', 'Other', 'OTHER-SKU', 500, 200, '8b000000-0000-4000-8000-000000000001');
insert into app.product_barcodes (tenant_id, variant_id, barcode, is_primary) values
  ('8c000000-0000-4000-8000-000000000001', '8f000000-0000-4000-8000-000000000002', '480000000001', true);

select lives_ok(
  $$select app.preview_inventory_import(
    '8b000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000001',
    'opening.csv', '2026-09-27T09:00:00Z',
    jsonb_build_array(
      jsonb_build_object('rowNumber',2,'branchCode','MAIN','sku','IMPORT-S','barcode','','quantityOnHand','10','unitCost','','reorderLevel','5','reservedQuantity','0','damagedQuantity','0','inTransitQuantity','0','sourceReference','SRC-1'),
      jsonb_build_object('rowNumber',3,'branchCode','MISSING','sku','IMPORT-L','barcode','','quantityOnHand','4','unitCost','500','reorderLevel','','reservedQuantity','','damagedQuantity','','inTransitQuantity','','sourceReference','SRC-2'),
      jsonb_build_object('rowNumber',4,'branchCode','MAIN','sku','','barcode','480000000001','quantityOnHand','4','unitCost','500','reorderLevel','','reservedQuantity','','damagedQuantity','','inTransitQuantity','','sourceReference','SRC-3'),
      jsonb_build_object('rowNumber',5,'branchCode','MAIN','sku','OTHER-SKU','barcode','','quantityOnHand','2','unitCost','200','reorderLevel','','reservedQuantity','','damagedQuantity','','inTransitQuantity','','sourceReference','SRC-4')
    ), 'inventory-preview-001', 'inventory-preview-hash-001', 'inventory-preview-request-001'
  )$$,
  'owner previews an inventory file'
);
select is((select row_count from app.inventory_import_batches where tenant_id = '8c000000-0000-4000-8000-000000000001'), 4, 'all input rows are staged');
select is((select accepted_count from app.inventory_import_batches where tenant_id = '8c000000-0000-4000-8000-000000000001'), 2, 'valid SKU and barcode rows are accepted');
select is((select rejected_count from app.inventory_import_batches where tenant_id = '8c000000-0000-4000-8000-000000000001'), 2, 'invalid branch and cross-tenant SKU rows are rejected');
select is((select warning_count from app.inventory_import_batches where tenant_id = '8c000000-0000-4000-8000-000000000001'), 1, 'saved variant cost produces one warning');
select is((select total_quantity from app.inventory_import_batches where tenant_id = '8c000000-0000-4000-8000-000000000001'), 14.000::numeric, 'accepted quantity total is reconciled');
select is((select total_valuation from app.inventory_import_batches where tenant_id = '8c000000-0000-4000-8000-000000000001'), 6500.00::numeric, 'accepted valuation total is reconciled');
select is((select count(*)::integer from app.inventory_movements where tenant_id = '8c000000-0000-4000-8000-000000000001'), 0, 'preview creates no inventory movements');
select is((select count(*)::integer from app.inventory_balances where tenant_id = '8c000000-0000-4000-8000-000000000001'), 0, 'preview creates no inventory balances');
select lives_ok(
  $$select app.preview_inventory_import(
    '8b000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000001',
    'opening.csv', '2026-09-27T09:00:00Z',
    jsonb_build_array(
      jsonb_build_object('rowNumber',2,'branchCode','MAIN','sku','IMPORT-S','barcode','','quantityOnHand','10','unitCost','','reorderLevel','5','reservedQuantity','0','damagedQuantity','0','inTransitQuantity','0','sourceReference','SRC-1'),
      jsonb_build_object('rowNumber',3,'branchCode','MISSING','sku','IMPORT-L','barcode','','quantityOnHand','4','unitCost','500','reorderLevel','','reservedQuantity','','damagedQuantity','','inTransitQuantity','','sourceReference','SRC-2'),
      jsonb_build_object('rowNumber',4,'branchCode','MAIN','sku','','barcode','480000000001','quantityOnHand','4','unitCost','500','reorderLevel','','reservedQuantity','','damagedQuantity','','inTransitQuantity','','sourceReference','SRC-3'),
      jsonb_build_object('rowNumber',5,'branchCode','MAIN','sku','OTHER-SKU','barcode','','quantityOnHand','2','unitCost','200','reorderLevel','','reservedQuantity','','damagedQuantity','','inTransitQuantity','','sourceReference','SRC-4')
    ), 'inventory-preview-001', 'inventory-preview-hash-001', 'inventory-preview-retry'
  )$$,
  'identical preview retry succeeds'
);
select is((select count(*)::integer from app.inventory_import_batches where tenant_id = '8c000000-0000-4000-8000-000000000001'), 1, 'idempotent retry does not duplicate the batch');
select lives_ok(
  $$select app.preview_inventory_import(
    '8b000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000001',
    'duplicates.csv', '2026-09-27T09:00:00Z',
    jsonb_build_array(
      jsonb_build_object('rowNumber',2,'branchCode','MAIN','sku','IMPORT-S','barcode','','quantityOnHand','1','unitCost','450','reorderLevel','','reservedQuantity','','damagedQuantity','','inTransitQuantity','','sourceReference','DUP-1'),
      jsonb_build_object('rowNumber',3,'branchCode','MAIN','sku','IMPORT-S','barcode','','quantityOnHand','2','unitCost','450','reorderLevel','','reservedQuantity','','damagedQuantity','','inTransitQuantity','','sourceReference','DUP-2')
    ), 'inventory-preview-002', 'inventory-preview-hash-002', 'inventory-preview-request-002'
  )$$,
  'duplicate branch-variant rows are staged for correction'
);
select is(
  (select rejected_count from app.inventory_import_batches where tenant_id = '8c000000-0000-4000-8000-000000000001' and filename = 'duplicates.csv'),
  2,
  'every duplicate branch-variant row is rejected'
);
select throws_ok(
  $$select app.preview_inventory_import(
    '8b000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000001',
    'changed.csv', '2026-09-27T09:00:00Z', jsonb_build_array(jsonb_build_object('rowNumber',2)),
    'inventory-preview-001', 'changed-hash', 'inventory-preview-conflict'
  )$$,
  'HCS08', 'Idempotency key conflict', 'changed preview retry is rejected'
);
select is((select count(*)::integer from audit.audit_events where tenant_id = '8c000000-0000-4000-8000-000000000001' and action = 'inventory.import.previewed'), 2, 'each unique preview is audited exactly once');
select is((select count(*)::integer from integration.event_outbox where tenant_id = '8c000000-0000-4000-8000-000000000001' and topic = 'inventory.import.previewed'), 2, 'each unique preview emits one outbox event');

select * from finish();
rollback;
