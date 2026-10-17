begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('1d000000-0000-4000-8000-000000000001', 'priced-sale-a@example.invalid', 'authenticated', 'authenticated', now()),
  ('1d000000-0000-4000-8000-000000000002', 'priced-sale-b@example.invalid', 'authenticated', 'authenticated', now());
insert into app.tenants (id, slug, name) values
  ('2d000000-0000-4000-8000-000000000001', 'priced-sale-a', 'Priced Sale A'),
  ('2d000000-0000-4000-8000-000000000002', 'priced-sale-b', 'Priced Sale B');
insert into app.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at) values
  ('2d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', 'active', true, now()),
  ('2d000000-0000-4000-8000-000000000002', '1d000000-0000-4000-8000-000000000002', 'active', true, now());

select lives_ok($$
  select app.create_customer(
    '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
    'Reseller A', 'reseller-a@example.invalid', null, null, 'reseller', false, false,
    'priced-customer-a', 'customer-a-hash', 'customer-a-request'
  )
$$, 'tenant A reseller is created');
select lives_ok($$
  select app.create_customer(
    '1d000000-0000-4000-8000-000000000002', '2d000000-0000-4000-8000-000000000002',
    'Reseller B', 'reseller-b@example.invalid', null, null, 'reseller', false, false,
    'priced-customer-b', 'customer-b-hash', 'customer-b-request'
  )
$$, 'tenant B reseller is created');

insert into app.locations (id, tenant_id, code, name) values
  ('3d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001', 'MAIN', 'Main Store');
insert into app.employees (id, tenant_id, employee_code, display_name) values
  ('4d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001', 'CASH-1', 'Cashier One');
insert into app.employee_locations (tenant_id, employee_id, location_id) values
  ('2d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001');
insert into app.employee_roles (tenant_id, employee_id, role_id)
select '2d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', id
from app.roles where tenant_id = '2d000000-0000-4000-8000-000000000001' and code = 'cashier';
insert into app.registers (id, tenant_id, location_id, name, code) values
  ('5d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
   '3d000000-0000-4000-8000-000000000001', 'Register 1', 'REG-1');
insert into app.pos_devices (
  id, tenant_id, register_id, location_id, name, status, token_hash, activated_at, created_by_user_id
) values (
  '6d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
  '5d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001',
  'Priced Sale POS', 'active', repeat('a', 64), now(), '1d000000-0000-4000-8000-000000000001'
);
insert into app.pos_employee_sessions (
  tenant_id, device_id, register_id, location_id, employee_id, token_hash, expires_at
) values (
  '2d000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000001',
  '5d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001',
  '4d000000-0000-4000-8000-000000000001', repeat('b', 64), now() + interval '1 hour'
);
insert into app.products (id, tenant_id, name, created_by) values
  ('7d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
   'Shared Stock Shirt', '1d000000-0000-4000-8000-000000000001');
insert into app.product_variants (
  id, tenant_id, product_id, name, sku, retail_price, unit_cost, created_by
) values (
  '8d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
  '7d000000-0000-4000-8000-000000000001', 'Black / XL', 'SHARED-XL', 899.00, 450.00,
  '1d000000-0000-4000-8000-000000000001'
);
insert into app.inventory_balances (tenant_id, location_id, variant_id, on_hand, average_unit_cost) values
  ('2d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001',
   '8d000000-0000-4000-8000-000000000001', 100.000, 450.00);

select lives_ok($$
  select app.upsert_price_list(
    '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'code', 'WHOLESALE', 'name', 'Wholesale', 'pricingType', 'wholesale', 'isDefault', true, 'isActive', true,
      'pricingGroup', jsonb_build_object('code', 'WHOLESALE-GROUP', 'name', 'Wholesale group', 'thresholdMilli', 6000),
      'customerIds', jsonb_build_array((select id from app.customers where tenant_id = '2d000000-0000-4000-8000-000000000001')),
      'entries', jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'unitPriceMinor', 75000))
    ),
    'priced-list-wholesale', 'list-wholesale-hash', 'list-wholesale-request'
  )
$$, 'wholesale list is configured');
select lives_ok($$
  select app.upsert_price_list(
    '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'code', 'DEALER', 'name', 'Dealer', 'pricingType', 'dealer', 'isDefault', true, 'isActive', true,
      'pricingGroup', jsonb_build_object('code', 'DEALER-GROUP', 'name', 'Dealer group', 'thresholdMilli', 12000),
      'customerIds', jsonb_build_array((select id from app.customers where tenant_id = '2d000000-0000-4000-8000-000000000001')),
      'entries', jsonb_build_array(jsonb_build_object('variantId', '8d000000-0000-4000-8000-000000000001', 'unitPriceMinor', 60000))
    ),
    'priced-list-dealer', 'list-dealer-hash', 'list-dealer-request'
  )
$$, 'dealer list is configured');
select lives_ok($$
  select app.open_pos_register_session(repeat('b', 64), 100000, 'priced-register-open', 'open-hash', 'open-request')
$$, 'cashier opens the shared-stock register');


insert into app.locations(id,tenant_id,code,name) values
 ('3d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001','OTHER','Other Branch');
insert into app.employees(id,tenant_id,employee_code,display_name) values
 ('4d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001','CASH-2','Other Cashier');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
 ('2d000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000002','3d000000-0000-4000-8000-000000000001');
create function pg_temp.new_scope_session(p_label text,p_employee uuid default '4d000000-0000-4000-8000-000000000001')
returns text language plpgsql as $$
declare v_hash text:=repeat(md5(p_label),2);
begin
 insert into app.pos_employee_sessions(tenant_id,device_id,register_id,location_id,employee_id,token_hash,expires_at)
 values('2d000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001',
 '5d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000001',p_employee,v_hash,now()+interval '1 hour');
 return v_hash;
end;
$$;
create function pg_temp.scope_sale(p_hash text,p_key text) returns jsonb language sql as $$
 select app.complete_pos_priced_sale(p_hash,
 jsonb_build_array(jsonb_build_object('variantId','8d000000-0000-4000-8000-000000000001','quantityMilli',1000)),
 jsonb_build_array(jsonb_build_object('paymentMethodId',(select id from app.payment_methods where tenant_id='2d000000-0000-4000-8000-000000000001' and code='cash'),
 'amountCentavos',89900,'tenderedCentavos',90000)),null,'retail',p_key,'scope-sale-hash','scope-test');
$$;
create function pg_temp.scope_truth() returns jsonb language sql as $$
 select jsonb_build_array((select count(*) from app.sales),(select count(*) from app.sale_lines),
 (select count(*) from app.sale_payments),(select count(*) from app.cash_movements),
 (select count(*) from app.inventory_movements),(select count(*) from audit.audit_events),
 (select count(*) from integration.event_outbox),(select count(*) from app.idempotency_records),
 (select jsonb_agg(to_jsonb(b) order by variant_id) from app.inventory_balances b));
$$;
select lives_ok($$select pg_temp.scope_sale(repeat('b',64),'scope-original-sale')$$,'currently authorized cashier completes normal sale');
select pg_temp.new_scope_session('unaffected-cashier','4d000000-0000-4000-8000-000000000002');
create temporary table scope_before as select pg_temp.scope_truth() truth;
update app.employees set status='suspended' where id='4d000000-0000-4000-8000-000000000001';
select ok((select revoked_at is not null from app.pos_employee_sessions where token_hash=repeat('b',64)),'suspension atomically invalidates the existing token');
select ok((select revoked_at is null from app.pos_employee_sessions where token_hash=repeat(md5('unaffected-cashier'),2)),'unrelated active cashier token remains valid');
select throws_ok($$select pg_temp.scope_sale(repeat('b',64),'scope-original-sale')$$,'HCS90','POS session is invalid or expired','suspended cashier cannot replay a completed sale');
select throws_ok($$select pg_temp.scope_sale(repeat('b',64),'scope-new-after-suspend')$$,'HCS90','POS session is invalid or expired','suspended cashier cannot create a new sale');
select throws_ok($$select app.load_pos_sales_context(repeat('b',64))$$,'HCS90','POS session is invalid or expired','suspended context fails closed');
select throws_ok($$select app.load_pos_pricing_options(repeat('b',64))$$,'HCS90','POS session is invalid or expired','suspended pricing read fails closed');
select throws_ok($$select app.open_pos_register_session(repeat('b',64),0,'scope-new-register','scope-hash','scope-request')$$,'HCS90','POS session is invalid or expired','suspended register open fails closed');
select throws_ok($$select pg_temp.new_scope_session('invalid-new-credential')$$,'HCS90','POS session is invalid or expired','cannot issue a fresh session for a suspended cashier');
update app.employees set status='active' where id='4d000000-0000-4000-8000-000000000001';
select ok((select revoked_at is not null from app.pos_employee_sessions where token_hash=repeat('b',64)),'restoring employee does not revive old credentials');
select pg_temp.new_scope_session('assignment-delete');
delete from app.employee_locations where employee_id='4d000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.scope_sale(repeat(md5('assignment-delete'),2),'scope-unassigned-sale')$$,'HCS90','POS session is invalid or expired','deleted branch assignment prevents sale');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
 ('2d000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000001');
select pg_temp.new_scope_session('assignment-update');
update app.employee_locations set location_id='3d000000-0000-4000-8000-000000000002' where employee_id='4d000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.scope_sale(repeat(md5('assignment-update'),2),'scope-reassigned-sale')$$,'HCS90','POS session is invalid or expired','reassigned cashier cannot keep operating old branch');
update app.employee_locations set location_id='3d000000-0000-4000-8000-000000000001' where employee_id='4d000000-0000-4000-8000-000000000001';
select pg_temp.new_scope_session('inactive-location');
update app.locations set is_active=false where id='3d000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.scope_sale(repeat(md5('inactive-location'),2),'scope-inactive-location')$$,'HCS90','POS session is invalid or expired','inactive branch invalidates cashier credential');
update app.locations set is_active=true where id='3d000000-0000-4000-8000-000000000001';
select pg_temp.new_scope_session('inactive-register');
update app.registers set status='inactive' where id='5d000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.scope_sale(repeat(md5('inactive-register'),2),'scope-inactive-register')$$,'HCS90','POS session is invalid or expired','inactive register invalidates cashier credential');
update app.registers set status='active' where id='5d000000-0000-4000-8000-000000000001';
select pg_temp.new_scope_session('device-moved');
update app.pos_devices set location_id='3d000000-0000-4000-8000-000000000002' where id='6d000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.scope_sale(repeat(md5('device-moved'),2),'scope-moved-device')$$,'HCS90','POS session is invalid or expired','mismatched device/location binding invalidates cashier credential');
update app.pos_devices set location_id='3d000000-0000-4000-8000-000000000001' where id='6d000000-0000-4000-8000-000000000001';
select pg_temp.new_scope_session('device-revoked');
update app.pos_devices set status='revoked' where id='6d000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.scope_sale(repeat(md5('device-revoked'),2),'scope-revoked-device')$$,'HCS90','POS session is invalid or expired','revoked device fails closed');
update app.pos_devices set status='active' where id='6d000000-0000-4000-8000-000000000001';
select pg_temp.new_scope_session('tenant-suspended');
insert into app.employee_pos_credentials(tenant_id,employee_id,pin_hash) values
 ('2d000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000001',extensions.crypt('1234',extensions.gen_salt('bf',4)));
update app.tenants set status='suspended' where id='2d000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.scope_sale(repeat(md5('tenant-suspended'),2),'scope-suspended-tenant')$$,'HCS90','POS session is invalid or expired','suspended tenant cannot complete POS sale');
select throws_ok($$select pg_temp.new_scope_session('invalid-tenant-session')$$,'HCS90','POS session is invalid or expired','cannot create a new session for suspended tenant');
select is(app.authenticate_pos_employee(repeat('a',64),'CASH-1','1234',repeat('e',64),'scope-login-denied')->>'status','invalid','normal PIN login returns opaque invalid status for suspended tenant');
update app.tenants set status='active' where id='2d000000-0000-4000-8000-000000000001';
select is(pg_temp.scope_truth(),(select truth from scope_before),'all revocations and denials preserve stock, money, audit, outbox and idempotency truth');
select is((select on_hand from app.inventory_balances),99.000::numeric,'only original authorized sale deducted one unit');
select ok(not has_function_privilege(role_name,signature,'execute'),role_name||' cannot directly execute scope helper')
 from (values ('anon'),('authenticated'),('hcs_hyperdrive')) roles(role_name)
 cross join (values ('app.pos_session_scope_is_active(app.pos_employee_sessions)'),('app.guard_pos_session_scope()'),('app.invalidate_out_of_scope_pos_sessions()'),('app.authenticate_pos_employee_scope_core(text,text,text,text,text)')) functions(signature);
select * from finish();
rollback;
