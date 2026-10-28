begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,aud,role) values
 ('ab000000-0000-4000-8000-000000000001','pcount-owner@example.invalid','authenticated','authenticated'),
 ('ab000000-0000-4000-8000-000000000002','pcount-manager@example.invalid','authenticated','authenticated'),
 ('ab000000-0000-4000-8000-000000000003','pcount-staff@example.invalid','authenticated','authenticated'),
 ('ab000000-0000-4000-8000-000000000004','pcount-foreign@example.invalid','authenticated','authenticated');
insert into app.tenants(id,slug,name) values
 ('ab100000-0000-4000-8000-000000000001','pcount-test-a','Count A'),
 ('ab100000-0000-4000-8000-000000000002','pcount-test-b','Count B');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner) values
 ('ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001','active',true),
 ('ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000002','active',false),
 ('ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000003','active',false),
 ('ab100000-0000-4000-8000-000000000002','ab000000-0000-4000-8000-000000000004','active',true);
insert into app.locations(id,tenant_id,code,name) values
 ('ab200000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','MAIN','Main'),
 ('ab200000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001','OTHER','Other');
insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values
 ('ab300000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000002','MGR','Manager'),
 ('ab300000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000003','STAFF','Staff');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
 ('ab100000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000002','ab200000-0000-4000-8000-000000000001'),
 ('ab100000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001');
insert into app.membership_roles(tenant_id,user_id,role_id)
 select 'ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000002',id from app.roles
 where tenant_id='ab100000-0000-4000-8000-000000000001' and code='manager';
insert into app.membership_roles(tenant_id,user_id,role_id)
 select 'ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000003',id from app.roles
 where tenant_id='ab100000-0000-4000-8000-000000000001' and code='cashier';
update app.tenant_entitlements set entitled=true,enabled=true where tenant_id='ab100000-0000-4000-8000-000000000001' and feature_code='inventory';
insert into app.products(id,tenant_id,name,created_by) values
 ('ab400000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','Count product','ab000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,track_inventory,created_by) values
 ('ab500000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000001','Each','COUNT-1',100,50,true,'ab000000-0000-4000-8000-000000000001'),
 ('ab500000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000001','Other','COUNT-2',100,50,true,'ab000000-0000-4000-8000-000000000001');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost,version) values
 ('ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','ab500000-0000-4000-8000-000000000001',10,50,2),
 ('ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','ab500000-0000-4000-8000-000000000002',5,50,3);



insert into auth.users(id,email,aud,role,email_confirmed_at) values ('ab000000-0000-4000-8000-000000000005','invitee@example.invalid','authenticated','authenticated',clock_timestamp()),('ab000000-0000-4000-8000-000000000006','other@example.invalid','authenticated','authenticated',clock_timestamp());
insert into app.employees(id,tenant_id,employee_code,display_name) values ('ab300000-0000-4000-8000-000000000005','ab100000-0000-4000-8000-000000000001','INVITE','Invite employee');
select throws_ok($$select app.create_employee_membership_invitation('ab000000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000005','invitee@example.invalid','invite-denied-key-0001','test')$$,'HCPC0',null,'staff cannot create invitation');
create temp table issued as select app.create_employee_membership_invitation('ab000000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000005','INVITEE@example.invalid','invite-owner-key-00001','test') result;
select is(jsonb_array_length(app.list_workforce_context('ab000000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001')->'pendingEmployeeInvitations'),1,'owner sees pending invitation');
select is(jsonb_array_length(app.list_employee_membership_invitations('ab000000-0000-4000-8000-000000000005')),1,'matching verified user sees invitation');
select is(jsonb_array_length(app.list_employee_membership_invitations('ab000000-0000-4000-8000-000000000006')),0,'other verified user cannot list invitation');
update auth.users set email_confirmed_at=null where id='ab000000-0000-4000-8000-000000000005';
select throws_ok($$select app.accept_employee_membership_invitation('ab000000-0000-4000-8000-000000000005',(select (result->>'invitationId')::uuid from issued),'invite-unverified-001','test')$$,'HCPC0',null,'unverified matching email cannot accept');
update auth.users set email_confirmed_at=clock_timestamp() where id='ab000000-0000-4000-8000-000000000005';
select throws_ok($$select app.accept_employee_membership_invitation('ab000000-0000-4000-8000-000000000006',(select (result->>'invitationId')::uuid from issued),'invite-wrong-user-0001','test')$$,'HCPC1',null,'other verified email cannot accept');
create temp table accepted as select app.accept_employee_membership_invitation('ab000000-0000-4000-8000-000000000005',(select (result->>'invitationId')::uuid from issued),'invite-accept-key-0001','test') result;
select is((select user_id::text from app.employees where id='ab300000-0000-4000-8000-000000000005'),'ab000000-0000-4000-8000-000000000005','verified recipient linked');
select is((select is_owner from app.tenant_memberships where tenant_id='ab100000-0000-4000-8000-000000000001' and user_id='ab000000-0000-4000-8000-000000000005'),false,'recipient is not owner');
select is((select count(*)::integer from app.membership_roles where tenant_id='ab100000-0000-4000-8000-000000000001' and user_id='ab000000-0000-4000-8000-000000000005'),0,'acceptance grants no role');
select is(app.accept_employee_membership_invitation('ab000000-0000-4000-8000-000000000005',(select (result->>'invitationId')::uuid from issued),'invite-accept-key-0001','test'),(select result from accepted),'accept retry returns original result');
insert into app.employees(id,tenant_id,employee_code,display_name) values ('ab300000-0000-4000-8000-000000000006','ab100000-0000-4000-8000-000000000001','REVOKE','Revoked employee');
create temp table revocable as select app.create_employee_membership_invitation('ab000000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000006','other@example.invalid','invite-revoke-setup-01','test') result;
select app.revoke_employee_membership_invitation('ab000000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001',(select (result->>'invitationId')::uuid from revocable),'invite-revoke-key-0001','test');
select throws_ok($$select app.accept_employee_membership_invitation('ab000000-0000-4000-8000-000000000006',(select (result->>'invitationId')::uuid from revocable),'invite-revoked-accept01','test')$$,'HCPC3',null,'revoked invitation cannot be accepted');
select * from finish(); rollback;
