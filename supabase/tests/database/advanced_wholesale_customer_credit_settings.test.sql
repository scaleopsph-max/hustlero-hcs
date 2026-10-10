begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_table('app', 'wholesale_customer_credit_settings', 'credit history exists');
select ok((select relrowsecurity from pg_class where oid = 'app.wholesale_customer_credit_settings'::regclass), 'credit history has RLS');
select ok(not has_table_privilege('hcs_hyperdrive', 'app.wholesale_customer_credit_settings', 'select'), 'API cannot directly read history');
select ok(not has_table_privilege('authenticated', 'app.wholesale_customer_credit_settings', 'insert'), 'browser cannot change credit');
select ok(not has_function_privilege('authenticated', 'app.save_wholesale_customer_credit_settings(uuid,uuid,jsonb,text,text,text)', 'execute'), 'browser cannot execute credit command');

do $$
declare n integer; v_actor uuid; v_tenant uuid; v_customer uuid;
begin
  for n in 1..2 loop
    v_actor := ('1c000000-0000-4000-8000-00000000000' || n)::uuid;
    v_tenant := ('2c000000-0000-4000-8000-00000000000' || n)::uuid;
    v_customer := ('3c000000-0000-4000-8000-00000000000' || n)::uuid;
    insert into auth.users (id, email, aud, role, email_confirmed_at)
      values (v_actor, 'credit-owner-' || n || '@example.invalid', 'authenticated', 'authenticated', now());
    insert into app.tenants (id, slug, name) values (v_tenant, 'credit-tenant-' || n, 'Credit tenant ' || n);
    insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at)
      values (v_tenant, v_actor, 'active', true, now());
    update app.tenant_entitlements set entitled = true, enabled = true where tenant_id = v_tenant and feature_code = 'advanced_wholesale';
    insert into app.customers (id, tenant_id, customer_number, full_name, email, customer_type, origin, created_by_user_id)
      values (v_customer, v_tenant, 'CREDIT-001', 'Credit Reseller', 'credit@example.invalid', 'reseller', 'backoffice', v_actor);
  end loop;
end;
$$;

create function pg_temp.save_credit(p_actor uuid, p_tenant uuid, p_customer uuid, p_term text, p_limit numeric, p_key text, p_hash text default 'credit-hash')
returns jsonb language sql as $$
  select app.save_wholesale_customer_credit_settings(p_actor, p_tenant,
    jsonb_build_object('customerId', p_customer, 'paymentTerm', p_term, 'creditLimitMinor', p_limit, 'reason', 'Credit settings test'),
    p_key, p_hash, 'credit-request');
$$;

select ok(app.load_wholesale_customer_credit_settings('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001')->'customers'->0->'settings' = 'null'::jsonb, 'no implicit customer term or credit limit');
select lives_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'net_7', 500000, 'credit-command-001')$$, 'owner saves first revision');
select lives_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'net_7', 500000, 'credit-command-001')$$, 'retry replays first revision');
select is((select count(*) from app.wholesale_customer_credit_settings where tenant_id = '2c000000-0000-4000-8000-000000000001'), 1::bigint, 'no duplicate history from retry');
select is((select credit_limit from app.wholesale_customer_credit_settings where tenant_id = '2c000000-0000-4000-8000-000000000001'), 5000::numeric, 'minor units persist as exact numeric money');
select is((select count(*) from audit.audit_events where tenant_id = '2c000000-0000-4000-8000-000000000001' and action = 'wholesale_credit_settings.saved'), 1::bigint, 'one audit for replayed command');
select is((select count(*) from integration.event_outbox where tenant_id = '2c000000-0000-4000-8000-000000000001' and topic = 'wholesale_credit_settings.saved'), 1::bigint, 'one outbox for replayed command');
select throws_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'net_30', 500000, 'credit-command-001', 'changed')$$, 'HCS08', 'Idempotency key conflict', 'changed replay rejected');
select lives_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'cod', 0, 'credit-command-002')$$, 'zero-credit revision saved');
select is(app.load_wholesale_customer_credit_settings('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001')->'customers'->0->'settings'->>'revision', '2', 'read returns latest ordinal even at same transaction timestamp');
select is(app.load_wholesale_customer_credit_settings('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001')->'customers'->0->'settings'->>'creditLimitMinor', '0', 'zero is zero, not unlimited');
select is((select payment_term from app.wholesale_customer_credit_settings where tenant_id = '2c000000-0000-4000-8000-000000000001' and revision = 1), 'net_7', 'prior terms preserved');
select throws_ok($$update app.wholesale_customer_credit_settings set credit_limit = 1 where tenant_id = '2c000000-0000-4000-8000-000000000001'$$, 'P0001', 'Wholesale credit settings history is immutable', 'history update denied');
select throws_ok($$delete from app.wholesale_customer_credit_settings where tenant_id = '2c000000-0000-4000-8000-000000000001'$$, 'P0001', 'Wholesale credit settings history is immutable', 'history deletion denied');
select throws_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000002', '3c000000-0000-4000-8000-000000000002', 'cod', 0, 'credit-foreign-001')$$, 'HCAR1', 'Wholesale receivable access denied', 'foreign tenant denied');
select throws_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000002', 'cod', 0, 'credit-foreign-002')$$, 'HCCS3', 'Active reseller not found', 'foreign customer denied');
select throws_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'cod', -1, 'credit-negative-001')$$, 'HCCS2', 'Invalid credit settings', 'negative limit denied');
select throws_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'cash', 0, 'credit-invalid-001')$$, 'HCCS2', 'Invalid credit settings', 'payment method is not a term');

select throws_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'net_7', 0.5, 'credit-fraction-001')$$, 'HCCS2', 'Invalid credit settings', 'fractional minor units denied');
select throws_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'net_7', 9007199254740992, 'credit-overflow-001')$$, 'HCCS2', 'Invalid credit settings', 'unsafe integer limit denied');
select throws_ok($$select app.save_wholesale_customer_credit_settings('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '{"customerId":"3c000000-0000-4000-8000-000000000001","paymentTerm":"cod","creditLimitMinor":0,"reason":["bad"]}'::jsonb, 'credit-malformed-001', 'hash', 'request')$$, 'HCCS2', 'Invalid credit settings', 'non-string reason denied in database');

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('1c000000-0000-4000-8000-000000000003', 'credit-reader@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner) values
  ('2c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000003', 'active', false);
insert into app.roles (id, tenant_id, code, name) values ('4c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', 'credit-test-reader', 'Credit Test Reader');
insert into app.role_permissions (tenant_id, role_id, permission_code) values ('2c000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000001', 'wholesale_orders.read');
insert into app.membership_roles (tenant_id, user_id, role_id) values ('2c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000003', '4c000000-0000-4000-8000-000000000001');
select is(app.load_wholesale_customer_credit_settings('1c000000-0000-4000-8000-000000000003', '2c000000-0000-4000-8000-000000000001')->>'canManage', 'false', 'reader cannot manage');
select throws_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000003', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'cod', 0, 'credit-reader-001')$$, 'HCCS1', 'Wholesale credit management is not allowed', 'read permission does not permit write');
insert into app.role_permissions (tenant_id, role_id, permission_code) values ('2c000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000001', 'wholesale_orders.manage');
select lives_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000003', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'net_15', 100000, 'credit-manager-001')$$, 'authorized manager can save');
update app.customers set status = 'inactive' where tenant_id = '2c000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.save_credit('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'cod', 0, 'credit-command-002')$$, 'HCCS3', 'Active reseller not found', 'inactive reseller blocks replay');
select is((select count(*) from app.wholesale_receivable_charges where tenant_id = '2c000000-0000-4000-8000-000000000001'), 0::bigint, 'configuration does not create debt');
select is((select count(*) from app.inventory_movements where tenant_id = '2c000000-0000-4000-8000-000000000001'), 0::bigint, 'configuration does not move stock');
select * from finish();
rollback;
