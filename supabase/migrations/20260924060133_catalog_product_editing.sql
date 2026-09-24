begin;

create function app.update_catalog_product(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_product_id uuid,
  p_name text,
  p_description text,
  p_category_name text,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing app.idempotency_records%rowtype;
  v_category_id uuid;
  v_response jsonb;
begin
  if not exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_user_id
      and membership.status = 'active'
      and (
        membership.is_owner
        or exists (
          select 1
          from app.membership_roles membership_role
          join app.role_permissions role_permission
            on role_permission.tenant_id = membership_role.tenant_id
           and role_permission.role_id = membership_role.role_id
          where membership_role.tenant_id = membership.tenant_id
            and membership_role.user_id = membership.user_id
            and role_permission.permission_code = 'catalog.manage'
        )
      )
  ) then
    raise exception using errcode = 'HCS09', message = 'Catalog management is not allowed';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception using errcode = 'HCS11', message = 'Product details are invalid';
  end if;

  if not exists (
    select 1 from app.products product
    where product.tenant_id = p_tenant_id and product.id = p_product_id and product.status <> 'archived'
  ) then
    raise exception using errcode = 'HCS12', message = 'Product was not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':catalog.product.update:' || p_idempotency_key, 0)
  );

  select * into v_existing
  from app.idempotency_records
  where tenant_id = p_tenant_id and operation = 'catalog.product.update' and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = 'HCS08', message = 'Idempotency key was reused with different product details';
    end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at)
    values (p_tenant_id, 'catalog.product.update', p_idempotency_key, p_request_hash, now() + interval '1 minute', now() + interval '24 hours');
  end if;

  if nullif(btrim(coalesce(p_category_name, '')), '') is not null then
    insert into app.product_categories (tenant_id, name, created_by)
    values (p_tenant_id, btrim(p_category_name), p_actor_user_id)
    on conflict (tenant_id, lower(btrim(name))) do update set name = excluded.name
    returning id into v_category_id;
  end if;

  update app.products
  set name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      category_id = v_category_id
  where tenant_id = p_tenant_id and id = p_product_id;

  v_response := pg_catalog.jsonb_build_object('productId', p_product_id, 'status', 'updated');

  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id, 'catalog.product.updated', 'product', p_product_id,
    pg_catalog.jsonb_build_object('name', btrim(p_name)));

  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant_id, 'catalog.product.updated', 'product', p_product_id, v_response);

  update app.idempotency_records
  set response_status = 200, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id and operation = 'catalog.product.update' and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;

revoke all on function app.update_catalog_product(uuid,uuid,uuid,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function app.update_catalog_product(uuid,uuid,uuid,text,text,text,text,text,text) to hcs_hyperdrive;

commit;
