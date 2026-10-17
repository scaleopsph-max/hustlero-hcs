begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

select has_function('app','post_inventory_import',array['uuid','uuid','uuid','text','text','text'],'atomic inventory import posting command exists');
select has_function('app','reconcile_inventory_import',array['uuid','uuid','uuid','text','text','text'],'inventory reconciliation command exists');
select has_function('app','is_location_inventory_cutover_ready',array['uuid','uuid'],'POS cutover gate exists');
select ok(has_function_privilege('hcs_hyperdrive','app.post_inventory_import(uuid,uuid,uuid,text,text,text)','execute'),'API role can post an import');
select ok(has_function_privilege('hcs_hyperdrive','app.reconcile_inventory_import(uuid,uuid,uuid,text,text,text)','execute'),'API role can reconcile an import');
select ok(not has_function_privilege('authenticated','app.post_inventory_import(uuid,uuid,uuid,text,text,text)','execute'),'browser cannot post an import directly');
select ok(not has_function_privilege('hcs_hyperdrive','app.is_location_inventory_cutover_ready(uuid,uuid)','execute'),'API role cannot bypass the internal POS cutover gate');

insert into auth.users(id,email,aud,role,email_confirmed_at) values
  ('9b000000-0000-4000-8000-000000000001','cutover-owner@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name) values
  ('9c000000-0000-4000-8000-000000000001','cutover-one','Cutover One'),
  ('9c000000-0000-4000-8000-000000000002','cutover-legacy','Cutover Legacy');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
  ('9c000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000001','active',true,now()),
  ('9c000000-0000-4000-8000-000000000002','9b000000-0000-4000-8000-000000000001','active',true,now());
insert into app.locations(id,tenant_id,code,name) values
  ('9d000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001','MAIN','Main Store'),
  ('9d000000-0000-4000-8000-000000000002','9c000000-0000-4000-8000-000000000002','MAIN','Legacy Store');
update app.tenant_entitlements set enabled=true
where tenant_id in('9c000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000002') and feature_code='inventory';
insert into app.products(id,tenant_id,name,created_by) values
  ('9e000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001','Cutover Shirt','9b000000-0000-4000-8000-000000000001'),
  ('9e000000-0000-4000-8000-000000000002','9c000000-0000-4000-8000-000000000002','Legacy Shirt','9b000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values
  ('9f000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000001','Small','CUT-S',899,450,'9b000000-0000-4000-8000-000000000001'),
  ('9f000000-0000-4000-8000-000000000002','9c000000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000001','Large','CUT-L',999,500,'9b000000-0000-4000-8000-000000000001'),
  ('9f000000-0000-4000-8000-000000000003','9c000000-0000-4000-8000-000000000002','9e000000-0000-4000-8000-000000000002','Default','LEGACY-1',500,200,'9b000000-0000-4000-8000-000000000001');

select app.preview_inventory_import(
  '9b000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001',
  'cutover.csv','2026-09-27T09:00:00Z',jsonb_build_array(
    jsonb_build_object('rowNumber',2,'branchCode','MAIN','sku','CUT-S','barcode','','quantityOnHand','10','unitCost','450','reorderLevel','5','reservedQuantity','2','damagedQuantity','1','inTransitQuantity','3','sourceReference','OLD-1'),
    jsonb_build_object('rowNumber',3,'branchCode','MAIN','sku','CUT-L','barcode','','quantityOnHand','0','unitCost','500','reorderLevel','2','reservedQuantity','0','damagedQuantity','0','inTransitQuantity','0','sourceReference','OLD-2')
  ),'cutover-preview-001','cutover-preview-hash-001','cutover-preview-request-001');

select ok(not app.is_location_inventory_cutover_ready('9c000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000001'),'a previewed batch keeps POS locked');
select lives_ok(
  $$select app.post_inventory_import(
    '9b000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001',
    (select id from app.inventory_import_batches where tenant_id='9c000000-0000-4000-8000-000000000001'),
    'cutover-post-001','cutover-post-hash-001','cutover-post-request-001')$$,
  'approved batch posts atomically'
);
select is((select status from app.inventory_import_batches where tenant_id='9c000000-0000-4000-8000-000000000001'),'posted','batch moves to posted');
select is((select count(*)::integer from app.inventory_balances where tenant_id='9c000000-0000-4000-8000-000000000001'),2,'every accepted row creates a balance');
select is((select count(*)::integer from app.inventory_movements where tenant_id='9c000000-0000-4000-8000-000000000001' and movement_type='OPENING_BALANCE'),1,'positive stock creates one immutable opening movement');
select is((select on_hand from app.inventory_balances where tenant_id='9c000000-0000-4000-8000-000000000001' and variant_id='9f000000-0000-4000-8000-000000000001'),10.000::numeric,'posted on-hand matches staging');
select is((select reserved from app.inventory_balances where tenant_id='9c000000-0000-4000-8000-000000000001' and variant_id='9f000000-0000-4000-8000-000000000001'),2.000::numeric,'posted reserved stock matches staging');
select is((select damaged from app.inventory_balances where tenant_id='9c000000-0000-4000-8000-000000000001' and variant_id='9f000000-0000-4000-8000-000000000001'),1.000::numeric,'posted damaged stock matches staging');
select is((select in_transit from app.inventory_balances where tenant_id='9c000000-0000-4000-8000-000000000001' and variant_id='9f000000-0000-4000-8000-000000000001'),3.000::numeric,'posted in-transit stock matches staging');
select is((select reorder_level from app.inventory_reorder_policies where tenant_id='9c000000-0000-4000-8000-000000000001' and variant_id='9f000000-0000-4000-8000-000000000001'),5.000::numeric,'posting configures reorder level');
select ok(not app.is_location_inventory_cutover_ready('9c000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000001'),'posted but unreconciled inventory keeps POS locked');
select lives_ok(
  $$select app.post_inventory_import(
    '9b000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001',
    (select id from app.inventory_import_batches where tenant_id='9c000000-0000-4000-8000-000000000001'),
    'cutover-post-001','cutover-post-hash-001','cutover-post-retry')$$,
  'posting retry returns its stored response'
);
select is((select count(*)::integer from app.inventory_movements where tenant_id='9c000000-0000-4000-8000-000000000001'),1,'posting retry creates no duplicate movements');
select lives_ok(
  $$select app.reconcile_inventory_import(
    '9b000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001',
    (select id from app.inventory_import_batches where tenant_id='9c000000-0000-4000-8000-000000000001'),
    'cutover-reconcile-001','cutover-reconcile-hash-001','cutover-reconcile-request-001')$$,
  'posted balances reconcile against staging'
);
select is((select status from app.inventory_import_batches where tenant_id='9c000000-0000-4000-8000-000000000001'),'reconciled','batch moves to reconciled');
select ok(app.is_location_inventory_cutover_ready('9c000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000001'),'reconciled branch is ready for POS');
select is((select count(*)::integer from audit.audit_events where tenant_id='9c000000-0000-4000-8000-000000000001' and action in('inventory.import.posted','inventory.import.reconciled')),2,'posting and reconciliation are audited');
select is((select count(*)::integer from integration.event_outbox where tenant_id='9c000000-0000-4000-8000-000000000001' and topic in('inventory.import.posted','inventory.import.reconciled')),2,'posting and reconciliation emit outbox events');
select throws_ok(
  $$update app.inventory_import_rows set source_reference='changed' where tenant_id='9c000000-0000-4000-8000-000000000001'$$,
  'HCS31','Posted inventory import rows are immutable','reconciled import rows cannot be edited'
);

insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost) values
  ('9c000000-0000-4000-8000-000000000002','9d000000-0000-4000-8000-000000000002','9f000000-0000-4000-8000-000000000003',5,200);
select ok(app.is_location_inventory_cutover_ready('9c000000-0000-4000-8000-000000000002','9d000000-0000-4000-8000-000000000002'),'legacy branch with existing balance remains POS-compatible');

select * from finish();
rollback;
