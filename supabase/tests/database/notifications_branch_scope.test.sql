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

insert into app.role_permissions(tenant_id,role_id,permission_code)
select 'e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',code from app.permissions where code in ('approvals.manage','notifications.read');
insert into app.products(id,tenant_id,name,created_by) values
('ee200000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Notification item','e1000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,created_by) values
('ee300000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000001','Each','NOTIFY-SCOPE',100,'e1000000-0000-4000-8000-000000000001');
insert into app.risk_alerts(id,tenant_id,location_id,category,severity,title,message,dedup_key) values
('ee400000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','system','warning','Assigned','Assigned','notif-assigned'),
('ee400000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000002','system','warning','Hidden','DO-NOT-DISCLOSE','notif-hidden'),
('ee400000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001',null,'system','critical','Global','DO-NOT-DISCLOSE','notif-global');
insert into app.approval_requests(id,tenant_id,subject_type,location_id,variant_id,requested_quantity,reason,requested_by) values
('ee500000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','inventory_adjustment','e4000000-0000-4000-8000-000000000001','ee300000-0000-4000-8000-000000000001',1,'Assigned request','e1000000-0000-4000-8000-000000000001'),
('ee500000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','inventory_adjustment','e4000000-0000-4000-8000-000000000002','ee300000-0000-4000-8000-000000000001',1,'Hidden request','e1000000-0000-4000-8000-000000000001');
create function pg_temp.inbox(p_unread boolean default false,p_limit integer default 50,p_offset integer default 0) returns jsonb language sql as $$
 select app.load_notification_center('e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001',p_unread,p_limit,p_offset);
$$;
create function pg_temp.read_one(p_id uuid) returns jsonb language sql as $$
 select app.update_notification_read_state('e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001',p_id,true);
$$;
select is((pg_temp.inbox()->>'total')::integer,2,'fan-out sends assigned alert and pending approval only');
select is((select count(*) from app.notifications where recipient_user_id='e1000000-0000-4000-8000-000000000002' and location_id is distinct from 'e4000000-0000-4000-8000-000000000001'::uuid),0::bigint,'fan-out creates no other-branch or global copy for reader');
select is((app.load_notification_center('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',false,50,0)->>'total')::integer,5,'owner receives all branch and global alerts plus approvals');
create temporary table permitted as select id from app.notifications where recipient_user_id='e1000000-0000-4000-8000-000000000002' order by id limit 1;
insert into app.notifications(id,tenant_id,recipient_user_id,category,severity,title,message,location_id,href,group_key,dedup_key) values
('ee600000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','alert','warning','Legacy hidden','DO-NOT-DISCLOSE','e4000000-0000-4000-8000-000000000002','/alerts','legacy','legacy-hidden'),
('ee600000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','system','warning','Legacy global','DO-NOT-DISCLOSE',null,'/alerts','legacy','legacy-global');
select is((pg_temp.inbox()->>'unreadCount')::integer,2,'legacy wrong-branch rows excluded from unread count');
select is((pg_temp.inbox()->>'total')::integer,2,'legacy wrong-branch rows excluded from total');
select ok(pg_temp.inbox()::text not like '%DO-NOT-DISCLOSE%','legacy metadata not returned');
select is(jsonb_array_length(pg_temp.inbox(false,1,0)->'items'),1,'pagination returns only visible rows');
select is((pg_temp.inbox(false,1,0)->>'hasMore')::boolean,true,'hasMore counts visible rows only');
select is((pg_temp.inbox(false,1,1)->>'hasMore')::boolean,false,'last visible page has no more');
select throws_ok($$select pg_temp.read_one('ee600000-0000-4000-8000-000000000001')$$,'HCSN2','Notification was not found','legacy inaccessible notification cannot be marked read');
select is((app.mark_all_notifications_read('e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001')->>'markedCount')::integer,2,'bulk read changes visible rows only');
select is((select count(*) from app.notifications where id in ('ee600000-0000-4000-8000-000000000001','ee600000-0000-4000-8000-000000000002') and read_at is null),2::bigint,'hidden history remains untouched not deleted');
select is((pg_temp.inbox(true)->>'total')::integer,0,'visible unread filter is empty');
select lives_ok($$select pg_temp.read_one((select id from permitted))$$,'visible individual read accepted');
delete from app.employee_locations where employee_id='e5000000-0000-4000-8000-000000000001';
select is((pg_temp.inbox()->>'total')::integer,0,'reassignment hides formerly visible inbox history');
select throws_ok($$select pg_temp.read_one((select id from permitted))$$,'HCSN2','Notification was not found','reassignment denies individual read mutation');
select is((app.mark_all_notifications_read('e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001')->>'markedCount')::integer,0,'no assignments means no bulk mutation');
select throws_ok($$select app.load_notification_center('e1000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001',false,50,0)$$,'HCSN0','Notification access is not allowed','foreign membership denied');
select throws_ok($$update app.notifications set message='rewrite' where id='ee600000-0000-4000-8000-000000000001'$$,'P0001','notification history fields are immutable','notification content remains immutable');
select ok(not has_function_privilege('hcs_hyperdrive','app.can_read_notification_location(uuid,uuid,uuid)','execute'),'scope helper is private');
select * from finish();
rollback;
