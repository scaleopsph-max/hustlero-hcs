begin;

create extension if not exists pgtap with schema extensions;
select plan(26);

select has_table('app','notifications','notification history exists');
select has_function('app','load_notification_center',array['uuid','uuid','boolean','integer','integer'],'notification projection exists');
select has_function('app','update_notification_read_state',array['uuid','uuid','uuid','boolean'],'notification read command exists');
select has_function('app','mark_all_notifications_read',array['uuid','uuid'],'bulk read command exists');
select ok(has_function_privilege('hcs_hyperdrive','app.load_notification_center(uuid,uuid,boolean,integer,integer)','execute'),'API role can load notifications');
select ok(has_function_privilege('hcs_hyperdrive','app.update_notification_read_state(uuid,uuid,uuid,boolean)','execute'),'API role can update read state');
select ok(has_function_privilege('hcs_hyperdrive','app.mark_all_notifications_read(uuid,uuid)','execute'),'API role can mark all read');
select ok(not has_table_privilege('hcs_hyperdrive','app.notifications','select'),'API role cannot read notifications directly');
select has_index('app','notifications','notifications_recipient_unread_idx','unread inbox has a supporting index');
select has_index('app','notifications','notifications_recipient_history_idx','notification history has a supporting index');

insert into auth.users(id,email,aud,role,email_confirmed_at) values
('1f000000-0000-4000-8000-000000000001','notify-a@example.invalid','authenticated','authenticated',now()),
('1f000000-0000-4000-8000-000000000002','notify-b@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name,timezone) values
('2f000000-0000-4000-8000-000000000001','notify-a','Notify A','Asia/Manila'),
('2f000000-0000-4000-8000-000000000002','notify-b','Notify B','Asia/Manila');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('2f000000-0000-4000-8000-000000000001','1f000000-0000-4000-8000-000000000001','active',true,now()),
('2f000000-0000-4000-8000-000000000002','1f000000-0000-4000-8000-000000000002','active',true,now());
insert into app.locations(id,tenant_id,code,name) values
('3f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','MAIN','Main Store'),
('3f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000002','MAIN','Other Store');
insert into app.product_categories(id,tenant_id,name,created_by) values
('4f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','Shirts','1f000000-0000-4000-8000-000000000001');
insert into app.products(id,tenant_id,name,category_id,created_by) values
('5f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','Black Shirt','4f000000-0000-4000-8000-000000000001','1f000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values
('6f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000001','Small','NOTIFY-S',500,300,'1f000000-0000-4000-8000-000000000001');
insert into app.risk_alerts(id,tenant_id,location_id,category,severity,title,message,entity_type,entity_id,dedup_key) values
('7f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','3f000000-0000-4000-8000-000000000001','inventory','warning','Stock needs attention','Black Shirt / Small needs attention.','product_variant','6f000000-0000-4000-8000-000000000001','test:stock');
insert into app.approval_requests(id,tenant_id,subject_type,location_id,variant_id,requested_quantity,reason,requested_by) values
('8f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001','inventory_adjustment','3f000000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000001',5,'Cycle count correction','1f000000-0000-4000-8000-000000000001');

select throws_ok($$select app.load_notification_center('1f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000001',false,50,0)$$,'HCSN0','Notification access is not allowed','cross-tenant notification access is denied');
select is(jsonb_array_length(app.load_notification_center('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',false,50,0)->'items'),2,'alert and pending approval notifications are routed to owner');
select is((app.load_notification_center('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',false,50,0)->>'unreadCount')::integer,2,'unread count is returned');
select is((select count(*)::integer from app.notifications where tenant_id='2f000000-0000-4000-8000-000000000001'),2,'repeated sync deduplicates notifications');
select is((select count(*)::integer from app.notifications where recipient_user_id='1f000000-0000-4000-8000-000000000002'),0,'foreign tenant user receives no notifications');
select is((select in_app_status from app.notifications where tenant_id='2f000000-0000-4000-8000-000000000001' limit 1),'delivered','in-app delivery is explicit');
select is((select email_status from app.notifications where tenant_id='2f000000-0000-4000-8000-000000000001' limit 1),'not_configured','email delivery is not falsely reported');
select is((app.update_notification_read_state('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',(select id from app.notifications where tenant_id='2f000000-0000-4000-8000-000000000001' order by created_at limit 1),true)->>'unreadCount')::integer,1,'reading one notification decrements unread count');
select is((select status from app.risk_alerts where id='7f000000-0000-4000-8000-000000000001'),'open','reading a notification does not resolve its alert');
select is((app.mark_all_notifications_read('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001')->>'markedCount')::integer,1,'bulk command marks the remaining notification');
select is(jsonb_array_length(app.load_notification_center('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',true,50,0)->'items'),0,'unread filter excludes read history');
select is((app.update_notification_read_state('1f000000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-000000000001',(select id from app.notifications where tenant_id='2f000000-0000-4000-8000-000000000001' order by created_at limit 1),false)->>'unreadCount')::integer,1,'notification can be marked unread');
select throws_ok($$select app.update_notification_read_state('1f000000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-000000000002',(select id from app.notifications where tenant_id='2f000000-0000-4000-8000-000000000001' limit 1),true)$$,'HCSN2','Notification was not found','recipient cannot update another tenant notification');
select throws_ok($$delete from app.notifications where tenant_id='2f000000-0000-4000-8000-000000000001'$$,null,'notifications cannot be deleted','notification history rejects deletion');
select throws_ok($$update app.notifications set title='Changed' where tenant_id='2f000000-0000-4000-8000-000000000001'$$,null,'notification history fields are immutable','notification business content is immutable');
insert into app.roles(tenant_id,code,name) values('2f000000-0000-4000-8000-000000000001','manager','Manager');
select is((select count(*)::integer from app.role_permissions rp join app.roles r on r.tenant_id=rp.tenant_id and r.id=rp.role_id where r.tenant_id='2f000000-0000-4000-8000-000000000001' and r.code='manager' and rp.permission_code='notifications.read'),1,'future manager role receives notification permission');

select * from finish();
rollback;
