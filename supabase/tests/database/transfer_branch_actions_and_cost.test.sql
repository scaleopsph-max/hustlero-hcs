begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,aud,role,email_confirmed_at) values
('1d000000-0000-4000-8000-000000000001','report-a@example.invalid','authenticated','authenticated',now()),
('1d000000-0000-4000-8000-000000000002','report-b@example.invalid','authenticated','authenticated',now());
insert into app.tenants(id,slug,name,timezone) values
('2d000000-0000-4000-8000-000000000001','report-a','Report A','Asia/Manila'),
('2d000000-0000-4000-8000-000000000002','report-b','Report B','Asia/Manila');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('2d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001','active',true,now()),
('2d000000-0000-4000-8000-000000000002','1d000000-0000-4000-8000-000000000002','active',true,now());
insert into app.locations(id,tenant_id,code,name) values
('3d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','MAIN','Main Store'),
('3d000000-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000002','MAIN','Other Store');
insert into app.employees(id,tenant_id,employee_code,display_name) values
('4d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','CASH-1','Cashier One');
insert into app.registers(id,tenant_id,location_id,name,code) values
('5d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000001','Register 1','REG-1');
insert into app.register_sessions(id,tenant_id,register_id,location_id,employee_id,status,opening_cash,opened_at) values
('6d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','5d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000001','open',1000,'2026-09-25 00:00:00+00');
insert into app.payment_methods(id,tenant_id,code,name,method_type) values
('7d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','report-cash','Report Cash','cash');
insert into app.product_categories(id,tenant_id,name,created_by) values
('8d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','Shirts','1d000000-0000-4000-8000-000000000001');
insert into app.products(id,tenant_id,name,category_id,created_by) values
('9d000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','Report Shirt','8d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001');
insert into app.product_variants(id,tenant_id,product_id,name,sku,retail_price,unit_cost,created_by) values
('ad000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000001','Black / Small','REPORT-SHIRT',500,300,'1d000000-0000-4000-8000-000000000001');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost) values
('2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001',9,300);
insert into app.sales(id,tenant_id,location_id,register_id,register_session_id,employee_id,receipt_number,subtotal,total,completed_at) values
('bd000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000001','5d000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000001','MAIN-20260925-000001',1000,1000,'2026-09-25 02:00:00+00');
insert into app.sale_lines(id,tenant_id,sale_id,variant_id,product_name,variant_name,sku,quantity,unit_price,unit_cost,line_total) values
('cd000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001','Report Shirt','Black / Small','REPORT-SHIRT',2,500,300,1000);
insert into app.sale_payments(id,tenant_id,sale_id,payment_method_id,amount,tendered_amount,change_amount) values
('dd000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001','7d000000-0000-4000-8000-000000000001',1000,1000,0);
insert into app.refunds(id,tenant_id,sale_id,reversal_type,amount,reason,completed_by,completed_at) values
('ed000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001','refund',500,'Report refund','1d000000-0000-4000-8000-000000000001','2026-09-25 03:00:00+00');
insert into app.refund_items(tenant_id,refund_id,sale_line_id,quantity,amount,returned_to_stock) values
('2d000000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001',1,500,true);
insert into app.payment_reversals(tenant_id,refund_id,sale_payment_id,amount) values
('2d000000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000001',500);


insert into auth.users(id,email,aud,role,email_confirmed_at) values
('1d000000-0000-4000-8000-000000000003','report-reader@example.invalid','authenticated','authenticated',now());
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('2d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000003','active',false,now());
insert into app.roles(id,tenant_id,code,name) values
('f1000000-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001','REPORT-UAT-READ','Report UAT Read');
insert into app.role_permissions(tenant_id,role_id,permission_code) values
('2d000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','reports.read');
insert into app.membership_roles(tenant_id,user_id,role_id) values
('2d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001');
insert into app.locations(id,tenant_id,code,name) values ('3d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','BRANCH','Assigned Branch');
insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values
('4d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000003','REPORT-READER','Report Reader');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
('2d000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000003','3d000000-0000-4000-8000-000000000003');
insert into app.registers(id,tenant_id,location_id,name,code) values
('5d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000003','Branch Register','REG-B');
insert into app.register_sessions(id,tenant_id,register_id,location_id,employee_id,status,opening_cash,opened_at) values
('6d000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','5d000000-0000-4000-8000-000000000003','3d000000-0000-4000-8000-000000000003','4d000000-0000-4000-8000-000000000003','open',2000,'2026-09-25 00:00:00+00');
insert into app.inventory_balances(tenant_id,location_id,variant_id,on_hand,average_unit_cost) values
('2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000003','ad000000-0000-4000-8000-000000000001',5,300);
insert into app.inventory_reorder_policies(tenant_id,location_id,variant_id,reorder_level,updated_by) values
('2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000003','ad000000-0000-4000-8000-000000000001',6,'1d000000-0000-4000-8000-000000000001'),
('2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001',10,'1d000000-0000-4000-8000-000000000001');
insert into app.sales(id,tenant_id,location_id,register_id,register_session_id,employee_id,receipt_number,subtotal,total,completed_at) values
('bd000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000003','5d000000-0000-4000-8000-000000000003','6d000000-0000-4000-8000-000000000003','4d000000-0000-4000-8000-000000000003','BRANCH-20260925-000001',2000,2000,'2026-09-25 02:00:00+00');
insert into app.sale_lines(id,tenant_id,sale_id,variant_id,product_name,variant_name,sku,quantity,unit_price,unit_cost,line_total) values
('cd000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000003','ad000000-0000-4000-8000-000000000001','Report Shirt','Black / Small','REPORT-SHIRT',4,500,300,2000);
insert into app.sale_payments(id,tenant_id,sale_id,payment_method_id,amount,tendered_amount,change_amount) values
('dd000000-0000-4000-8000-000000000003','2d000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000003','7d000000-0000-4000-8000-000000000001',2000,2000,0);

insert into auth.users(id,email,aud,role) values
('1d000000-0000-4000-8000-000000000004','transfer-source@example.invalid','authenticated','authenticated');
insert into app.tenant_memberships(tenant_id,user_id,status,is_owner,joined_at) values
('2d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000004','active',false,now());
insert into app.membership_roles(tenant_id,user_id,role_id) values
('2d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000001');
insert into app.role_permissions(tenant_id,role_id,permission_code) values
('2d000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','transfers.read'),
('2d000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','transfers.manage');
insert into app.employees(id,tenant_id,user_id,employee_code,display_name) values
('4d000000-0000-4000-8000-000000000004','2d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000004','TRANSFER-SOURCE','Transfer source');
insert into app.employee_locations(tenant_id,employee_id,location_id) values
('2d000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000004','3d000000-0000-4000-8000-000000000001');
update app.inventory_balances set average_unit_cost=500 where location_id='3d000000-0000-4000-8000-000000000003';
create function pg_temp.actor(p_name text) returns uuid language sql as $$
 select ('1d000000-0000-4000-8000-00000000000'||case p_name when 'owner' then '1' when 'foreign' then '2' when 'destination' then '3' else '4' end)::uuid;
$$;
create function pg_temp.make_transfer(p_name text,p_key text) returns jsonb language sql as $$
 select app.create_stock_transfer(pg_temp.actor(p_name),'2d000000-0000-4000-8000-000000000001',p_key,
 '3d000000-0000-4000-8000-000000000001','3d000000-0000-4000-8000-000000000003',
 '[{"variantId":"ad000000-0000-4000-8000-000000000001","quantityMilli":2000}]',p_key,p_key,p_key);
$$;
create function pg_temp.dispatch(p_name text,p_id uuid,p_key text) returns jsonb language sql as $$
 select app.dispatch_stock_transfer(pg_temp.actor(p_name),'2d000000-0000-4000-8000-000000000001',p_id,p_key,p_key,p_key);
$$;
create function pg_temp.receive(p_name text,p_id uuid,p_key text) returns jsonb language sql as $$
 select app.receive_stock_transfer(pg_temp.actor(p_name),'2d000000-0000-4000-8000-000000000001',p_id,
 (select jsonb_agg(jsonb_build_object('stockTransferItemId',id,'quantityMilli',1000)) from app.stock_transfer_items
 where tenant_id='2d000000-0000-4000-8000-000000000001' and transfer_id=p_id),p_key,p_key,p_key);
$$;
create function pg_temp.effects() returns jsonb language sql as $$
 select jsonb_build_object(
 'transfers',(select jsonb_agg(to_jsonb(t) order by id) from app.stock_transfers t),
 'items',(select jsonb_agg(to_jsonb(i) order by id) from app.stock_transfer_items i),
 'balances',(select jsonb_agg(to_jsonb(b) order by tenant_id,location_id,variant_id) from app.inventory_balances b),
 'movements',(select count(*) from app.inventory_movements),'sales',(select count(*) from app.sales),
 'cash',(select count(*) from app.cash_movements),'audit',(select count(*) from audit.audit_events),
 'outbox',(select count(*) from integration.event_outbox),'keys',(select count(*) from app.idempotency_records));
$$;
create temporary table baseline as select pg_temp.effects() value;
select throws_ok($$select pg_temp.make_transfer('destination','denied-create')$$,'HCS55','Transfer was not found','destination cannot create from unassigned source');
select is(pg_temp.effects(),(select value from baseline),'denied creation has no business effects');
create temporary table transfers(label text,id uuid);
insert into transfers select 'a',(pg_temp.make_transfer('source','transfer-a')->>'stockTransferId')::uuid;
insert into transfers select 'b',(pg_temp.make_transfer('source','transfer-b')->>'stockTransferId')::uuid;
insert into app.locations(id,tenant_id,code,name) values
('3d000000-0000-4000-8000-000000000004','2d000000-0000-4000-8000-000000000001','THIRD','Third'),
('3d000000-0000-4000-8000-000000000005','2d000000-0000-4000-8000-000000000001','FOURTH','Fourth');
insert into app.stock_transfers(tenant_id,transfer_number,source_location_id,destination_location_id,created_by)
values('2d000000-0000-4000-8000-000000000001','unrelated','3d000000-0000-4000-8000-000000000004','3d000000-0000-4000-8000-000000000005',pg_temp.actor('owner'));
select is(jsonb_array_length(app.list_transfer_context(pg_temp.actor('source'),'2d000000-0000-4000-8000-000000000001')->'transfers'),2,'source sees involved transfers only');
select is(jsonb_array_length(app.list_transfer_context(pg_temp.actor('destination'),'2d000000-0000-4000-8000-000000000001')->'transfers'),2,'destination sees incoming transfers only');
select is(jsonb_array_length(app.list_transfer_context(pg_temp.actor('owner'),'2d000000-0000-4000-8000-000000000001')->'transfers'),3,'owner sees all transfers');
select is(jsonb_array_length(app.list_transfer_context(pg_temp.actor('source'),'2d000000-0000-4000-8000-000000000001')->'actionLocationIds'),1,'source action location metadata is restricted');
update baseline set value=pg_temp.effects();
select throws_ok($$select pg_temp.dispatch('destination',(select id from transfers where label='a'),'bad-dispatch')$$,'HCS55','Transfer was not found','destination cannot dispatch source stock');
select throws_ok($$select pg_temp.dispatch('foreign',(select id from transfers where label='a'),'foreign')$$,'HCS50','Transfer management is not allowed','foreign actor denied');
select is(pg_temp.effects(),(select value from baseline),'denied dispatch leaves stock and ledgers unchanged');
select lives_ok($$select pg_temp.dispatch('source',(select id from transfers where label='a'),'dispatch-a')$$,'source dispatch succeeds');
select lives_ok($$select pg_temp.dispatch('source',(select id from transfers where label='a'),'dispatch-a')$$,'dispatch exact retry succeeds');
select is((select on_hand from app.inventory_balances where location_id='3d000000-0000-4000-8000-000000000001'),7::numeric,'dispatch removes two source units once');
select is((select in_transit from app.inventory_balances where location_id='3d000000-0000-4000-8000-000000000003'),2::numeric,'destination has two in transit');
select throws_ok($$select pg_temp.dispatch('source',(select id from transfers where label='b'),'dispatch-a')$$,'HCS08','Idempotency key conflict','dispatch replay cannot substitute another path');
update baseline set value=pg_temp.effects();
select throws_ok($$select pg_temp.receive('source',(select id from transfers where label='a'),'bad-receive')$$,'HCS55','Transfer was not found','source cannot receive at unassigned destination');
select is(pg_temp.effects(),(select value from baseline),'denied receiving preserves all business effects');
select lives_ok($$select pg_temp.receive('destination',(select id from transfers where label='a'),'receive-a-1')$$,'destination partial receiving succeeds');
select lives_ok($$select pg_temp.receive('destination',(select id from transfers where label='a'),'receive-a-1')$$,'partial receipt exact retry succeeds');
select is((select on_hand from app.inventory_balances where location_id='3d000000-0000-4000-8000-000000000003'),6::numeric,'partial retry adds one unit once');
select is((select average_unit_cost from app.inventory_balances where location_id='3d000000-0000-4000-8000-000000000003'),466.67::numeric,'partial weighted average uses incoming cost');
select lives_ok($$select pg_temp.receive('destination',(select id from transfers where label='a'),'receive-a-2')$$,'destination final receiving succeeds');
select is((select average_unit_cost from app.inventory_balances where location_id='3d000000-0000-4000-8000-000000000003'),442.86::numeric,'final moving average cost is recalculated');
select is((select in_transit from app.inventory_balances where location_id='3d000000-0000-4000-8000-000000000003'),0::numeric,'all transit cleared');
select is((select sum(on_hand) from app.inventory_balances),14::numeric,'internal transfer preserves total units');
select is((select count(*) from app.inventory_movements where movement_type='TRANSFER_IN'),2::bigint,'only two actual receipt movements');
select is((select count(*) from app.sales),2::bigint,'transfers create no sale');
select is((select count(*) from app.cash_movements),0::bigint,'transfers create no cash movement');
update baseline set value=pg_temp.effects();
select throws_ok($$select pg_temp.receive('destination',(select id from transfers where label='b'),'receive-a-2')$$,'HCS08','Idempotency key conflict','receipt replay binds original transfer');
delete from app.employee_locations where employee_id='4d000000-0000-4000-8000-000000000003';
select throws_ok($$select pg_temp.receive('destination',(select id from transfers where label='a'),'receive-a-2')$$,'HCS55','Transfer was not found','removed destination assignment denies completed retry');
select is(pg_temp.effects(),(select value from baseline),'rejected retries do not post business effects');
delete from app.role_permissions where role_id='f1000000-0000-4000-8000-000000000001' and permission_code='transfers.manage';
select throws_ok($$select pg_temp.dispatch('source',(select id from transfers where label='a'),'dispatch-a')$$,'HCS50','Transfer management is not allowed','removed capability denies cached dispatch');
select is(jsonb_array_length(app.list_transfer_context(pg_temp.actor('source'),'2d000000-0000-4000-8000-000000000001')->'actionLocationIds'),0,'read-only transfer UI has no action locations');
select ok(not has_function_privilege('hcs_hyperdrive','app.transfer_receive_scope_core(uuid,uuid,uuid,jsonb,text,text,text)','execute'),'unscoped receive core private');
select ok(not has_function_privilege('hcs_hyperdrive','app.receive_stock_transfer_impl(uuid,uuid,uuid,jsonb,text,text,text)','execute'),'receiving implementation remains private');
select * from finish();
rollback;
