begin;

create extension if not exists pgtap with schema extensions;
select plan(38);

select has_schema('platform','private platform schema exists');
select has_table('platform','admins','platform admin allowlist exists');
select has_table('platform','operation_requests','platform idempotency ledger exists');
select has_function('platform','load_context',array['uuid'],'platform context projection exists');
select has_function('platform','update_tenant_entitlement',array['uuid','uuid','text','boolean','timestamp with time zone','text','text','text','text'],'entitlement command exists');
select has_function('platform','update_tenant_status',array['uuid','uuid','text','text','text','text','text'],'tenant status command exists');
select ok(has_function_privilege('hcs_hyperdrive','platform.load_context(uuid)','execute'),'API role can load platform context');
select ok(has_function_privilege('hcs_hyperdrive','platform.update_tenant_entitlement(uuid,uuid,text,boolean,timestamp with time zone,text,text,text,text)','execute'),'API role can update entitlements');
select ok(has_function_privilege('hcs_hyperdrive','platform.update_tenant_status(uuid,uuid,text,text,text,text,text)','execute'),'API role can update tenant status');
select ok(not has_table_privilege('hcs_hyperdrive','platform.admins','select'),'API role cannot read admin allowlist directly');
select ok(not has_table_privilege('hcs_hyperdrive','platform.operation_requests','select'),'API role cannot read platform ledger directly');
select ok((select relrowsecurity from pg_class where oid='platform.admins'::regclass),'admin allowlist has RLS');
select ok((select relrowsecurity from pg_class where oid='platform.operation_requests'::regclass),'platform ledger has RLS');
select has_index('platform','admins','platform_admins_role_status_idx','admin lookups have an index');
select has_index('platform','operation_requests','platform_operation_requests_expiry_idx','ledger expiry has an index');

insert into auth.users(id,email,aud,role,email_confirmed_at) values
('1a000000-0000-4000-8000-000000000001','platform-super@example.invalid','authenticated','authenticated',now()),
('1a000000-0000-4000-8000-000000000002','platform-ops@example.invalid','authenticated','authenticated',now()),
('1a000000-0000-4000-8000-000000000003','platform-support@example.invalid','authenticated','authenticated',now()),
('1a000000-0000-4000-8000-000000000004','platform-outsider@example.invalid','authenticated','authenticated',now()),
('1a000000-0000-4000-8000-000000000005','platform-owner@example.invalid','authenticated','authenticated',now());
insert into platform.admins(user_id,display_name,role) values
('1a000000-0000-4000-8000-000000000001','Platform Super','super_admin'),
('1a000000-0000-4000-8000-000000000002','Platform Ops','operations'),
('1a000000-0000-4000-8000-000000000003','Platform Support','support');
insert into app.tenants(id,slug,name) values
('2a000000-0000-4000-8000-000000000001','platform-test','Platform Test Store');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('2a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000005','active',true,now());
insert into app.product_categories(id,tenant_id,name,created_by) values
('3a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Shirts','1a000000-0000-4000-8000-000000000005');
insert into app.products(id,tenant_id,name,category_id,created_by) values
('4a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Preserved Shirt','3a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000005');
update app.tenant_entitlements set entitled=true,enabled=true where tenant_id='2a000000-0000-4000-8000-000000000001' and feature_code='inventory';

select is((platform.load_context('1a000000-0000-4000-8000-000000000001')->'admin'->>'role'),'super_admin','super admin context is loaded');
select is((platform.load_context('1a000000-0000-4000-8000-000000000001')->'admin'->>'canManage')::boolean,true,'super admin can manage');
select is((platform.load_context('1a000000-0000-4000-8000-000000000003')->'admin'->>'canManage')::boolean,false,'support role is read-only');
select is(jsonb_array_length(platform.load_context('1a000000-0000-4000-8000-000000000001')->'tenants'),1,'real tenant directory is returned');
select throws_ok($$select platform.load_context('1a000000-0000-4000-8000-000000000004')$$,'HCSP0','Platform access is not allowed','non-admin is denied');
select throws_ok($$select platform.update_tenant_entitlement('1a000000-0000-4000-8000-000000000003','2a000000-0000-4000-8000-000000000001','inventory',false,null,'Support cannot change access','support-denied-001','hash-a','request-support')$$,'HCSP0','Platform entitlement management is not allowed','support cannot change entitlements');

select is((platform.update_tenant_entitlement('1a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000001','inventory',false,null,'Subscription ended','entitlement-revoke-001','hash-revoke','request-revoke')->>'entitled')::boolean,false,'operations can revoke an entitlement');
select is((select enabled from app.tenant_entitlements where tenant_id='2a000000-0000-4000-8000-000000000001' and feature_code='inventory'),false,'revocation disables the tenant module');
select is((select count(*)::integer from app.products where id='4a000000-0000-4000-8000-000000000001'),1,'revocation preserves tenant product data');
select is((select count(*)::integer from audit.audit_events where action='platform.entitlement.revoked' and tenant_id='2a000000-0000-4000-8000-000000000001'),1,'revocation is audited once');
select lives_ok($$select platform.update_tenant_entitlement('1a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000001','inventory',false,null,'Subscription ended','entitlement-revoke-001','hash-revoke','request-revoke')$$,'identical entitlement retry succeeds');
select is((select count(*)::integer from audit.audit_events where action='platform.entitlement.revoked' and tenant_id='2a000000-0000-4000-8000-000000000001'),1,'retry does not duplicate entitlement audit history');
select throws_ok($$select platform.update_tenant_entitlement('1a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000001','inventory',true,null,'Different request','entitlement-revoke-001','hash-different','request-conflict')$$,'HCS08','Idempotency key was reused with a different platform entitlement request','entitlement key conflict is rejected');
select is((platform.update_tenant_entitlement('1a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000001','inventory',true,now()+interval '30 days','Subscription renewed','entitlement-grant-001','hash-grant','request-grant')->>'entitled')::boolean,true,'operations can grant an entitlement');
select ok((select ends_at is not null from app.tenant_entitlements where tenant_id='2a000000-0000-4000-8000-000000000001' and feature_code='inventory'),'grant expiry is stored');
select is((select actor_type from audit.audit_events where action='platform.entitlement.granted' and tenant_id='2a000000-0000-4000-8000-000000000001'),'platform_admin','entitlement audit identifies platform actor domain');

select is((platform.update_tenant_status('1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','suspended','Owner requested suspension','tenant-suspend-001','hash-suspend','request-suspend')->>'status'),'suspended','super admin can suspend a tenant');
select is((select status from app.tenants where id='2a000000-0000-4000-8000-000000000001'),'suspended','suspended status is persisted');
select is((select count(*)::integer from app.products where id='4a000000-0000-4000-8000-000000000001'),1,'suspension preserves business data');
select throws_ok($$select platform.update_tenant_status('1a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000001','active','Operations attempted reactivation','tenant-ops-status-001','hash-ops','request-ops')$$,'HCSP0','Platform tenant status management is not allowed','operations role cannot change tenant status');
select is((platform.update_tenant_status('1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','active','Owner requested reactivation','tenant-reactivate-001','hash-reactivate','request-reactivate')->>'status'),'active','super admin can reactivate a tenant');
select is((select count(*)::integer from audit.audit_events where tenant_id='2a000000-0000-4000-8000-000000000001' and action in ('platform.tenant.suspended','platform.tenant.active')),2,'tenant status transitions are audited');
select is((select count(*)::integer from platform.operation_requests where actor_user_id in ('1a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000002')),4,'successful platform commands retain idempotency records');

select * from finish();
rollback;
