begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

select has_function('app','load_alert_center',array['uuid','uuid'],'alert center projection exists');
select has_function('app','update_alert_status',array['uuid','uuid','uuid','text','text','text'],'alert lifecycle command exists');
select has_function('app','load_audit_activity',array['uuid','uuid','date','date','uuid','text','text','text','text','integer','integer'],'audit activity projection exists');
select ok(has_function_privilege('hcs_hyperdrive','app.load_alert_center(uuid,uuid)','execute'),'API login can load alerts');
select ok(has_function_privilege('hcs_hyperdrive','app.update_alert_status(uuid,uuid,uuid,text,text,text)','execute'),'API login can update alerts');
select ok(has_function_privilege('hcs_hyperdrive','app.load_audit_activity(uuid,uuid,date,date,uuid,text,text,text,text,integer,integer)','execute'),'API login can load audit');
select ok(not has_table_privilege('hcs_hyperdrive','app.risk_alerts','select'),'API login cannot read alert table directly');

insert into auth.users(id,email,aud,role,email_confirmed_at) values
('1e000000-0000-4000-8000-000000000001','controls-a@example.invalid','authenticated','authenticated',now()),
('1e000000-0000-4000-8000-000000000002','controls-b@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name,timezone) values
('2e000000-0000-4000-8000-000000000001','controls-a','Controls A','Asia/Manila'),
('2e000000-0000-4000-8000-000000000002','controls-b','Controls B','Asia/Manila');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('2e000000-0000-4000-8000-000000000001','1e000000-0000-4000-8000-000000000001','active',true,now()),
('2e000000-0000-4000-8000-000000000002','1e000000-0000-4000-8000-000000000002','active',true,now());
insert into app.locations(id,tenant_id,code,name) values
('3e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001','MAIN','Main Store'),
('3e000000-0000-4000-8000-000000000002','2e000000-0000-4000-8000-000000000002','MAIN','Other Store');
insert into app.employees(id,tenant_id,employee_code,display_name) values
('4e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001','CASH-1','Cashier One');
insert into app.registers(id,tenant_id,location_id,name,code) values
('5e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001','3e000000-0000-4000-8000-000000000001','Main Register','REG-1');
insert into app.register_sessions(id,tenant_id,register_id,location_id,employee_id,status,opening_cash,expected_cash,counted_cash,variance,opened_at,closed_at) values
('6e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001','5e000000-0000-4000-8000-000000000001','3e000000-0000-4000-8000-000000000001','4e000000-0000-4000-8000-000000000001','closed',1000,1500,1490,-10,'2026-09-25 00:00:00+00','2026-09-25 08:00:00+00');
insert into app.product_categories(id,tenant_id,name,created_by) values
('7e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001','Shirts','1e000000-0000-4000-8000-000000000001');
insert into app.products(id,tenant_id,name,category_id,created_by) values
('8e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001','Black Shirt','7e000000-0000-4000-8000-000000000001','1e000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values
('9e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001','8e000000-0000-4000-8000-000000000001','Small','CTRL-SHIRT',500,300,'1e000000-0000-4000-8000-000000000001');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost) values
('2e000000-0000-4000-8000-000000000001','3e000000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000001',0,300);

select throws_ok($$select app.load_alert_center('1e000000-0000-4000-8000-000000000002','2e000000-0000-4000-8000-000000000001')$$,'HCSE0','Alert access is not allowed','cross-tenant alert access is denied');
select is(jsonb_array_length(app.load_alert_center('1e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001')->'alerts'),2,'objective rules create two alerts');
select is((app.load_alert_center('1e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001')->'counts'->>'open')::integer,2,'open count is reconciled');
select is((select count(*)::integer from app.risk_alerts where tenant_id='2e000000-0000-4000-8000-000000000001' and category='inventory'),1,'out-of-stock alert is materialized once');
select is((select count(*)::integer from app.risk_alerts where tenant_id='2e000000-0000-4000-8000-000000000001' and category='cash_register'),1,'register variance alert is materialized once');
select is((select severity from app.risk_alerts where tenant_id='2e000000-0000-4000-8000-000000000001' and category='inventory'),'warning','out-of-stock severity is warning');
select is((app.update_alert_status('1e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001',(select id from app.risk_alerts where tenant_id='2e000000-0000-4000-8000-000000000001' and category='inventory'),'acknowledged','Checking the shelf','alert-test-1')->>'status'),'acknowledged','owner can acknowledge alert');
select is((select status from app.risk_alerts where tenant_id='2e000000-0000-4000-8000-000000000001' and category='inventory'),'acknowledged','acknowledgement persists');
select is((select count(*)::integer from audit.audit_events where tenant_id='2e000000-0000-4000-8000-000000000001' and action='alert.acknowledged'),1,'alert transition is audited');
select lives_ok($$select app.update_alert_status('1e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001',(select id from app.risk_alerts where tenant_id='2e000000-0000-4000-8000-000000000001' and category='inventory'),'acknowledged','Repeated request','alert-test-2')$$,'same-state retry succeeds');
select is((select count(*)::integer from audit.audit_events where tenant_id='2e000000-0000-4000-8000-000000000001' and action='alert.acknowledged'),1,'same-state retry does not duplicate audit');
select throws_ok($$select app.update_alert_status('1e000000-0000-4000-8000-000000000002','2e000000-0000-4000-8000-000000000001',(select id from app.risk_alerts where tenant_id='2e000000-0000-4000-8000-000000000001' limit 1),'resolved',null,'alert-test-3')$$,'HCSE0','Alert management is not allowed','cross-tenant alert update is denied');
select ok((app.load_audit_activity('1e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001','2026-09-01','2026-09-30',null,null,null,null,'',50,0)->>'total')::integer >= 1,'audit projection returns tenant history');
select is(jsonb_array_length(app.load_audit_activity('1e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001','2026-09-01','2026-09-30',null,null,'alert.acknowledged',null,'',50,0)->'items'),1,'audit action filter is applied');
select is(jsonb_array_length(app.load_audit_activity('1e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001','2026-09-01','2026-09-30',null,null,null,null,'Checking the shelf',50,0)->'items'),1,'audit search includes reasons');
select throws_ok($$select app.load_audit_activity('1e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001','2026-09-30','2026-09-01',null,null,null,null,'',50,0)$$,'HCSE1','Audit filters are invalid','inverted audit dates are rejected');
select throws_ok($$select app.load_audit_activity('1e000000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-000000000001','2026-09-01','2026-09-30','3e000000-0000-4000-8000-000000000002',null,null,null,'',50,0)$$,'HCSE2','Audit location was not found','foreign audit location is rejected');
select is((select count(*)::integer from app.role_permissions rp join app.roles r on r.tenant_id=rp.tenant_id and r.id=rp.role_id where r.tenant_id='2e000000-0000-4000-8000-000000000001' and r.code='manager' and rp.permission_code in ('alerts.read','alerts.manage','audit.read')),3,'future manager role receives control permissions');

select * from finish();
rollback;
