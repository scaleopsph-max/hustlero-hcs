begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('app', 'invoices', 'invoice table exists');
select has_table('app', 'invoice_lines', 'invoice line table exists');
select has_table('app', 'invoice_counters', 'invoice counter table exists');
select has_function('app', 'fulfill_wholesale_order', array['uuid','uuid','uuid','jsonb','text','text','text'], 'fulfillment command exists');
select has_function('app', 'list_wholesale_invoices', array['uuid','uuid'], 'invoice listing exists');
select has_function('app', 'list_sales_archive', array['uuid','uuid','integer'], 'combined Sales archive exists');
select has_function('app', 'load_sale_archive_record', array['uuid','uuid','uuid'], 'combined sale detail exists');
select has_function('app', 'load_reporting_by_channel', array['uuid','uuid','date','date','uuid','text'], 'channel-aware reporting exists');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.invoices', 'select'), 'API login cannot read invoices directly');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.invoice_lines', 'select'), 'API login cannot read invoice lines directly');
select ok(has_function_privilege('hcs_hyperdrive', 'app.fulfill_wholesale_order(uuid,uuid,uuid,jsonb,text,text,text)', 'execute'), 'API login can execute fulfillment');
select ok(has_function_privilege('hcs_hyperdrive', 'app.load_reporting_by_channel(uuid,uuid,date,date,uuid,text)', 'execute'), 'API login can execute channel-aware reporting');

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('1f000000-0000-4000-8000-000000000001', 'aw2-owner-a@example.invalid', 'authenticated', 'authenticated', now()),
  ('1f000000-0000-4000-8000-000000000002', 'aw2-owner-b@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('2f000000-0000-4000-8000-000000000001', 'aw2-tenant-a', 'AW2 Tenant A'),
  ('2f000000-0000-4000-8000-000000000002', 'aw2-tenant-b', 'AW2 Tenant B');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('2f000000-0000-4000-8000-000000000001', '1f000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('2f000000-0000-4000-8000-000000000002', '1f000000-0000-4000-8000-000000000002', 'active', true, now());
update app.tenant_entitlements set entitled = true, enabled = true
where tenant_id in ('2f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000002')
  and feature_code = 'advanced_wholesale';

select lives_ok($$
  select app.create_customer(
    '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
    'AW2 Reseller', 'aw2-reseller@example.invalid', null, null, 'reseller', false, false,
    'aw2-customer-001', 'aw2-customer-hash', 'aw2-customer-request'
  )
$$, 'reseller customer is created');

insert into app.locations (id, tenant_id, code, name) values
  ('3f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001', 'MAIN', 'Main Warehouse');
insert into app.products (id, tenant_id, name, created_by) values
  ('4f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
   'AW2 Shared Shirt', '1f000000-0000-4000-8000-000000000001');
insert into app.product_variants (id, tenant_id, product_id, name, sku, retail_price, unit_cost, created_by) values
  ('5f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
   '4f000000-0000-4000-8000-000000000001', 'Black / Medium', 'AW2-BLK-M', 799.00, 250.00,
   '1f000000-0000-4000-8000-000000000001');
insert into app.inventory_balances (tenant_id, location_id, variant_id, on_hand, reserved, average_unit_cost) values
  ('2f000000-0000-4000-8000-000000000001', '3f000000-0000-4000-8000-000000000001',
   '5f000000-0000-4000-8000-000000000001', 25.000, 0, 250.00);

select lives_ok($$
  select app.upsert_price_list(
    '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'code', 'AW2-WHOLESALE', 'name', 'AW2 Wholesale', 'pricingType', 'wholesale',
      'isDefault', true, 'isActive', true,
      'pricingGroup', jsonb_build_object('code', 'AW2-CORE', 'name', 'AW2 core', 'thresholdMilli', 10000),
      'customerIds', '[]'::jsonb,
      'entries', jsonb_build_array(jsonb_build_object(
        'variantId', '5f000000-0000-4000-8000-000000000001', 'unitPriceMinor', 45000
      ))
    ),
    'aw2-price-list-001', 'aw2-price-hash', 'aw2-price-request'
  )
$$, 'AW2 price list is created');

select lives_ok($$
  select app.save_wholesale_order_draft(
    '1f000000-0000-4000-8000-000000000001', '2f000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'orderNumber', 'SO-AW2-001',
      'customerId', (select id from app.customers where tenant_id = '2f000000-0000-4000-8000-000000000001'),
      'locationId', '3f000000-0000-4000-8000-000000000001',
      'priceListId', (select id from app.price_lists where tenant_id = '2f000000-0000-4000-8000-000000000001'),
      'pricingType', 'wholesale', 'notes', 'Partial fulfillment UAT',
      'lines', jsonb_build_array(jsonb_build_object(
        'variantId', '5f000000-0000-4000-8000-000000000001', 'quantityMilli', 10000
      ))
    ),
    'aw2-draft-001', 'aw2-draft-hash', 'aw2-draft-request'
  )
$$, 'AW2 draft is created');
create function pg_temp.aw3_settings(p_term text,p_limit bigint,p_key text) returns jsonb language sql as $$
  select app.save_wholesale_customer_credit_settings('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
    jsonb_build_object('customerId',(select id from app.customers where tenant_id='2f000000-0000-4000-8000-000000000001'),
      'paymentTerm',p_term,'creditLimitMinor',p_limit,'reason','Explicit test agreement'),p_key,p_key,'aw3-test');
$$;
create function pg_temp.aw3_confirm(p_key text) returns jsonb language sql as $$
  select app.confirm_wholesale_order('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id='2f000000-0000-4000-8000-000000000001'),p_key,p_key,'aw3-test');
$$;
create function pg_temp.aw3_fulfill(p_key text) returns jsonb language sql as $$
  select app.fulfill_wholesale_order('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id='2f000000-0000-4000-8000-000000000001'),
    jsonb_build_array(jsonb_build_object('salesOrderLineId',(select id from app.sales_order_lines where tenant_id='2f000000-0000-4000-8000-000000000001'),'quantityMilli',4000)),
    p_key,p_key,'aw3-test');
$$;
create function pg_temp.aw3_override(p_action text,p_amount numeric,p_expiry timestamptz,p_key text,p_hash text default 'override-hash') returns jsonb language sql as $$
  select app.command_wholesale_credit_override('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','approve',
    jsonb_build_object('salesOrderId',(select id from app.sales_orders where tenant_id='2f000000-0000-4000-8000-000000000001'),'action',p_action,
      'approvedExcessMinor',p_amount,'expiresAt',p_expiry,'reason','Explicit scoped test approval'),p_key,p_hash,'override-test');
$$;
select pg_temp.aw3_settings('net_7',449999,'consume-initial-settings-001');
select pg_temp.aw3_override('confirm',50000,clock_timestamp()+interval '1 hour','consume-revoked-approval-001');
select app.command_wholesale_credit_override('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','revoke',
 jsonb_build_object('overrideId',(select id from app.wholesale_credit_overrides),'reason','Withdraw fixture approval'),'consume-fixture-revoke-001','fixture-hash','fixture-revoke');

create function pg_temp.aw3_consumption_confirm(p_override uuid,p_key text,p_hash text default 'consume-hash') returns jsonb language sql as $$
  select app.confirm_wholesale_order_with_credit_override('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id='2f000000-0000-4000-8000-000000000001'),p_key,p_hash,'consume-test',p_override);
$$;
create function pg_temp.aw3_consumption_fulfill(p_override uuid,p_key text,p_quantity bigint default 4000) returns jsonb language sql as $$
  select app.fulfill_wholesale_order_with_credit_override('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',
    (select id from app.sales_orders where tenant_id='2f000000-0000-4000-8000-000000000001'),
    jsonb_build_array(jsonb_build_object('salesOrderLineId',(select id from app.sales_order_lines where tenant_id='2f000000-0000-4000-8000-000000000001'),'quantityMilli',p_quantity)),
    p_key,p_key,'consume-test',p_override);
$$;
select ok((select relrowsecurity from pg_class where oid='app.wholesale_credit_override_consumptions'::regclass),'consumptions use RLS');
select ok(not has_table_privilege('hcs_hyperdrive','app.wholesale_credit_override_consumptions','insert'),'API cannot consume directly');
select ok(not has_function_privilege('hcs_hyperdrive','app.consume_wholesale_credit_override(uuid,uuid,uuid,uuid,text,uuid,numeric,text,text,text)','execute'),'private consumption helper denied');
select ok(not has_function_privilege('authenticated','app.confirm_wholesale_order_with_credit_override(uuid,uuid,uuid,text,text,text,uuid)','execute'),'browser cannot confirm with override directly');
select pg_temp.aw3_settings('net_7',449999,'consume-limit-001');
select throws_ok($$select pg_temp.aw3_consumption_confirm((select id from app.wholesale_credit_overrides),'consume-revoked-001')$$,'HCCO6','Credit approval is not valid for this command','revoked approval denied');
select throws_ok($$select pg_temp.aw3_consumption_confirm('00000000-0000-4000-8000-000000000001','consume-foreign-001')$$,'HCCO6','Credit approval is not valid for this command','unknown or foreign approval denied');
select pg_temp.aw3_override('confirm',100,clock_timestamp()+interval '1 hour','consume-approval-001');
select pg_temp.aw3_settings('net_7',450000,'consume-unneeded-limit-001');
select throws_ok($$select pg_temp.aw3_consumption_confirm((select id from app.wholesale_credit_overrides where approved_excess=1),'consume-unneeded-001')$$,'HCCO6','Credit approval is not valid for this command','approval not consumed when normal limit covers exposure');
select throws_ok($$select app.confirm_wholesale_order_with_credit_override('1f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000001',
 (select id from app.sales_orders),'consume-unauthorized-001','unauthorized-hash','unauthorized-test',(select id from app.wholesale_credit_overrides where approved_excess=1))$$,
 'HCSQ1','Wholesale order management is not allowed','foreign actor cannot use approval');
select pg_temp.aw3_settings('net_7',449000,'consume-lower-limit-001');
select throws_ok($$select pg_temp.aw3_consumption_confirm((select id from app.wholesale_credit_overrides where approved_excess=1),'consume-insufficient-001')$$,'HCCO6','Credit approval is not valid for this command','current excess must fit approved cap');
select is((select count(*) from app.wholesale_credit_override_consumptions),0::bigint,'denied commands consume nothing');
select is((select reserved from app.inventory_balances where tenant_id='2f000000-0000-4000-8000-000000000001'),0::numeric,'denied override rolls back stock reservation');
select is((select status from app.sales_orders where tenant_id='2f000000-0000-4000-8000-000000000001'),'draft','denied override rolls back order');
select pg_temp.aw3_settings('net_7',449999,'consume-restore-limit-001');
select lives_ok($$select pg_temp.aw3_consumption_confirm((select id from app.wholesale_credit_overrides where approved_excess=1),'consume-confirm-001')$$,'scoped confirmation consumes approval');
select is((select excess from app.wholesale_credit_override_consumptions),0.01::numeric,'exact current excess is recorded, not approved cap');
select is((select exposure from app.wholesale_credit_override_consumptions),4500::numeric,'whole-customer exposure recorded');
select is((select count(*) from audit.audit_events where action='wholesale_credit_override.consumed'),1::bigint,'consumption audited once');
select is((select count(*) from integration.event_outbox where topic='wholesale_credit_override.consumed'),1::bigint,'consumption outbox once');
select lives_ok($$select pg_temp.aw3_consumption_confirm((select id from app.wholesale_credit_overrides where approved_excess=1),'consume-confirm-001')$$,'identical confirmation replays');
select is((select count(*) from app.wholesale_credit_override_consumptions),1::bigint,'retry consumes once');
select throws_ok($$select pg_temp.aw3_consumption_confirm((select id from app.wholesale_credit_overrides where approved_excess=1),'consume-confirm-001','changed-hash')$$,'HCS08','Idempotency key conflict','changed confirmation payload cannot replay');
select throws_ok($$select pg_temp.aw3_consumption_confirm((select id from app.wholesale_credit_overrides where approved_excess=500),'consume-confirm-001')$$,'HCS08','Idempotency key conflict','same hash cannot select a different approval on replay');
select throws_ok($$select pg_temp.aw3_consumption_fulfill((select id from app.wholesale_credit_overrides where approved_excess=1),'consume-wrong-action-001')$$,'HCCO6','Credit approval is not valid for this command','confirmation approval cannot authorize fulfillment');
select is((select count(*) from app.invoices where tenant_id='2f000000-0000-4000-8000-000000000001'),0::bigint,'wrong action rolls back invoice');
select pg_temp.aw3_override('fulfill',100,clock_timestamp()+interval '1 hour','consume-fulfill-approval-001');
select lives_ok($$select pg_temp.aw3_consumption_fulfill((select id from app.wholesale_credit_overrides where action='fulfill'),'consume-fulfill-001')$$,'separate fulfillment approval consumed');
select lives_ok($$select pg_temp.aw3_consumption_fulfill((select id from app.wholesale_credit_overrides where action='fulfill'),'consume-fulfill-001')$$,'identical fulfillment replays');
select is((select count(*) from app.wholesale_credit_override_consumptions),2::bigint,'confirmation and fulfillment each consume once');
select is((select count(*) from app.wholesale_invoice_charges),1::bigint,'fulfillment retry posts one charge');
select throws_ok($$select pg_temp.aw3_consumption_fulfill((select id from app.wholesale_credit_overrides where action='fulfill'),'consume-fulfill-reuse-001')$$,'HCCO6','Credit approval is not valid for this command','fresh partial fulfillment cannot reuse approval');
select is((select on_hand from app.inventory_balances where tenant_id='2f000000-0000-4000-8000-000000000001'),21::numeric,'failed reuse rolls back extra deduction');
select throws_ok($$delete from app.wholesale_credit_override_consumptions$$,'P0001','issued invoices are immutable','consumption immutable');
select * from finish();
rollback;
