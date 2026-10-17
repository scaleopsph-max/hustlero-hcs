begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,aud,role) values
('e1000000-0000-4000-8000-000000000001','controls-owner@example.invalid','authenticated','authenticated'),
('e1000000-0000-4000-8000-000000000002','controls-reader@example.invalid','authenticated','authenticated'),
('e1000000-0000-4000-8000-000000000003','controls-foreign@example.invalid','authenticated','authenticated');
insert into app.tenants(id,slug,name,timezone) values
('e2000000-0000-4000-8000-000000000001','controls-scope-a','Controls A','Asia/Manila'),
('e2000000-0000-4000-8000-000000000002','controls-scope-b','Controls B','Asia/Manila');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','active',true,now()),
('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','active',false,now()),
('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','active',true,now());
insert into app.roles(id,tenant_id,code,name) values
('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','SCOPED-CONTROLS','Scoped controls');
insert into app.role_permissions(tenant_id,role_id,permission_code)
select 'e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',code
from app.permissions where code in ('alerts.read','alerts.manage','audit.read');
insert into app.membership_roles(tenant_id,user_id,role_id) values
('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000001');
insert into app.locations(id,tenant_id,code,name) values
('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','ASSIGNED','Assigned'),
('e4000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','OTHER','Other'),
('e4000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000002','FOREIGN','Foreign');
insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values
('e5000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','SCOPE-READER','Scope reader');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
('e2000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001');
insert into app.risk_alerts(id,tenant_id,location_id,category,severity,status,title,message,dedup_key) values
('e6000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','system','warning','open','Visible','Visible','scope-visible'),
('e6000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000002','system','critical','open','Hidden','DO-NOT-DISCLOSE','scope-hidden'),
('e6000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001',null,'system','critical','open','Global','DO-NOT-DISCLOSE','scope-global'),
('e6000000-0000-4000-8000-000000000004','e2000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','system','attention','acknowledged','Seen','Visible','scope-seen'),
('e6000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-000000000003','system','warning','open','Foreign','Foreign','scope-foreign');
insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,location_id,reason,occurred_at) values
('e2000000-0000-4000-8000-000000000001','visible-1','tenant_user','e1000000-0000-4000-8000-000000000002','scope.test','synthetic','e4000000-0000-4000-8000-000000000001','visible-one','2026-10-17 01:00:00+08'),
('e2000000-0000-4000-8000-000000000001','visible-2','tenant_user','e1000000-0000-4000-8000-000000000002','scope.test','synthetic','e4000000-0000-4000-8000-000000000001','visible-two','2026-10-17 02:00:00+08'),
('e2000000-0000-4000-8000-000000000001','hidden-1','tenant_user','e1000000-0000-4000-8000-000000000001','scope.test','synthetic','e4000000-0000-4000-8000-000000000002','DO-NOT-DISCLOSE','2026-10-17 03:00:00+08'),
('e2000000-0000-4000-8000-000000000001','hidden-2','system',null,'scope.test','synthetic','e4000000-0000-4000-8000-000000000002','DO-NOT-DISCLOSE','2026-10-17 04:00:00+08'),
('e2000000-0000-4000-8000-000000000001','hidden-3','system',null,'scope.test','synthetic','e4000000-0000-4000-8000-000000000002','DO-NOT-DISCLOSE','2026-10-17 05:00:00+08'),
('e2000000-0000-4000-8000-000000000001','global','system',null,'scope.test','synthetic',null,'DO-NOT-DISCLOSE','2026-10-17 06:00:00+08'),
('e2000000-0000-4000-8000-000000000002','foreign','system',null,'scope.test','synthetic','e4000000-0000-4000-8000-000000000003','Foreign','2026-10-17 07:00:00+08');

create function pg_temp.actor(p_owner boolean default false) returns uuid language sql as $$
 select case when p_owner then 'e1000000-0000-4000-8000-000000000001'::uuid else 'e1000000-0000-4000-8000-000000000002'::uuid end;
$$;
create function pg_temp.alerts(p_owner boolean default false) returns jsonb language sql as $$
 select app.load_alert_center(pg_temp.actor(p_owner),'e2000000-0000-4000-8000-000000000001');
$$;
create function pg_temp.activity(p_owner boolean default false,p_location uuid default null,p_search text default '',p_limit integer default 1,p_offset integer default 0)
returns jsonb language sql as $$
 select app.load_audit_activity(pg_temp.actor(p_owner),'e2000000-0000-4000-8000-000000000001','2026-10-17','2026-10-17',
 p_location,null,'scope.test',null,p_search,p_limit,p_offset);
$$;
create function pg_temp.update_alert(p_id uuid,p_owner boolean default false,p_status text default 'resolved') returns jsonb language sql as $$
 select app.update_alert_status(pg_temp.actor(p_owner),'e2000000-0000-4000-8000-000000000001',p_id,p_status,'synthetic','scope-status');
$$;
create function pg_temp.effects() returns jsonb language sql as $$
 select jsonb_build_object('alerts',(select jsonb_agg(to_jsonb(a) order by id) from app.risk_alerts a),
 'audits',(select count(*) from audit.audit_events),'outbox',(select count(*) from integration.event_outbox),
 'keys',(select count(*) from app.idempotency_records),'stock',(select count(*) from app.inventory_movements),
 'cash',(select count(*) from app.cash_movements));
$$;

select is(jsonb_array_length(pg_temp.alerts()->'alerts'),2,'only assigned alerts returned');
select is((pg_temp.alerts()->'counts'->>'open')::integer,1,'open count excludes hidden and global alerts');
select is((pg_temp.alerts()->'counts'->>'acknowledged')::integer,1,'acknowledged count is branch scoped');
select is((pg_temp.alerts()->'counts'->>'resolved')::integer,0,'resolved count is branch scoped');
select ok(pg_temp.alerts()::text not like '%DO-NOT-DISCLOSE%','other-branch and null-location metadata not returned');
select is(jsonb_array_length(pg_temp.alerts(true)->'alerts'),4,'owner sees tenant history including global alerts');
select is((pg_temp.alerts(true)->'counts'->>'open')::integer,3,'owner counts retained');
select is((pg_temp.activity()->>'total')::integer,2,'audit total is scoped before pagination');
select is(pg_temp.activity()->'items'->0->>'requestId','visible-2','newer forbidden rows do not hide permitted first page');
select is((pg_temp.activity()->>'hasMore')::boolean,true,'hasMore derives from scoped total');
select is(pg_temp.activity(false,null,'',1,1)->'items'->0->>'requestId','visible-1','offset applies to scoped rows');
select is((pg_temp.activity(false,null,'',1,1)->>'hasMore')::boolean,false,'last scoped page has no more rows');
select is(jsonb_array_length(pg_temp.activity(false,null,'',1,2)->'items'),0,'offset after scoped end is empty');
select is(jsonb_array_length(pg_temp.activity()->'locations'),1,'audit location choices are branch scoped');
select is((pg_temp.activity(false,null,'DO-NOT-DISCLOSE')->>'total')::integer,0,'search cannot infer hidden event metadata');
select is((pg_temp.activity(false,null,'visible-two')->>'total')::integer,1,'search still finds assigned event');
select is((pg_temp.activity(true)->>'total')::integer,6,'owner includes global audit history but not foreign tenant');
select throws_ok($$select pg_temp.activity(false,'e4000000-0000-4000-8000-000000000002')$$,'HCSE2','Audit location was not found','unassigned explicit location denied');
select throws_ok($$select pg_temp.activity(false,'e4000000-0000-4000-8000-000000000003')$$,'HCSE2','Audit location was not found','foreign explicit location has same denial');

create temporary table baseline as select pg_temp.effects() value;
select throws_ok($$select pg_temp.update_alert('e6000000-0000-4000-8000-000000000002')$$,'HCSE2','Alert was not found','other-branch alert mutation denied');
select throws_ok($$select pg_temp.update_alert('e6000000-0000-4000-8000-000000000003')$$,'HCSE2','Alert was not found','global alert mutation is not implicit branch access');
select throws_ok($$select pg_temp.update_alert('e6000000-0000-4000-8000-000000000005')$$,'HCSE2','Alert was not found','foreign alert mutation denied uniformly');
select is(pg_temp.effects(),(select value from baseline),'denials do not mutate alerts, audit or business ledgers');
select lives_ok($$select pg_temp.update_alert('e6000000-0000-4000-8000-000000000001')$$,'assigned update accepted');
select is((select count(*) from audit.audit_events where action='alert.resolved'),1::bigint,'authorized update emits one audit event');
update baseline set value=pg_temp.effects();
select lives_ok($$select pg_temp.update_alert('e6000000-0000-4000-8000-000000000001')$$,'same-status retry accepted');
select is(pg_temp.effects(),(select value from baseline),'same-status retry does not duplicate effects');
delete from app.employee_locations where employee_id='e5000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.update_alert('e6000000-0000-4000-8000-000000000001')$$,'HCSE2','Alert was not found','removed assignment denies same-status retry');
select is((pg_temp.alerts()->'counts'->>'open')::integer,0,'removed assignment clears scoped alert counts');
select is((pg_temp.activity()->>'total')::integer,0,'removed assignment clears audit total');
select is(pg_temp.effects(),(select value from baseline),'scope loss does not mutate business truth');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
('e2000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001'),
('e2000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000002');
select is((pg_temp.activity()->>'total')::integer,5,'multiple assignments include branch events but never global events');
update app.employees set status='suspended' where id='e5000000-0000-4000-8000-000000000001';
select is(jsonb_array_length(pg_temp.alerts()->'alerts'),0,'inactive employee loses alert rows');
select is((pg_temp.activity()->>'total')::integer,0,'inactive employee loses audit rows');
update app.employees set status='active' where id='e5000000-0000-4000-8000-000000000001';
update app.locations set is_active=false where id='e4000000-0000-4000-8000-000000000001';
select is((pg_temp.activity()->>'total')::integer,3,'inactive assigned branch excluded');
select throws_ok($$select pg_temp.update_alert('e6000000-0000-4000-8000-000000000001')$$,'HCSE2','Alert was not found','inactive branch denies completed status retry');
select is((pg_temp.activity(true,'e4000000-0000-4000-8000-000000000001')->>'total')::integer,2,'owner can read inactive historical branch');
select lives_ok($$select pg_temp.update_alert('e6000000-0000-4000-8000-000000000003',true)$$,'owner can manage global alert');
select throws_ok($$select app.load_alert_center('e1000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001')$$,'HCSE0','Alert access is not allowed','foreign membership denied');
update app.tenant_memberships set status='suspended' where user_id='e1000000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.alerts()$$,'HCSE0','Alert access is not allowed','suspended membership denied');
select throws_ok($$select pg_temp.activity()$$,'HCSE0','Audit access is not allowed','suspended audit reader denied');
update app.tenant_memberships set status='active' where user_id='e1000000-0000-4000-8000-000000000002';
delete from app.role_permissions where role_id='e3000000-0000-4000-8000-000000000001' and permission_code='alerts.manage';
select throws_ok($$select pg_temp.update_alert('e6000000-0000-4000-8000-000000000002')$$,'HCSE0','Alert management is not allowed','read permission cannot mutate');
select is((pg_temp.alerts()->>'canManage')::boolean,false,'read-only context disables management');
delete from app.role_permissions where role_id='e3000000-0000-4000-8000-000000000001' and permission_code='audit.read';
select throws_ok($$select pg_temp.activity()$$,'HCSE0','Audit access is not allowed','removed audit capability denies read');
select ok(not has_function_privilege('authenticated','app.load_alert_center(uuid,uuid)','execute'),'browser alert read denied');
select ok(not has_function_privilege('authenticated','app.update_alert_status(uuid,uuid,uuid,text,text,text)','execute'),'browser alert write denied');
select ok(not has_function_privilege('authenticated','app.load_audit_activity(uuid,uuid,date,date,uuid,text,text,text,text,integer,integer)','execute'),'browser audit read denied');
select ok(has_function_privilege('hcs_hyperdrive','app.load_audit_activity(uuid,uuid,date,date,uuid,text,text,text,text,integer,integer)','execute'),'scoped API audit entry retained');
select * from finish();
rollback;
