begin;

-- The new write surface does not grant browsers direct table/core-function access.
create function app.lock_catalog_access(p_actor uuid,p_tenant uuid,p_write boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner boolean; v_entitlement app.tenant_entitlements%rowtype;
begin
 perform 1 from app.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception using errcode='HCS09',message='Catalog access denied'; end if;
 perform 1 from app.features where code='catalog' and platform_available for share;
 if not found then raise exception using errcode='HCS10',message='Catalog unavailable'; end if;
 select * into v_entitlement from app.tenant_entitlements where tenant_id=p_tenant and feature_code='catalog' for share;
 if not found or not v_entitlement.entitled or not v_entitlement.enabled
 or v_entitlement.starts_at>clock_timestamp() or v_entitlement.ends_at<=clock_timestamp()
 then raise exception using errcode='HCS10',message='Catalog unavailable'; end if;
 select is_owner into v_owner from app.tenant_memberships where tenant_id=p_tenant and user_id=p_actor and status='active' for share;
 if not found then raise exception using errcode='HCS09',message='Catalog access denied'; end if;
 if not v_owner then
  perform 1 from app.membership_roles mr join app.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
  where mr.tenant_id=p_tenant and mr.user_id=p_actor
  and (rp.permission_code='catalog.manage' or (not p_write and rp.permission_code='catalog.read'))
  order by mr.role_id for share of mr,rp;
  if not found then raise exception using errcode='HCS09',message='Catalog access denied'; end if;
 end if;
end;
$$;
revoke all on function app.lock_catalog_access(uuid,uuid,boolean) from public,anon,authenticated,hcs_hyperdrive;

create function app.load_catalog_categories(p_actor uuid,p_tenant uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_manage boolean;
begin
 perform app.lock_catalog_access(p_actor,p_tenant,false);
 select m.is_owner or exists(select 1 from app.membership_roles mr join app.role_permissions rp
 on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id
 where mr.tenant_id=p_tenant and mr.user_id=p_actor and rp.permission_code='catalog.manage')
 into v_manage from app.tenant_memberships m where m.tenant_id=p_tenant and m.user_id=p_actor;
 return jsonb_build_object('canManage',v_manage,'categories',(select coalesce(jsonb_agg(jsonb_build_object(
 'id',c.id,'name',c.name,'status',c.status,
 'productCount',(select count(*) from app.products p where p.tenant_id=p_tenant and p.category_id=c.id and p.status<>'archived'),
 'pricingGroupCount',(select count(*) from app.pricing_groups g where g.tenant_id=p_tenant and g.category_id=c.id)
 ) order by lower(c.name),c.id),'[]'::jsonb) from app.product_categories c where c.tenant_id=p_tenant));
end;
$$;

create function app.manage_catalog_category(p_actor uuid,p_tenant uuid,p_body jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_name text:=btrim(p_body->>'name'); v_action text:=p_body->>'action';
 v_row app.product_categories%rowtype; v_existing app.idempotency_records%rowtype; v_result jsonb;
 v_hash text:=p_actor::text||':'||p_hash;
begin
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 if p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash,'') is null
 or v_action is null or v_action not in ('create','rename','archive')
 or (v_action in ('create','rename') and (v_name is null or length(v_name) not between 1 and 80))
 then raise exception using errcode='HCS11',message='Invalid category command'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':catalog.category:'||p_key,0));
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation='catalog.category.manage' and idempotency_key=p_key;
 if found then
  if v_existing.request_hash<>v_hash then raise exception using errcode='HCS08',message='Request key conflict'; end if;
  if v_existing.completed_at is not null then
   perform app.lock_catalog_access(p_actor,p_tenant,true);
   return v_existing.response_body;
  end if;
 end if;
 if v_action='create' then
  if p_body ? 'categoryId' then raise exception using errcode='HCS11',message='Create cannot target a category'; end if;
  insert into app.product_categories(tenant_id,name,created_by) values(p_tenant,v_name,p_actor) returning * into v_row;
 else
  v_id:=(p_body->>'categoryId')::uuid;
  select * into v_row from app.product_categories where tenant_id=p_tenant and id=v_id for update;
  if not found then raise exception using errcode='HCS12',message='Category not found'; end if;
  if v_row.status<>'active' then raise exception using errcode='HCCT1',message='Category is archived'; end if;
  if v_action='archive' then
   if exists(select 1 from app.products where tenant_id=p_tenant and category_id=v_id and status<>'archived')
   or exists(select 1 from app.pricing_groups where tenant_id=p_tenant and category_id=v_id)
   then raise exception using errcode='HCCT2',message='Category has product or pricing references'; end if;
   update app.product_categories set status='archived' where tenant_id=p_tenant and id=v_id returning * into v_row;
  else
   update app.product_categories set name=v_name where tenant_id=p_tenant and id=v_id returning * into v_row;
  end if;
 end if;
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 v_result:=jsonb_build_object('categoryId',v_row.id,'name',v_row.name,'status',v_row.status);
 insert into audit.audit_events(tenant_id,request_id,actor_type,actor_id,action,entity_type,entity_id,metadata)
 values(p_tenant,p_request_id,'tenant_user',p_actor,'catalog.category.'||v_action,'category',v_row.id,p_body);
 insert into integration.event_outbox(tenant_id,topic,aggregate_type,aggregate_id,payload)
 values(p_tenant,'catalog.category.'||v_action,'category',v_row.id,v_result);
 insert into app.idempotency_records(tenant_id,operation,idempotency_key,request_hash,response_status,response_body,completed_at,expires_at)
 values(p_tenant,'catalog.category.manage',p_key,v_hash,200,v_result,clock_timestamp(),clock_timestamp()+interval '24 hours');
 return v_result;
end;
$$;

-- Serialize category assignment with rename/archive. Legacy names may only match
-- an existing active category; they can no longer implicitly create one via API.
create function app.resolve_catalog_category(p_actor uuid,p_tenant uuid,p_body jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare v_name text;
begin
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 if nullif(p_body->>'categoryId','') is not null and nullif(btrim(p_body->>'categoryName'),'') is not null
 then raise exception using errcode='HCS11',message='Select only one category identity'; end if;
 if nullif(p_body->>'categoryId','') is not null then
  select name into v_name from app.product_categories where tenant_id=p_tenant and id=(p_body->>'categoryId')::uuid and status='active' for update;
 elsif nullif(btrim(p_body->>'categoryName'),'') is not null then
  select name into v_name from app.product_categories where tenant_id=p_tenant and lower(btrim(name))=lower(btrim(p_body->>'categoryName')) and status='active' for update;
 else return null;
 end if;
 if v_name is null then raise exception using errcode='HCS11',message='Select an existing active category'; end if;
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 return v_name;
end;
$$;
revoke all on function app.resolve_catalog_category(uuid,uuid,jsonb) from public,anon,authenticated,hcs_hyperdrive;

create function app.guard_active_catalog_category()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.category_id is not null then
  perform 1 from app.product_categories where tenant_id=new.tenant_id and id=new.category_id and status='active' for update;
  if not found then raise exception using errcode='HCS11',message='Select an active category'; end if;
 end if;
 return new;
end;
$$;
revoke all on function app.guard_active_catalog_category() from public,anon,authenticated,hcs_hyperdrive;
create trigger products_active_category before insert or update of category_id on app.products
for each row execute function app.guard_active_catalog_category();
create trigger pricing_groups_active_category before insert or update of category_id on app.pricing_groups
for each row execute function app.guard_active_catalog_category();

create function app.create_catalog_product_selected_category(p_actor uuid,p_tenant uuid,p_body jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_name text; v_result jsonb; v_existing app.idempotency_records%rowtype;
 v_hash text:=case when p_body ? 'categoryId' then p_actor::text||':'||p_hash else p_hash end;
begin
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':catalog.product.create:'||p_key,0));
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation='catalog.product.create' and idempotency_key=p_key;
 if found then
  if v_existing.request_hash<>v_hash then raise exception using errcode='HCS08',message='Request key conflict'; end if;
  if v_existing.completed_at is not null then return v_existing.response_body; end if;
 end if;
 v_name:=app.resolve_catalog_category(p_actor,p_tenant,p_body);
 v_result:=app.create_catalog_product(p_actor,p_tenant,p_body->>'name',p_body->>'description',v_name,
 p_body->>'variantName',p_body->>'sku',(p_body->>'retailPriceMinor')::numeric/100,
 (p_body->>'unitCostMinor')::numeric/100,(p_body->>'trackInventory')::boolean,
 array(select jsonb_array_elements_text(p_body->'barcodes')),p_key,v_hash,p_request_id);
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 return v_result;
end;
$$;
create function app.update_catalog_product_selected_category(p_actor uuid,p_tenant uuid,p_product uuid,p_body jsonb,p_key text,p_hash text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_name text; v_result jsonb; v_existing app.idempotency_records%rowtype;
 v_hash text:=case when p_body ? 'categoryId' then p_actor::text||':'||p_hash else p_hash end;
begin
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':catalog.product.update:'||p_key,0));
 select * into v_existing from app.idempotency_records where tenant_id=p_tenant and operation='catalog.product.update' and idempotency_key=p_key;
 if found then
  if v_existing.request_hash<>v_hash then raise exception using errcode='HCS08',message='Request key conflict'; end if;
  if v_existing.completed_at is not null then return v_existing.response_body; end if;
 end if;
 v_name:=app.resolve_catalog_category(p_actor,p_tenant,p_body);
 v_result:=app.update_catalog_product(p_actor,p_tenant,p_product,p_body->>'name',p_body->>'description',v_name,
 p_key,v_hash,p_request_id);
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 return v_result;
end;
$$;
revoke all on function app.create_catalog_product(uuid,uuid,text,text,text,text,text,numeric,numeric,boolean,text[],text,text,text) from hcs_hyperdrive;
revoke all on function app.update_catalog_product(uuid,uuid,uuid,text,text,text,text,text,text) from hcs_hyperdrive;
revoke all on function app.load_catalog_categories(uuid,uuid),app.manage_catalog_category(uuid,uuid,jsonb,text,text,text),
 app.create_catalog_product_selected_category(uuid,uuid,jsonb,text,text,text),
 app.update_catalog_product_selected_category(uuid,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function app.load_catalog_categories(uuid,uuid),app.manage_catalog_category(uuid,uuid,jsonb,text,text,text),
 app.create_catalog_product_selected_category(uuid,uuid,jsonb,text,text,text),
 app.update_catalog_product_selected_category(uuid,uuid,uuid,jsonb,text,text,text) to hcs_hyperdrive;
commit;
