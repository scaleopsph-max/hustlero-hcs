begin;

create function app.create_catalog_variant(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_product_id uuid,
  p_variant_name text,
  p_sku text,
  p_retail_price numeric,
  p_unit_cost numeric,
  p_track_inventory boolean,
  p_barcodes text[],
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
  v_product app.products%rowtype;
  v_variant_id uuid;
  v_response jsonb;
  v_barcodes text[];
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

  if not exists (
    select 1 from app.tenant_entitlements entitlement
    join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant_id
      and entitlement.feature_code = 'catalog'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) then
    raise exception using errcode = 'HCS10', message = 'Catalog feature is unavailable';
  end if;

  select * into v_product
  from app.products product
  where product.tenant_id = p_tenant_id
    and product.id = p_product_id
    and product.status <> 'archived';
  if not found then
    raise exception using errcode = 'HCS12', message = 'Product was not found';
  end if;

  if btrim(coalesce(p_variant_name, '')) = '' or btrim(coalesce(p_sku, '')) = ''
     or p_retail_price is null or p_retail_price < 0
     or p_unit_cost < 0 then
    raise exception using errcode = 'HCS11', message = 'Variant details are invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':catalog.variant.create:' || p_idempotency_key, 0)
  );

  select * into v_existing
  from app.idempotency_records
  where tenant_id = p_tenant_id
    and operation = 'catalog.variant.create'
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = 'HCS08', message = 'Idempotency key was reused with different variant details';
    end if;
    if v_existing.completed_at is not null then
      return v_existing.response_body;
    end if;
  else
    insert into app.idempotency_records (
      tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at
    ) values (
      p_tenant_id, 'catalog.variant.create', p_idempotency_key, p_request_hash,
      now() + interval '1 minute', now() + interval '24 hours'
    );
  end if;

  insert into app.product_variants (
    tenant_id, product_id, name, sku, retail_price, unit_cost, track_inventory, created_by
  ) values (
    p_tenant_id, p_product_id, btrim(p_variant_name), upper(btrim(p_sku)),
    p_retail_price, p_unit_cost, p_track_inventory, p_actor_user_id
  ) returning id into v_variant_id;

  select coalesce(array_agg(value order by ordinal), '{}'::text[]) into v_barcodes
  from (
    select min(entry.ordinal) as ordinal, upper(btrim(entry.value)) as value
    from unnest(coalesce(p_barcodes, '{}'::text[])) with ordinality entry(value, ordinal)
    where btrim(entry.value) <> ''
    group by upper(btrim(entry.value))
  ) normalized;

  insert into app.product_barcodes (tenant_id, variant_id, barcode, is_primary)
  select p_tenant_id, v_variant_id, barcode, ordinal = 1
  from unnest(v_barcodes) with ordinality item(barcode, ordinal);

  v_response := pg_catalog.jsonb_build_object(
    'productId', p_product_id,
    'variantId', v_variant_id,
    'status', 'created'
  );

  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id,
    'catalog.variant.created', 'product_variant', v_variant_id,
    pg_catalog.jsonb_build_object('productId', p_product_id, 'sku', upper(btrim(p_sku)))
  );

  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (
    p_tenant_id, 'catalog.variant.created', 'product', p_product_id,
    pg_catalog.jsonb_build_object('productId', p_product_id, 'variantId', v_variant_id)
  );

  update app.idempotency_records
  set response_status = 201, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id
    and operation = 'catalog.variant.create'
    and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;

revoke all on function app.create_catalog_variant(
  uuid, uuid, uuid, text, text, numeric, numeric, boolean, text[], text, text, text
) from public, anon, authenticated;
grant execute on function app.create_catalog_variant(
  uuid, uuid, uuid, text, text, numeric, numeric, boolean, text[], text, text, text
) to hcs_hyperdrive;

commit;
