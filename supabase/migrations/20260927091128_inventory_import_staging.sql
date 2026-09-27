begin;

create table app.inventory_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  filename text not null,
  cutover_at timestamptz not null,
  status text not null default 'previewed' check (status in ('previewed', 'posted', 'failed', 'reconciled')),
  content_hash text not null,
  row_count integer not null default 0 check (row_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  total_quantity numeric(18, 3) not null default 0,
  total_valuation numeric(18, 2) not null default 0,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  reconciled_at timestamptz,
  unique (tenant_id, id),
  constraint inventory_import_batches_filename_not_blank check (char_length(btrim(filename)) between 1 and 255),
  constraint inventory_import_batches_hash_not_blank check (btrim(content_hash) <> ''),
  constraint inventory_import_batches_counts_valid check (accepted_count + rejected_count = row_count),
  constraint inventory_import_batches_status_dates check (
    (status = 'previewed' and posted_at is null and reconciled_at is null)
    or (status in ('posted', 'failed') and reconciled_at is null)
    or (status = 'reconciled' and posted_at is not null and reconciled_at is not null)
  )
);
create index inventory_import_batches_tenant_created_idx
  on app.inventory_import_batches (tenant_id, created_at desc, id);
create index inventory_import_batches_created_by_idx
  on app.inventory_import_batches (created_by, created_at desc);

create table app.inventory_import_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  batch_id uuid not null,
  row_number integer not null check (row_number >= 2),
  branch_code text not null,
  sku text,
  barcode text,
  quantity_on_hand numeric(18, 3),
  unit_cost numeric(18, 2),
  reorder_level numeric(18, 3),
  reserved_quantity numeric(18, 3),
  damaged_quantity numeric(18, 3),
  in_transit_quantity numeric(18, 3),
  source_reference text,
  location_id uuid,
  variant_id uuid,
  status text not null check (status in ('accepted', 'rejected')),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  raw_data jsonb not null check (jsonb_typeof(raw_data) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, batch_id, row_number),
  foreign key (tenant_id, batch_id) references app.inventory_import_batches (tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id) on delete restrict,
  constraint inventory_import_rows_identifier_present check (
    nullif(btrim(coalesce(sku, '')), '') is not null
    or nullif(btrim(coalesce(barcode, '')), '') is not null
    or status = 'rejected'
  )
);
create index inventory_import_rows_batch_idx
  on app.inventory_import_rows (tenant_id, batch_id, row_number);
create index inventory_import_rows_location_idx
  on app.inventory_import_rows (tenant_id, location_id) where location_id is not null;
create index inventory_import_rows_variant_idx
  on app.inventory_import_rows (tenant_id, variant_id) where variant_id is not null;

alter table app.inventory_import_batches enable row level security;
alter table app.inventory_import_rows enable row level security;
revoke all on table app.inventory_import_batches, app.inventory_import_rows
from public, anon, authenticated, hcs_hyperdrive;

create function app.preview_inventory_import(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_filename text,
  p_cutover_at timestamptz,
  p_rows jsonb,
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
  v_batch_id uuid;
  v_row record;
  v_location_id uuid;
  v_sku_variant_id uuid;
  v_barcode_variant_id uuid;
  v_variant_id uuid;
  v_product_name text;
  v_variant_name text;
  v_default_cost numeric(18, 2);
  v_quantity numeric(18, 3);
  v_unit_cost numeric(18, 2);
  v_reorder numeric(18, 3);
  v_reserved numeric(18, 3);
  v_damaged numeric(18, 3);
  v_in_transit numeric(18, 3);
  v_errors jsonb;
  v_warnings jsonb;
  v_response jsonb;
begin
  if not exists (
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
            and role_permission.permission_code = 'inventory.manage'
        )
      )
  ) then
    raise exception using errcode = 'HCS17', message = 'Inventory management is not allowed';
  end if;

  if not exists (
    select 1 from app.tenant_entitlements entitlement
    join app.features feature on feature.code = entitlement.feature_code
    where entitlement.tenant_id = p_tenant_id and entitlement.feature_code = 'inventory'
      and entitlement.entitled and entitlement.enabled and feature.platform_available
      and (entitlement.starts_at is null or entitlement.starts_at <= now())
      and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) then
    raise exception using errcode = 'HCS18', message = 'Inventory feature is unavailable';
  end if;

  if char_length(btrim(coalesce(p_filename, ''))) not between 1 and 255
    or p_cutover_at is null
    or p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 5000
    or exists (
      select 1 from jsonb_array_elements(p_rows) row_data
      where coalesce(row_data->>'rowNumber', '') !~ '^\d+$'
        or (row_data->>'rowNumber')::integer < 2
    )
  then
    raise exception using errcode = 'HCS30', message = 'Inventory import preview is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':inventory.import.preview:' || p_idempotency_key, 0)
  );
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant_id
    and operation = 'inventory.import.preview'
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = 'HCS08', message = 'Idempotency key conflict';
    end if;
    if v_existing.completed_at is not null then return v_existing.response_body; end if;
  else
    insert into app.idempotency_records (
      tenant_id, operation, idempotency_key, request_hash, locked_until, expires_at
    ) values (
      p_tenant_id, 'inventory.import.preview', p_idempotency_key, p_request_hash,
      now() + interval '1 minute', now() + interval '24 hours'
    );
  end if;

  insert into app.inventory_import_batches (
    tenant_id, filename, cutover_at, content_hash, created_by
  ) values (
    p_tenant_id, btrim(p_filename), p_cutover_at, p_request_hash, p_actor_user_id
  ) returning id into v_batch_id;

  for v_row in
    select row_data, ordinal
    from jsonb_array_elements(p_rows) with ordinality source(row_data, ordinal)
    order by (row_data->>'rowNumber')::integer, ordinal
  loop
    v_location_id := null;
    v_sku_variant_id := null;
    v_barcode_variant_id := null;
    v_variant_id := null;
    v_product_name := null;
    v_variant_name := null;
    v_default_cost := null;
    v_quantity := null;
    v_unit_cost := null;
    v_reorder := null;
    v_reserved := 0;
    v_damaged := 0;
    v_in_transit := 0;
    v_errors := '[]'::jsonb;
    v_warnings := '[]'::jsonb;

    select location.id into v_location_id
    from app.locations location
    where location.tenant_id = p_tenant_id
      and lower(location.code::text) = lower(btrim(coalesce(v_row.row_data->>'branchCode', '')))
      and location.is_active;
    if v_location_id is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'BRANCH_NOT_FOUND', 'field', 'branch_code', 'message', 'Active branch code was not found.'
      ));
    end if;

    if nullif(btrim(coalesce(v_row.row_data->>'sku', '')), '') is not null then
      select variant.id into v_sku_variant_id
      from app.product_variants variant
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      where variant.tenant_id = p_tenant_id
        and lower(variant.sku::text) = lower(btrim(v_row.row_data->>'sku'))
        and variant.is_active and variant.track_inventory and product.status = 'active';
      if v_sku_variant_id is null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'SKU_NOT_FOUND', 'field', 'sku', 'message', 'Active inventory SKU was not found.'
        ));
      end if;
    end if;

    if nullif(btrim(coalesce(v_row.row_data->>'barcode', '')), '') is not null then
      select variant.id into v_barcode_variant_id
      from app.product_barcodes barcode
      join app.product_variants variant
        on variant.tenant_id = barcode.tenant_id and variant.id = barcode.variant_id
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      where barcode.tenant_id = p_tenant_id
        and barcode.barcode::text = btrim(v_row.row_data->>'barcode')
        and variant.is_active and variant.track_inventory and product.status = 'active';
      if v_barcode_variant_id is null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'BARCODE_NOT_FOUND', 'field', 'barcode', 'message', 'Active inventory barcode was not found.'
        ));
      end if;
    end if;

    if nullif(btrim(coalesce(v_row.row_data->>'sku', '')), '') is null
      and nullif(btrim(coalesce(v_row.row_data->>'barcode', '')), '') is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'IDENTIFIER_REQUIRED', 'field', 'sku', 'message', 'Enter an SKU or barcode.'
      ));
    elsif v_sku_variant_id is not null and v_barcode_variant_id is not null
      and v_sku_variant_id <> v_barcode_variant_id then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'IDENTIFIER_MISMATCH', 'field', 'barcode', 'message', 'SKU and barcode resolve to different variants.'
      ));
    else
      v_variant_id := coalesce(v_sku_variant_id, v_barcode_variant_id);
    end if;

    if coalesce(v_row.row_data->>'quantityOnHand', '') !~ '^\d+(?:\.\d{1,3})?$' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_QUANTITY', 'field', 'quantity_on_hand', 'message', 'Quantity must be a non-negative number with up to three decimals.'
      ));
    else
      v_quantity := (v_row.row_data->>'quantityOnHand')::numeric(18, 3);
      if v_quantity = 0 then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'ZERO_QUANTITY', 'field', 'quantity_on_hand', 'message', 'This row has no opening on-hand quantity.'
        ));
      end if;
    end if;

    if nullif(btrim(coalesce(v_row.row_data->>'unitCost', '')), '') is not null then
      if (v_row.row_data->>'unitCost') !~ '^\d+(?:\.\d{1,2})?$' then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'INVALID_UNIT_COST', 'field', 'unit_cost', 'message', 'Unit cost must be non-negative with up to two decimals.'
        ));
      else
        v_unit_cost := (v_row.row_data->>'unitCost')::numeric(18, 2);
      end if;
    end if;

    if v_variant_id is not null then
      select product.name, variant.name, variant.unit_cost
        into v_product_name, v_variant_name, v_default_cost
      from app.product_variants variant
      join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      where variant.tenant_id = p_tenant_id and variant.id = v_variant_id;
      if v_unit_cost is null and v_default_cost is not null then
        v_unit_cost := v_default_cost;
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'DEFAULT_COST_USED', 'field', 'unit_cost', 'message', 'The saved variant cost will be used.'
        ));
      end if;
    end if;
    if coalesce(v_quantity, 0) > 0 and v_unit_cost is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'UNIT_COST_REQUIRED', 'field', 'unit_cost', 'message', 'Unit cost is required for positive opening stock.'
      ));
    end if;

    if nullif(btrim(coalesce(v_row.row_data->>'reorderLevel', '')), '') is not null then
      if (v_row.row_data->>'reorderLevel') !~ '^\d+(?:\.\d{1,3})?$' then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'INVALID_REORDER_LEVEL', 'field', 'reorder_level', 'message', 'Reorder level must be non-negative with up to three decimals.'
        ));
      else v_reorder := (v_row.row_data->>'reorderLevel')::numeric(18, 3); end if;
    end if;

    if nullif(btrim(coalesce(v_row.row_data->>'reservedQuantity', '')), '') is not null then
      if (v_row.row_data->>'reservedQuantity') !~ '^\d+(?:\.\d{1,3})?$' then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'INVALID_RESERVED', 'field', 'reserved_quantity', 'message', 'Reserved quantity is invalid.'
        ));
      else v_reserved := (v_row.row_data->>'reservedQuantity')::numeric(18, 3); end if;
    end if;
    if nullif(btrim(coalesce(v_row.row_data->>'damagedQuantity', '')), '') is not null then
      if (v_row.row_data->>'damagedQuantity') !~ '^\d+(?:\.\d{1,3})?$' then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'INVALID_DAMAGED', 'field', 'damaged_quantity', 'message', 'Damaged quantity is invalid.'
        ));
      else v_damaged := (v_row.row_data->>'damagedQuantity')::numeric(18, 3); end if;
    end if;
    if nullif(btrim(coalesce(v_row.row_data->>'inTransitQuantity', '')), '') is not null then
      if (v_row.row_data->>'inTransitQuantity') !~ '^\d+(?:\.\d{1,3})?$' then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'INVALID_IN_TRANSIT', 'field', 'in_transit_quantity', 'message', 'In-transit quantity is invalid.'
        ));
      else v_in_transit := (v_row.row_data->>'inTransitQuantity')::numeric(18, 3); end if;
    end if;
    if v_quantity is not null and v_damaged is not null and v_reserved is not null
      and v_reserved > greatest(v_quantity - v_damaged, 0) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'RESERVED_EXCEEDS_AVAILABLE', 'field', 'reserved_quantity', 'message', 'Reserved quantity exceeds physical available quantity.'
      ));
    end if;

    if v_location_id is not null and v_variant_id is not null and exists (
      select 1 from app.inventory_movements movement
      where movement.tenant_id = p_tenant_id
        and movement.location_id = v_location_id and movement.variant_id = v_variant_id
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'OPENING_INVENTORY_EXISTS', 'field', 'sku', 'message', 'This branch and variant already has inventory history.'
      ));
    end if;

    insert into app.inventory_import_rows (
      tenant_id, batch_id, row_number, branch_code, sku, barcode,
      quantity_on_hand, unit_cost, reorder_level, reserved_quantity, damaged_quantity, in_transit_quantity,
      source_reference, location_id, variant_id, status, errors, warnings, raw_data
    ) values (
      p_tenant_id, v_batch_id, (v_row.row_data->>'rowNumber')::integer,
      btrim(coalesce(v_row.row_data->>'branchCode', '')),
      nullif(btrim(coalesce(v_row.row_data->>'sku', '')), ''),
      nullif(btrim(coalesce(v_row.row_data->>'barcode', '')), ''),
      v_quantity, v_unit_cost, v_reorder, v_reserved, v_damaged, v_in_transit,
      nullif(btrim(coalesce(v_row.row_data->>'sourceReference', '')), ''),
      v_location_id, v_variant_id,
      case when jsonb_array_length(v_errors) = 0 then 'accepted' else 'rejected' end,
      v_errors, v_warnings, v_row.row_data
    );
  end loop;

  update app.inventory_import_rows candidate
  set status = 'rejected',
      errors = candidate.errors || jsonb_build_array(jsonb_build_object(
        'code', 'DUPLICATE_BRANCH_VARIANT', 'field', 'sku', 'message', 'The batch contains this branch and variant more than once.'
      ))
  where candidate.tenant_id = p_tenant_id and candidate.batch_id = v_batch_id
    and candidate.location_id is not null and candidate.variant_id is not null
    and exists (
      select 1 from app.inventory_import_rows duplicate
      where duplicate.tenant_id = candidate.tenant_id and duplicate.batch_id = candidate.batch_id
        and duplicate.location_id = candidate.location_id and duplicate.variant_id = candidate.variant_id
        and duplicate.id <> candidate.id
    );

  update app.inventory_import_batches batch set
    row_count = summary.row_count,
    accepted_count = summary.accepted_count,
    rejected_count = summary.rejected_count,
    warning_count = summary.warning_count,
    total_quantity = summary.total_quantity,
    total_valuation = summary.total_valuation
  from (
    select count(*)::integer row_count,
      count(*) filter (where status = 'accepted')::integer accepted_count,
      count(*) filter (where status = 'rejected')::integer rejected_count,
      count(*) filter (where jsonb_array_length(warnings) > 0)::integer warning_count,
      coalesce(sum(quantity_on_hand) filter (where status = 'accepted'), 0)::numeric(18,3) total_quantity,
      coalesce(sum(quantity_on_hand * unit_cost) filter (where status = 'accepted'), 0)::numeric(18,2) total_valuation
    from app.inventory_import_rows
    where tenant_id = p_tenant_id and batch_id = v_batch_id
  ) summary
  where batch.tenant_id = p_tenant_id and batch.id = v_batch_id;

  select jsonb_build_object(
    'batchId', batch.id, 'status', batch.status, 'filename', batch.filename, 'cutoverAt', batch.cutover_at,
    'summary', jsonb_build_object(
      'rowCount', batch.row_count, 'acceptedCount', batch.accepted_count,
      'rejectedCount', batch.rejected_count, 'warningCount', batch.warning_count,
      'totalQuantityMilli', round(batch.total_quantity * 1000)::bigint,
      'totalValuationMinor', round(batch.total_valuation * 100)::bigint,
      'branches', coalesce((
        select jsonb_agg(jsonb_build_object(
          'branchCode', branch.branch_code,
          'acceptedCount', branch.accepted_count,
          'rejectedCount', branch.rejected_count,
          'totalQuantityMilli', branch.total_quantity_milli,
          'totalValuationMinor', branch.total_valuation_minor
        ) order by branch.branch_code)
        from (
          select row.branch_code,
            count(*) filter (where row.status = 'accepted')::integer accepted_count,
            count(*) filter (where row.status = 'rejected')::integer rejected_count,
            round(coalesce(sum(row.quantity_on_hand) filter (where row.status = 'accepted'), 0) * 1000)::bigint total_quantity_milli,
            round(coalesce(sum(row.quantity_on_hand * row.unit_cost) filter (where row.status = 'accepted'), 0) * 100)::bigint total_valuation_minor
          from app.inventory_import_rows row
          where row.tenant_id = p_tenant_id and row.batch_id = v_batch_id
          group by row.branch_code
        ) branch
      ), '[]'::jsonb)
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rowNumber', row.row_number, 'branchCode', row.branch_code, 'sku', row.sku, 'barcode', row.barcode,
        'locationId', row.location_id, 'variantId', row.variant_id,
        'productName', product.name, 'variantName', variant.name,
        'quantityOnHandMilli', case when row.quantity_on_hand is null then null else round(row.quantity_on_hand * 1000)::bigint end,
        'unitCostMinor', case when row.unit_cost is null then null else round(row.unit_cost * 100)::bigint end,
        'reorderLevelMilli', case when row.reorder_level is null then null else round(row.reorder_level * 1000)::bigint end,
        'reservedQuantityMilli', case when row.reserved_quantity is null then null else round(row.reserved_quantity * 1000)::bigint end,
        'damagedQuantityMilli', case when row.damaged_quantity is null then null else round(row.damaged_quantity * 1000)::bigint end,
        'inTransitQuantityMilli', case when row.in_transit_quantity is null then null else round(row.in_transit_quantity * 1000)::bigint end,
        'sourceReference', row.source_reference, 'status', row.status, 'errors', row.errors, 'warnings', row.warnings
      ) order by row.row_number)
      from app.inventory_import_rows row
      left join app.product_variants variant on variant.tenant_id = row.tenant_id and variant.id = row.variant_id
      left join app.products product on product.tenant_id = variant.tenant_id and product.id = variant.product_id
      where row.tenant_id = p_tenant_id and row.batch_id = v_batch_id
    ), '[]'::jsonb)
  ) into v_response
  from app.inventory_import_batches batch
  where batch.tenant_id = p_tenant_id and batch.id = v_batch_id;

  insert into audit.audit_events (
    tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_tenant_id, p_request_id, 'tenant_user', p_actor_user_id,
    'inventory.import.previewed', 'inventory_import_batch', v_batch_id,
    jsonb_build_object(
      'filename', btrim(p_filename), 'cutoverAt', p_cutover_at,
      'rowCount', v_response #>> '{summary,rowCount}',
      'acceptedCount', v_response #>> '{summary,acceptedCount}',
      'rejectedCount', v_response #>> '{summary,rejectedCount}'
    )
  );
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (
    p_tenant_id, 'inventory.import.previewed', 'inventory_import_batch', v_batch_id,
    jsonb_build_object(
      'batchId', v_batch_id, 'filename', btrim(p_filename), 'cutoverAt', p_cutover_at,
      'summary', v_response->'summary'
    )
  );

  update app.idempotency_records set
    response_status = 201, response_body = v_response, completed_at = now(), locked_until = null
  where tenant_id = p_tenant_id
    and operation = 'inventory.import.preview'
    and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

revoke all on function app.preview_inventory_import(uuid,uuid,text,timestamptz,jsonb,text,text,text)
from public, anon, authenticated;
grant execute on function app.preview_inventory_import(uuid,uuid,text,timestamptz,jsonb,text,text,text)
to hcs_hyperdrive;

commit;
