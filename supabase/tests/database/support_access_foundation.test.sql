begin;

create extension if not exists pgtap with schema extensions;
select plan(41);

select has_table('platform','support_access_grants','support access ledger exists');
select has_function('platform','load_support_access',array['uuid'],'support history projection exists');
select has_function('platform','create_support_access',array['uuid','uuid','text','text','integer','text','text','text'],'support grant command exists');
select has_function('platform','revoke_support_access',array['uuid','uuid','text','text','text','text'],'support revoke command exists');
select has_function('platform','load_support_overview',array['uuid','uuid','text'],'support overview projection exists');
select ok(has_function_privilege('hcs_hyperdrive','platform.load_support_access(uuid)','execute'),'API role can load support history');
select ok(has_function_privilege('hcs_hyperdrive','platform.create_support_access(uuid,uuid,text,text,integer,text,text,text)','execute'),'API role can create support access');
select ok(has_function_privilege('hcs_hyperdrive','platform.revoke_support_access(uuid,uuid,text,text,text,text)','execute'),'API role can revoke support access');
select ok(has_function_privilege('hcs_hyperdrive','platform.load_support_overview(uuid,uuid,text)','execute'),'API role can load support overview');
select ok(not has_table_privilege('hcs_hyperdrive','platform.support_access_grants','select'),'API role cannot read support grants directly');
select ok(not has_table_privilege('hcs_hyperdrive','platform.support_access_grants','delete'),'API role cannot delete support grants');
select ok((select relrowsecurity from pg_class where oid='platform.support_access_grants'::regclass),'support grants have RLS');
select has_index('platform','support_access_grants','platform_support_access_actor_history_idx','actor history has an index');
select has_index('platform','support_access_grants','platform_support_access_tenant_history_idx','tenant history has an index');
select has_index('platform','support_access_grants','platform_support_access_expiry_idx','active expiry has an index');
select has_index('platform','support_access_grants','platform_support_access_granted_by_idx','granting actor has a supporting index');
select has_index('platform','support_access_grants','platform_support_access_revoked_by_idx','revoking actor has a supporting index');

insert into auth.users(id,email,aud,role,email_confirmed_at) values
('1b000000-0000-4000-8000-000000000001','support-super@example.invalid','authenticated','authenticated',now()),
('1b000000-0000-4000-8000-000000000002','support-ops@example.invalid','authenticated','authenticated',now()),
('1b000000-0000-4000-8000-000000000003','support-agent@example.invalid','authenticated','authenticated',now()),
('1b000000-0000-4000-8000-000000000004','support-outsider@example.invalid','authenticated','authenticated',now());
insert into platform.admins(user_id,display_name,role) values
('1b000000-0000-4000-8000-000000000001','Support Super','super_admin'),
('1b000000-0000-4000-8000-000000000002','Support Ops','operations'),
('1b000000-0000-4000-8000-000000000003','Support Agent','support');
insert into app.tenants(id,slug,name) values
('2b000000-0000-4000-8000-000000000001','support-test','Support Test Store'),
('2b000000-0000-4000-8000-000000000002','support-ops-test','Support Operations Store');
insert into app.locations(id,tenant_id,code,name,kind) values
('3b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','MAIN','Main Store','store');

select throws_ok(
  $$select platform.create_support_access('1b000000-0000-4000-8000-000000000003','2b000000-0000-4000-8000-000000000001','SUP-1','Investigate totals',30,'support-role-denied-001','hash-a','request-a')$$,
  'HCSP0','Support access creation is not allowed','support role cannot self-grant access'
);
select throws_ok(
  $$select platform.create_support_access('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','SUP-2','Investigate totals',5,'duration-invalid-001','hash-b','request-b')$$,
  'HCSP1','Support access request is invalid','duration below the minimum is rejected'
);
select is(
  platform.create_support_access('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','SUP-1042','Investigate inventory totals',30,'support-create-001','hash-create','request-create')->>'accessLevel',
  'read_only','support access is read-only'
);
select is((select scope from platform.support_access_grants where ticket_reference='SUP-1042'),array['tenant_overview']::text[],'support scope is overview only');
select is((select admin_user_id from platform.support_access_grants where ticket_reference='SUP-1042'),'1b000000-0000-4000-8000-000000000001'::uuid,'grant belongs to the requesting operator');
select is((select count(*)::integer from audit.audit_events where action='platform.support_access.granted' and tenant_id='2b000000-0000-4000-8000-000000000001'),1,'grant is audited once');
select lives_ok(
  $$select platform.create_support_access('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','SUP-1042','Investigate inventory totals',30,'support-create-001','hash-create','request-create')$$,
  'identical grant retry succeeds'
);
select is((select count(*)::integer from audit.audit_events where action='platform.support_access.granted' and tenant_id='2b000000-0000-4000-8000-000000000001'),1,'grant retry does not duplicate audit history');
select throws_ok(
  $$select platform.create_support_access('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','SUP-1043','Different request',45,'support-create-001','hash-different','request-conflict')$$,
  'HCS08','Idempotency key was reused with a different support access request','grant key conflict is rejected'
);
select throws_ok(
  $$select platform.create_support_access('1b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','SUP-1044','Parallel investigation',15,'support-create-002','hash-overlap','request-overlap')$$,
  'HCSP3','An active support access grant already exists','overlapping active grant is rejected'
);
select is((platform.load_support_access('1b000000-0000-4000-8000-000000000001')->>'canGrant')::boolean,true,'super admin can issue access');
select is(jsonb_array_length(platform.load_support_access('1b000000-0000-4000-8000-000000000001')->'grants'),1,'operator sees own grant history');
select is((platform.load_support_overview('1b000000-0000-4000-8000-000000000001',(select id from platform.support_access_grants where ticket_reference='SUP-1042'),'view-001')->'tenant'->>'name'),'Support Test Store','active grant reveals tenant summary');
select is((platform.load_support_overview('1b000000-0000-4000-8000-000000000001',(select id from platform.support_access_grants where ticket_reference='SUP-1042'),'view-002')->'metrics'->>'locationCount')::integer,1,'overview returns aggregate location count');
select ok(not (platform.load_support_overview('1b000000-0000-4000-8000-000000000001',(select id from platform.support_access_grants where ticket_reference='SUP-1042'),'view-003') ? 'customers'),'overview excludes customer records');
select is((select count(*)::integer from audit.audit_events where action='platform.support_access.viewed' and tenant_id='2b000000-0000-4000-8000-000000000001'),3,'every overview view is audited');
select throws_ok(
  $$select platform.load_support_overview('1b000000-0000-4000-8000-000000000002',(select id from platform.support_access_grants where ticket_reference='SUP-1042'),'view-outsider')$$,
  'HCSP2','Support access grant was not found','another operator cannot use the grant'
);
select ok((platform.revoke_support_access('1b000000-0000-4000-8000-000000000001',(select id from platform.support_access_grants where ticket_reference='SUP-1042'),'Investigation completed','support-revoke-001','hash-revoke','request-revoke')->>'revokedAt') is not null,'operator can revoke own grant');
select is((select count(*)::integer from audit.audit_events where action='platform.support_access.revoked' and tenant_id='2b000000-0000-4000-8000-000000000001'),1,'revocation is audited');
select throws_ok(
  $$select platform.load_support_overview('1b000000-0000-4000-8000-000000000001',(select id from platform.support_access_grants where ticket_reference='SUP-1042'),'view-after-revoke')$$,
  'HCSP4','Support access grant is not active','revoked grant cannot open tenant summary'
);
select is((select count(*)::integer from platform.support_access_grants where ticket_reference='SUP-1042'),1,'revocation preserves grant history');

insert into platform.support_access_grants(tenant_id,admin_user_id,granted_by,ticket_reference,reason,starts_at,expires_at)
values('2b000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-000000000001','SUP-EXPIRED','Historical investigation',now()-interval '2 hours',now()-interval '1 hour');
select throws_ok(
  $$select platform.load_support_overview('1b000000-0000-4000-8000-000000000001',(select id from platform.support_access_grants where ticket_reference='SUP-EXPIRED'),'view-expired')$$,
  'HCSP4','Support access grant is not active','expired grant cannot open tenant summary'
);
select throws_ok(
  $$delete from platform.support_access_grants where ticket_reference='SUP-EXPIRED'$$,
  'P0001','support access grants cannot be deleted','grant history is deletion protected'
);
select is(
  platform.create_support_access('1b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000002','OPS-100','Operational support review',15,'ops-create-001','hash-ops','request-ops')->>'adminUserId',
  '1b000000-0000-4000-8000-000000000002','operations can issue self access'
);

select * from finish();
rollback;
