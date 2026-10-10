begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('app', 'wholesale_legacy_invoices', 'legacy eligibility registry exists');
select has_table('app', 'wholesale_receivable_charges', 'opening charge ledger exists');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('app.wholesale_legacy_invoices'::regclass, 'app.wholesale_receivable_charges'::regclass)), 'both tables use RLS');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.wholesale_receivable_charges', 'select'), 'API has no direct ledger read');
select ok(not has_table_privilege('authenticated', 'app.wholesale_receivable_charges', 'insert'), 'browser cannot post debt');
select ok(not has_function_privilege('authenticated', 'app.record_wholesale_opening_receivable(uuid,uuid,jsonb,text,text,text)', 'execute'), 'browser cannot call command');
select ok(not has_function_privilege('hcs_hyperdrive', 'app.assert_wholesale_receivable_access(uuid,uuid,boolean)', 'execute'), 'internal authorization helper is private');

-- Two synthetic tenants with immutable AW2-style invoices. Only the first is registered as legacy.
do $$
declare
  n integer;
  owner_id uuid;
  v_tenant_id uuid;
  customer_id uuid;
  location_id uuid;
  price_id uuid;
  order_id uuid;
  sale_id uuid;
  invoice_id uuid;
begin
  for n in 1..2 loop
    owner_id := ('11000000-0000-4000-8000-00000000000' || n)::uuid;
    v_tenant_id := ('22000000-0000-4000-8000-00000000000' || n)::uuid;
    customer_id := ('33000000-0000-4000-8000-00000000000' || n)::uuid;
    location_id := ('44000000-0000-4000-8000-00000000000' || n)::uuid;
    price_id := ('55000000-0000-4000-8000-00000000000' || n)::uuid;
    order_id := ('66000000-0000-4000-8000-00000000000' || n)::uuid;
    sale_id := ('77000000-0000-4000-8000-00000000000' || n)::uuid;
    invoice_id := ('88000000-0000-4000-8000-00000000000' || n)::uuid;
    insert into auth.users (id, email, aud, role, email_confirmed_at)
      values (owner_id, 'opening-owner-' || n || '@example.invalid', 'authenticated', 'authenticated', now());
    insert into app.tenants (id, slug, name) values (v_tenant_id, 'opening-tenant-' || n, 'Opening tenant ' || n);
    insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at)
      values (v_tenant_id, owner_id, 'active', true, now());
    update app.tenant_entitlements set entitled = true, enabled = true
      where app.tenant_entitlements.tenant_id = v_tenant_id and feature_code = 'advanced_wholesale';
    insert into app.customers (id, tenant_id, customer_number, full_name, email, customer_type, origin, created_by_user_id)
      values (customer_id, v_tenant_id, 'CUST-001', 'Opening Reseller', 'reseller@example.invalid', 'reseller', 'backoffice', owner_id);
    insert into app.locations (id, tenant_id, code, name) values (location_id, v_tenant_id, 'MAIN', 'Main Store');
    insert into app.price_lists (id, tenant_id, code, name, pricing_type, created_by)
      values (price_id, v_tenant_id, 'WHOLESALE', 'Wholesale', 'wholesale', owner_id);
    insert into app.sales_orders (id, tenant_id, order_number, customer_id, location_id, price_list_id, pricing_type, created_by)
      values (order_id, v_tenant_id, 'SO-OPENING-001', customer_id, location_id, price_id, 'wholesale', owner_id);
    insert into app.sales (id, tenant_id, location_id, receipt_number, subtotal, total, channel, completed_by_user_id)
      values (sale_id, v_tenant_id, location_id, 'OPENING-001', 2250, 2250, 'wholesale', owner_id);
    insert into app.invoices (id, tenant_id, invoice_number, sales_order_id, sale_id, customer_id, location_id,
      order_number_snapshot, customer_number_snapshot, customer_name_snapshot, location_name_snapshot, subtotal, total, issued_by)
      values (invoice_id, v_tenant_id, 'INV-OPENING-001', order_id, sale_id, customer_id, location_id,
        'SO-OPENING-001', 'CUST-001', 'Opening Reseller', 'Main Store', 2250, 2250, owner_id);
  end loop;
end;
$$;
insert into app.wholesale_legacy_invoices (tenant_id, invoice_id)
values ('22000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000001');

create function pg_temp.open_invoice(p_owner uuid, p_tenant uuid, p_invoice uuid, p_key text, p_hash text default 'opening-hash')
returns jsonb language sql as $$
  select app.record_wholesale_opening_receivable(p_owner, p_tenant,
    jsonb_build_object('invoiceId', p_invoice, 'dueDate', '2026-10-10', 'reason', 'Owner confirmed unpaid opening'),
    p_key, p_hash, 'opening-request');
$$;

select is(app.load_wholesale_receivables('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001')->'invoices'->0->>'classification', 'unclassified', 'legacy is not automatically unpaid or paid');
select ok(app.load_wholesale_receivables('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001')->'invoices'->0->>'openBalanceMinor' is null, 'unclassified balance is unknown, not zero');
select throws_ok($$select pg_temp.open_invoice('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000002', '88000000-0000-4000-8000-000000000002', 'opening-foreign-001')$$, 'HCAR1', 'Wholesale receivable access denied', 'foreign membership denied');
select throws_ok($$select pg_temp.open_invoice('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000002', 'opening-foreign-002')$$, 'HCAR3', 'Eligible legacy invoice not found', 'foreign invoice denied');
select throws_ok($$select pg_temp.open_invoice('11000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000002', '88000000-0000-4000-8000-000000000002', 'opening-new-invoice')$$, 'HCAR3', 'Eligible legacy invoice not found', 'post-migration invoice cannot masquerade as opening');
select lives_ok($$select pg_temp.open_invoice('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000001', 'opening-command-001')$$, 'owner posts opening');
select is((select amount from app.wholesale_receivable_charges where tenant_id = '22000000-0000-4000-8000-000000000001'), 2250::numeric, 'amount derived from immutable invoice');
select lives_ok($$select pg_temp.open_invoice('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000001', 'opening-command-001')$$, 'same-key retry replays');
select is((select count(*) from app.wholesale_receivable_charges where tenant_id = '22000000-0000-4000-8000-000000000001'), 1::bigint, 'retry does not duplicate debt');
select is((select count(*) from audit.audit_events where tenant_id = '22000000-0000-4000-8000-000000000001' and action = 'wholesale_receivable.opened'), 1::bigint, 'one audit event');
select is((select count(*) from integration.event_outbox where tenant_id = '22000000-0000-4000-8000-000000000001' and topic = 'wholesale_receivable.opened'), 1::bigint, 'one outbox event');
select throws_ok($$select pg_temp.open_invoice('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000001', 'opening-command-001', 'changed-hash')$$, 'HCS08', 'Idempotency key conflict', 'changed retry rejected');
select throws_ok($$select pg_temp.open_invoice('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000001', 'opening-command-002')$$, 'HCAR4', 'Invoice is already classified', 'different key cannot reclassify');
select throws_ok($$update app.wholesale_receivable_charges set amount = 1 where tenant_id = '22000000-0000-4000-8000-000000000001'$$, 'P0001', 'issued invoices are immutable', 'opening charge update denied');
select throws_ok($$delete from app.wholesale_receivable_charges where tenant_id = '22000000-0000-4000-8000-000000000001'$$, 'P0001', 'issued invoices are immutable', 'opening charge deletion denied');
select is((select total from app.sales where tenant_id = '22000000-0000-4000-8000-000000000001'), 2250::numeric, 'opening does not change revenue');
select is((select count(*) from app.sales where tenant_id = '22000000-0000-4000-8000-000000000001'), 1::bigint, 'opening does not create another sale');
select is((select count(*) from app.sale_payments where tenant_id = '22000000-0000-4000-8000-000000000001'), 0::bigint, 'opening does not claim cash payment');
select is((select count(*) from app.inventory_movements where tenant_id = '22000000-0000-4000-8000-000000000001'), 0::bigint, 'opening does not move inventory');
select is(app.load_wholesale_receivables('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001')->'invoices'->0->>'openBalanceMinor', '225000', 'read model reports debt in minor units');
select throws_ok($$
  select app.record_wholesale_opening_receivable('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
    '{"invoiceId":"88000000-0000-4000-8000-000000000001","dueDate":"2026-10-10","reason":"Opening","amountMinor":1}',
    'opening-tampered-001', 'hash', 'request')
$$, 'HCAR2', 'Invalid opening receivable request', 'direct SQL command rejects browser-supplied amount');
update app.tenant_memberships set is_owner = false
  where tenant_id = '22000000-0000-4000-8000-000000000001' and user_id = '11000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.open_invoice('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000001', 'opening-command-001')$$, 'HCAR1', 'Wholesale receivable access denied', 'revoked ownership blocks even a replay');
update app.tenant_memberships set is_owner = true, status = 'suspended'
  where tenant_id = '22000000-0000-4000-8000-000000000001' and user_id = '11000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.open_invoice('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000001', 'opening-command-001')$$, 'HCAR1', 'Wholesale receivable access denied', 'inactive owner blocks even a replay');
update app.tenant_memberships set status = 'active'
  where tenant_id = '22000000-0000-4000-8000-000000000001' and user_id = '11000000-0000-4000-8000-000000000001';
update app.tenant_entitlements set enabled = false
  where tenant_id = '22000000-0000-4000-8000-000000000001' and feature_code = 'advanced_wholesale';
select throws_ok($$select app.load_wholesale_receivables('11000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001')$$, 'HCSQ0', 'Advanced wholesale is not enabled', 'disabled entitlement hides receivables');
select * from finish();
rollback;
