begin;

insert into app.permissions (code, description) values
  ('catalog.read', 'View products and categories'),
  ('catalog.manage', 'Create and maintain products and categories')
on conflict (code) do update set description = excluded.description;

create table app.product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  name text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint product_categories_name_not_blank check (btrim(name) <> '')
);
create unique index product_categories_tenant_name_unique_idx
  on app.product_categories (tenant_id, lower(btrim(name)));
create index product_categories_created_by_idx on app.product_categories (created_by);

create table app.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  category_id uuid,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references app.product_categories (tenant_id, id) on delete restrict,
  constraint products_name_not_blank check (btrim(name) <> ''),
  constraint products_description_not_blank check (description is null or btrim(description) <> '')
);
create index products_tenant_category_idx on app.products (tenant_id, category_id, name);
create index products_created_by_idx on app.products (created_by);

create table app.product_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  product_id uuid not null,
  name text not null default 'Default',
  sku extensions.citext not null,
  retail_price numeric(18, 2) not null,
  unit_cost numeric(18, 2),
  track_inventory boolean not null default true,
  is_active boolean not null default true,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, sku),
  foreign key (tenant_id, product_id) references app.products (tenant_id, id) on delete restrict,
  constraint product_variants_name_not_blank check (btrim(name) <> ''),
  constraint product_variants_sku_not_blank check (btrim(sku::text) <> ''),
  constraint product_variants_retail_price_nonnegative check (retail_price >= 0),
  constraint product_variants_unit_cost_nonnegative check (unit_cost is null or unit_cost >= 0)
);
create index product_variants_tenant_product_idx on app.product_variants (tenant_id, product_id, is_active);
create index product_variants_created_by_idx on app.product_variants (created_by);

create table app.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  variant_id uuid not null,
  barcode extensions.citext not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, barcode),
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete restrict,
  constraint product_barcodes_value_not_blank check (btrim(barcode::text) <> '')
);
create unique index product_barcodes_one_primary_idx
  on app.product_barcodes (tenant_id, variant_id) where is_primary;
create index product_barcodes_variant_idx on app.product_barcodes (tenant_id, variant_id);

create trigger product_categories_set_updated_at before update on app.product_categories
  for each row execute function app.set_updated_at();
create trigger products_set_updated_at before update on app.products
  for each row execute function app.set_updated_at();
create trigger product_variants_set_updated_at before update on app.product_variants
  for each row execute function app.set_updated_at();

alter table app.product_categories enable row level security;
alter table app.products enable row level security;
alter table app.product_variants enable row level security;
alter table app.product_barcodes enable row level security;

create function app.initialize_owner_catalog_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(new.code::text) = 'owner' then
    insert into app.role_permissions (tenant_id, role_id, permission_code)
    values
      (new.tenant_id, new.id, 'catalog.read'),
      (new.tenant_id, new.id, 'catalog.manage')
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app.initialize_owner_catalog_permissions() from public, anon, authenticated;
create trigger roles_initialize_catalog_permissions
after insert on app.roles for each row execute function app.initialize_owner_catalog_permissions();

insert into app.role_permissions (tenant_id, role_id, permission_code)
select role.tenant_id, role.id, permission.code
from app.roles role
cross join app.permissions permission
where lower(role.code::text) = 'owner'
  and permission.code in ('catalog.read', 'catalog.manage')
on conflict do nothing;

create function app.list_catalog_products(p_actor_user_id uuid, p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  select exists (
    select 1
    from app.tenant_memberships membership
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
            and role_permission.permission_code in ('catalog.read', 'catalog.manage')
        )
      )
  ) into v_allowed;

  if not v_allowed then
    raise exception using errcode = 'HCS09', message = 'Catalog access is not allowed';
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

  return pg_catalog.jsonb_build_object(
    'categories', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', category.id, 'name', category.name)
        order by lower(category.name), category.id
      )
      from app.product_categories category
      where category.tenant_id = p_tenant_id and category.status = 'active'
    ), '[]'::jsonb),
    'products', coalesce((
      select pg_catalog.jsonb_agg(product_row.payload order by product_row.sort_name, product_row.product_id)
      from (
        select
          product.id as product_id,
          lower(product.name) as sort_name,
          pg_catalog.jsonb_build_object(
            'id', product.id,
            'name', product.name,
            'description', product.description,
            'status', product.status,
            'category', case when category.id is null then null else
              pg_catalog.jsonb_build_object('id', category.id, 'name', category.name) end,
            'variants', coalesce((
              select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'id', variant.id,
                  'name', variant.name,
                  'sku', variant.sku::text,
                  'retailPrice', variant.retail_price::text,
                  'unitCost', variant.unit_cost::text,
                  'trackInventory', variant.track_inventory,
                  'isActive', variant.is_active,
                  'barcodes', coalesce((
                    select pg_catalog.jsonb_agg(barcode.barcode::text order by barcode.is_primary desc, barcode.created_at)
                    from app.product_barcodes barcode
                    where barcode.tenant_id = p_tenant_id and barcode.variant_id = variant.id
                  ), '[]'::jsonb)
                ) order by lower(variant.name), variant.id
              )
              from app.product_variants variant
              where variant.tenant_id = p_tenant_id and variant.product_id = product.id
            ), '[]'::jsonb)
          ) as payload
        from app.products product
        left join app.product_categories category
          on category.tenant_id = product.tenant_id and category.id = product.category_id
        where product.tenant_id = p_tenant_id and product.status <> 'archived'
      ) product_row
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function app.list_catalog_products(uuid, uuid) from public, anon, authenticated;
grant execute on function app.list_catalog_products(uuid, uuid) to hcs_hyperdrive;

create function app.create_catalog_product(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_name text,
  p_description text,
  p_category_name text,
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
  v_category_id uuid;
  v_product_id uuid;
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
          select 1 from app.membership_roles membership_role
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

  if btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_sku, '')) = ''
     or p_retail_price is null or p_retail_price < 0
     or p_unit_cost < 0 then
    raise exception using errcode = 'HCS11', message = 'Product details are invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':catalog.product.create:' || p_idempotency_key, 0)
  );

  select * into v_existing
  from app.idempotency_records
  where tenant_id = p_tenant_id
    and operation = 'catalog.product.create'
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = 'HCS08', message = 'Idempotency key was reused with different product details';
    end if;
    if v_existing.completed_at is not null then
      return v_existing.response_body;
    end if;
  else
    insert into app.idempotency_records (
      tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at
    ) values (
      p_tenant_id, 'catalog.product.create', p_idempotency_key, p_request_hash,
      now() + interval '1 minute', now() + interval '24 hours'
    );
  end if;

  if nullif(btrim(coalesce(p_category_name, '')), '') is not null then
    insert into app.product_categories (tenant_id, name, created_by)
    values (p_tenant_id, btrim(p_category_name), p_actor_user_id)
    on conflict (tenant_id, lower(btrim(name))) do update set name = excluded.name
    returning id into v_category_id;
  end if;

  insert into app.products (tenant_id, category_id, name, description, created_by)
  values (
    p_tenant_id, v_category_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_actor_user_id
  ) returning id into v_product_id;

  insert into app.product_variants (
    tenant_id, product_id, name, sku, retail_price, unit_cost, track_inventory, created_by
  ) values (
    p_tenant_id, v_product_id, coalesce(nullif(btrim(p_variant_name), ''), 'Default'),
    upper(btrim(p_sku)), p_retail_price, p_unit_cost, p_track_inventory, p_actor_user_id
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
    'productId', v_product_id,
    'variantId', v_variant_id,
    'status', 'created'
  );

  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id,
    'catalog.product.created', 'product', v_product_id,
    pg_catalog.jsonb_build_object('variantId', v_variant_id, 'sku', upper(btrim(p_sku)))
  );

  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (
    p_tenant_id, 'catalog.product.created', 'product', v_product_id,
    pg_catalog.jsonb_build_object('productId', v_product_id, 'variantId', v_variant_id)
  );

  update app.idempotency_records
  set response_status = 201, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id
    and operation = 'catalog.product.create'
    and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;
revoke all on function app.create_catalog_product(
  uuid, uuid, text, text, text, text, text, numeric, numeric, boolean, text[], text, text, text
) from public, anon, authenticated;
grant execute on function app.create_catalog_product(
  uuid, uuid, text, text, text, text, text, numeric, numeric, boolean, text[], text, text, text
) to hcs_hyperdrive;

create function app.tenant_has_products(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.products product
    where product.tenant_id = p_tenant_id and product.status <> 'archived'
  );
$$;
revoke all on function app.tenant_has_products(uuid) from public, anon, authenticated;
grant execute on function app.tenant_has_products(uuid) to hcs_hyperdrive;

commit;
