begin;
create or replace function app.initialize_tenant_staff_roles() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into app.roles(tenant_id,code,name,is_system_template) values(new.id,'admin','Admin',true),(new.id,'manager','Manager',true),(new.id,'cashier','Cashier',true),(new.id,'inventory_staff','Inventory Staff',true) on conflict do nothing;
 insert into app.role_permissions(tenant_id,role_id,permission_code)
 select role.tenant_id,role.id,permission.code from app.roles role join app.permissions permission on permission.code=any(case lower(role.code::text)
  when 'admin' then array['workforce.read','workforce.manage','locations.manage','inventory.read','inventory.manage','purchasing.read','purchasing.manage','transfers.read','transfers.manage']
  when 'manager' then array['workforce.read','inventory.read','inventory.manage','purchasing.read','purchasing.manage','transfers.read','transfers.manage']
  when 'cashier' then array['inventory.read']
  when 'inventory_staff' then array['inventory.read','inventory.manage','purchasing.read','transfers.read','transfers.manage'] else array[]::text[] end)
 where role.tenant_id=new.id and lower(role.code::text) in('admin','manager','cashier','inventory_staff') on conflict do nothing;
 return new;
end; $$;
commit;
