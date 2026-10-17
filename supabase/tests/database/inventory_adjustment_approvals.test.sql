begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

select has_table('app', 'approval_policies', 'approval policies table exists');
select has_table('app', 'approval_requests', 'approval requests table exists');
select has_function('app', 'list_approval_center', array['uuid','uuid'], 'approval center query exists');
select has_function('app', 'update_inventory_adjustment_approval_policy', array['uuid','uuid','numeric','text','text','text'], 'approval policy command exists');
select has_function('app', 'decide_approval_request', array['uuid','uuid','uuid','text','text','text','text','text'], 'approval decision command exists');
select ok(not has_table_privilege('authenticated', 'app.approval_requests', 'SELECT'), 'browser role cannot read approval requests directly');
select ok(not has_function_privilege('authenticated', 'app.decide_approval_request(uuid,uuid,uuid,text,text,text,text,text)', 'EXECUTE'), 'browser role cannot decide approvals directly');
select ok(has_function_privilege('hcs_hyperdrive', 'app.decide_approval_request(uuid,uuid,uuid,text,text,text,text,text)', 'EXECUTE'), 'API role can decide approvals');

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('19000000-0000-4000-8000-000000000001', 'approval-owner@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('29000000-0000-4000-8000-000000000001', 'approval-one', 'Approval One'),
  ('29000000-0000-4000-8000-000000000002', 'approval-two', 'Approval Two');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('29000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', 'active', true, now());
insert into app.locations (id, tenant_id, code, name) values
  ('39000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000001', 'MAIN', 'Main Store');
update app.tenant_entitlements set enabled = true
where tenant_id = '29000000-0000-4000-8000-000000000001' and feature_code = 'inventory';

select lives_ok(
  $$select app.create_catalog_product(
    '19000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000001',
    'Approval Tee', null, 'Shirts', 'Medium', 'APR-M', 899, 450, true,
    array['490000000501'], 'approval-product-001', 'approval-product-hash', 'approval-product-request'
  )$$,
  'owner creates an inventory-tracked product'
);
select lives_ok(
  $$select app.record_opening_inventory(
    '19000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'variantId', (select id from app.product_variants where tenant_id = '29000000-0000-4000-8000-000000000001'),
      'quantity', '10.000', 'unitCost', '450.00'
    )), 'approval-opening-001', 'approval-opening-hash', 'approval-opening-request'
  )$$,
  'opening balance exists before a controlled adjustment'
);
select lives_ok(
  $$select app.update_inventory_adjustment_approval_policy(
    '19000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000001',
    1.000, 'approval-policy-001', 'approval-policy-hash', 'approval-policy-request'
  )$$,
  'owner enables a one-unit approval threshold'
);
select is((select inventory_adjustment_threshold from app.approval_policies where tenant_id = '29000000-0000-4000-8000-000000000001'), 1.000::numeric, 'threshold is tenant scoped');

select lives_ok(
  $$select app.record_inventory_adjustment(
    '19000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select id from app.product_variants where tenant_id = '29000000-0000-4000-8000-000000000001'),
    -2.000, null, 'Cycle count correction', 'approval-adjustment-001', 'approval-adjustment-hash', 'approval-adjustment-request'
  )$$,
  'adjustment above threshold becomes an approval request'
);
select is((select count(*)::integer from app.approval_requests where tenant_id = '29000000-0000-4000-8000-000000000001' and status = 'pending'), 1, 'one pending request exists');
select is((select count(*)::integer from app.inventory_movements where tenant_id = '29000000-0000-4000-8000-000000000001'), 1, 'pending request creates no stock movement');
select is((select on_hand from app.inventory_balances where tenant_id = '29000000-0000-4000-8000-000000000001'), 10.000::numeric, 'pending request does not change stock');

select lives_ok(
  $$select app.decide_approval_request(
    '19000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000001',
    (select id from app.approval_requests where tenant_id = '29000000-0000-4000-8000-000000000001'),
    'approved', 'Count verified', 'approval-decision-001', 'approval-decision-hash', 'approval-decision-request'
  )$$,
  'owner approves the pending adjustment'
);
select is((select status from app.approval_requests where tenant_id = '29000000-0000-4000-8000-000000000001'), 'approved', 'request is marked approved');
select is((select on_hand from app.inventory_balances where tenant_id = '29000000-0000-4000-8000-000000000001'), 8.000::numeric, 'approval applies the stock change atomically');
select is((select count(*)::integer from app.inventory_movements where tenant_id = '29000000-0000-4000-8000-000000000001' and source_type = 'approved_inventory_adjustment'), 1, 'approval appends one adjustment movement');
select throws_ok(
  $$select app.list_approval_center(
    '19000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000002'
  )$$,
  'HCS23', 'Approval access is not allowed', 'cross-tenant approval access is blocked'
);

select * from finish();
rollback;
