-- File storage foundation: tenant-isolated file records for objects kept in Cloudflare R2,
-- product photos shared by Back Office, POS and the Reseller Portal, and reseller payment proofs.
-- The database never stores bytes. Storage keys are derived here from tenant, kind and file id,
-- so the API cannot point a record at another tenant's object.
begin;

create table app.files (
  id uuid primary key,
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  kind text not null check (kind in ('product_image', 'payment_proof')),
  storage_key text not null unique,
  thumb_storage_key text unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  thumb_size_bytes integer check (thumb_size_bytes between 1 and 524288),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  original_filename text not null check (char_length(btrim(original_filename)) between 1 and 200),
  uploaded_by_user_id uuid,
  uploaded_by_reseller_account_id uuid,
  status text not null default 'active' check (status in ('active', 'archived')),
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, uploaded_by_user_id) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, uploaded_by_reseller_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict,
  foreign key (tenant_id, archived_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint files_uploader check (num_nonnulls(uploaded_by_user_id, uploaded_by_reseller_account_id) = 1),
  constraint files_storage_key check (storage_key = 't/' || tenant_id || '/' || kind || '/' || id || '/main'),
  constraint files_thumb_key check (thumb_storage_key is null or thumb_storage_key = 't/' || tenant_id || '/' || kind || '/' || id || '/thumb'),
  constraint files_thumb_pair check ((thumb_storage_key is null) = (thumb_size_bytes is null)),
  constraint files_product_image_shape check (kind <> 'product_image'
    or (mime_type in ('image/jpeg', 'image/png', 'image/webp') and thumb_storage_key is not null and uploaded_by_user_id is not null)),
  constraint files_archive_state check ((status = 'archived') = (archived_at is not null))
);

-- File records are immutable apart from archiving; finalized evidence is never silently changed.
create function app.guard_file_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'files are archived, never deleted'; end if;
  if (new.id, new.tenant_id, new.kind, new.storage_key, new.thumb_storage_key, new.mime_type, new.size_bytes,
      new.thumb_size_bytes, new.sha256, new.original_filename, new.uploaded_by_user_id,
      new.uploaded_by_reseller_account_id, new.created_at)
    is distinct from (old.id, old.tenant_id, old.kind, old.storage_key, old.thumb_storage_key, old.mime_type, old.size_bytes,
      old.thumb_size_bytes, old.sha256, old.original_filename, old.uploaded_by_user_id,
      old.uploaded_by_reseller_account_id, old.created_at)
    or old.status = 'archived' then
    raise exception 'file records are immutable apart from archiving';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_file_mutation() from public, anon, authenticated, hcs_hyperdrive;
create trigger files_guard before update or delete on app.files for each row execute function app.guard_file_mutation();

create table app.product_images (
  tenant_id uuid not null,
  file_id uuid not null,
  product_id uuid not null,
  position integer not null check (position between 0 and 99),
  created_at timestamptz not null default now(),
  primary key (tenant_id, file_id),
  foreign key (tenant_id, file_id) references app.files (tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references app.products (tenant_id, id) on delete restrict
);
create index product_images_product_idx on app.product_images (tenant_id, product_id, position);

create table app.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete restrict,
  sales_order_id uuid not null,
  file_id uuid not null,
  reseller_account_id uuid not null,
  method text not null check (method in ('gcash', 'bank_transfer')),
  amount numeric(18,2) not null check (amount > 0 and amount <= 90071992547409.91),
  reference text not null check (char_length(btrim(reference)) between 4 and 64),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  review_reason text check (review_reason is null or char_length(btrim(review_reason)) between 2 and 500),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, file_id),
  foreign key (tenant_id, sales_order_id) references app.sales_orders (tenant_id, id) on delete restrict,
  foreign key (tenant_id, file_id) references app.files (tenant_id, id) on delete restrict,
  foreign key (tenant_id, reseller_account_id) references app.reseller_accounts (tenant_id, id) on delete restrict,
  foreign key (tenant_id, reviewed_by) references app.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint payment_proofs_review_state check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status = 'accepted' and reviewed_by is not null and reviewed_at is not null)
    or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null and review_reason is not null)
  )
);
create index payment_proofs_order_idx on app.payment_proofs (tenant_id, sales_order_id, created_at);
create index payment_proofs_pending_idx on app.payment_proofs (tenant_id, created_at) where status = 'pending';

alter table app.files enable row level security;
alter table app.product_images enable row level security;
alter table app.payment_proofs enable row level security;
revoke all on app.files, app.product_images, app.payment_proofs from public, anon, authenticated, hcs_hyperdrive;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function app.can_manage_catalog(p_actor uuid, p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.tenant_memberships membership
    where membership.tenant_id = p_tenant and membership.user_id = p_actor and membership.status = 'active'
      and (membership.is_owner or exists (
        select 1 from app.membership_roles membership_role
        join app.role_permissions permission on permission.tenant_id = membership_role.tenant_id
          and permission.role_id = membership_role.role_id
        where membership_role.tenant_id = p_tenant and membership_role.user_id = p_actor
          and permission.permission_code = 'catalog.manage'))
  );
$$;
revoke all on function app.can_manage_catalog(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Validates the metadata the API reports for an object it has just stored.
create function app.validate_file_payload(p_payload jsonb, p_max_bytes integer, p_images_only boolean)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or jsonb_typeof(p_payload->'fileId') is distinct from 'string'
    or coalesce(p_payload->>'mimeType', '') not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    or (p_images_only and p_payload->>'mimeType' = 'application/pdf')
    or jsonb_typeof(p_payload->'sizeBytes') is distinct from 'number'
    or (p_payload->>'sizeBytes')::numeric not between 1 and p_max_bytes
    or (p_payload ? 'thumbSizeBytes' and (jsonb_typeof(p_payload->'thumbSizeBytes') is distinct from 'number'
      or (p_payload->>'thumbSizeBytes')::numeric not between 1 and 524288))
    or coalesce(p_payload->>'sha256', '') !~ '^[0-9a-f]{64}$'
    or char_length(btrim(coalesce(p_payload->>'originalFilename', ''))) not between 1 and 200
  then raise exception using errcode = 'HCFL2', message = 'File details are invalid'; end if;
  perform (p_payload->>'fileId')::uuid;
exception when invalid_text_representation then
  raise exception using errcode = 'HCFL2', message = 'File details are invalid';
end;
$$;
revoke all on function app.validate_file_payload(jsonb, integer, boolean) from public, anon, authenticated, hcs_hyperdrive;

-- Active photos per product, in display order. Storage keys go only to the API, which signs URLs.
create function app.catalog_images_core(p_tenant uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('images', coalesce(jsonb_agg(jsonb_build_object(
    'productId', image.product_id, 'fileId', file.id, 'position', image.position,
    'storageKey', file.storage_key, 'thumbStorageKey', file.thumb_storage_key,
    'variantIds', coalesce((select jsonb_agg(variant.id order by variant.id) from app.product_variants variant
      where variant.tenant_id = image.tenant_id and variant.product_id = image.product_id), '[]'::jsonb)
  ) order by image.product_id, image.position, file.created_at), '[]'::jsonb))
  from app.product_images image
  join app.files file on file.tenant_id = image.tenant_id and file.id = image.file_id and file.status = 'active'
  where image.tenant_id = p_tenant;
$$;
revoke all on function app.catalog_images_core(uuid) from public, anon, authenticated, hcs_hyperdrive;

-- ---------------------------------------------------------------------------
-- Catalog photos (Back Office)
-- ---------------------------------------------------------------------------
create function app.assert_product_image_upload(p_actor uuid, p_tenant uuid, p_product uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_manage_catalog(p_actor, p_tenant) then
    raise exception using errcode = 'HCFL1', message = 'Catalog management is not allowed';
  end if;
  if not exists (select 1 from app.products where tenant_id = p_tenant and id = p_product and status <> 'archived') then
    raise exception using errcode = 'HCFL3', message = 'The product was not found';
  end if;
  if (select count(*) from app.product_images image join app.files file on file.tenant_id = image.tenant_id
      and file.id = image.file_id and file.status = 'active'
      where image.tenant_id = p_tenant and image.product_id = p_product) >= 8 then
    raise exception using errcode = 'HCFL4', message = 'A product can have at most 8 photos';
  end if;
end;
$$;

create function app.record_product_image(
  p_actor uuid, p_tenant uuid, p_product uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing app.idempotency_records%rowtype; v_file uuid; v_position integer; v_response jsonb;
begin
  if coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null then
    raise exception using errcode = 'HCFL2', message = 'File details are invalid';
  end if;
  perform app.validate_file_payload(p_payload, 2621440, true);
  if not (p_payload ? 'thumbSizeBytes') then raise exception using errcode = 'HCFL2', message = 'A thumbnail is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':product-images:' || p_product::text, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'catalog.product_image_upload' and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    return v_existing.response_body;
  end if;
  perform app.assert_product_image_upload(p_actor, p_tenant, p_product);
  v_file := (p_payload->>'fileId')::uuid;
  insert into app.files (id, tenant_id, kind, storage_key, thumb_storage_key, mime_type, size_bytes, thumb_size_bytes,
    sha256, original_filename, uploaded_by_user_id)
  values (v_file, p_tenant, 'product_image', 't/' || p_tenant || '/product_image/' || v_file || '/main',
    't/' || p_tenant || '/product_image/' || v_file || '/thumb', p_payload->>'mimeType', (p_payload->>'sizeBytes')::integer,
    (p_payload->>'thumbSizeBytes')::integer, p_payload->>'sha256', btrim(p_payload->>'originalFilename'), p_actor);
  select coalesce(max(image.position) + 1, 0) into v_position from app.product_images image
  join app.files file on file.tenant_id = image.tenant_id and file.id = image.file_id and file.status = 'active'
  where image.tenant_id = p_tenant and image.product_id = p_product;
  insert into app.product_images (tenant_id, file_id, product_id, position) values (p_tenant, v_file, p_product, v_position);
  v_response := jsonb_build_object('fileId', v_file, 'productId', p_product, 'position', v_position, 'status', 'uploaded');
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'product_image.uploaded', 'product', p_product,
    v_response || jsonb_build_object('sizeBytes', (p_payload->>'sizeBytes')::integer, 'sha256', p_payload->>'sha256'));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'product_image.uploaded', 'product', p_product, v_response);
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'catalog.product_image_upload', p_key, p_hash, 201, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;

-- Rewrites the display order; the first photo is the primary one shown in POS and the portal.
create function app.reorder_product_images(p_actor uuid, p_tenant uuid, p_product uuid, p_file_ids jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_active uuid[]; v_requested uuid[];
begin
  if not app.can_manage_catalog(p_actor, p_tenant) then
    raise exception using errcode = 'HCFL1', message = 'Catalog management is not allowed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':product-images:' || p_product::text, 0));
  begin
    select array_agg(value::uuid order by ordinality) into v_requested
    from jsonb_array_elements_text(case when jsonb_typeof(p_file_ids) = 'array' then p_file_ids else '[]'::jsonb end) with ordinality;
  exception when invalid_text_representation then
    raise exception using errcode = 'HCFL2', message = 'Photo order is invalid';
  end;
  select array_agg(image.file_id order by image.file_id) into v_active from app.product_images image
  join app.files file on file.tenant_id = image.tenant_id and file.id = image.file_id and file.status = 'active'
  where image.tenant_id = p_tenant and image.product_id = p_product;
  if v_requested is null or v_active is null
    or (select array_agg(id order by id) from unnest(v_requested) id) is distinct from v_active then
    raise exception using errcode = 'HCFL2', message = 'Photo order must list every current photo once';
  end if;
  update app.product_images image set position = ordered.ordinality - 1
  from unnest(v_requested) with ordinality ordered(file_id, ordinality)
  where image.tenant_id = p_tenant and image.product_id = p_product and image.file_id = ordered.file_id;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'product_image.reordered', 'product', p_product,
    jsonb_build_object('fileIds', p_file_ids));
  return jsonb_build_object('productId', p_product, 'status', 'reordered', 'primaryFileId', v_requested[1]);
end;
$$;

create function app.archive_product_image(p_actor uuid, p_tenant uuid, p_product uuid, p_file uuid, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_manage_catalog(p_actor, p_tenant) then
    raise exception using errcode = 'HCFL1', message = 'Catalog management is not allowed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':product-images:' || p_product::text, 0));
  update app.files file set status = 'archived', archived_at = now(), archived_by = p_actor
  where file.tenant_id = p_tenant and file.id = p_file and file.status = 'active' and file.kind = 'product_image'
    and exists (select 1 from app.product_images image where image.tenant_id = p_tenant and image.file_id = p_file
      and image.product_id = p_product);
  if not found then raise exception using errcode = 'HCFL3', message = 'The photo was not found'; end if;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'product_image.archived', 'product', p_product,
    jsonb_build_object('fileId', p_file));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'product_image.archived', 'product', p_product, jsonb_build_object('fileId', p_file));
  return jsonb_build_object('productId', p_product, 'fileId', p_file, 'status', 'archived');
end;
$$;

-- Image readers for each kind of caller. Each verifies its caller before returning storage keys.
create function app.list_catalog_images_for_member(p_actor uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from app.tenant_memberships where tenant_id = p_tenant and user_id = p_actor and status = 'active') then
    raise exception using errcode = 'HCFL1', message = 'Catalog access is not allowed';
  end if;
  return app.catalog_images_core(p_tenant);
end;
$$;

create function app.list_catalog_images_for_pos(p_session_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select session.tenant_id into v_tenant from app.pos_employee_sessions session
  join app.pos_devices device on device.tenant_id = session.tenant_id and device.id = session.device_id and device.status = 'active'
  where session.token_hash = p_session_token_hash and session.revoked_at is null and session.expires_at > now();
  if v_tenant is null then raise exception using errcode = 'HCFL1', message = 'POS session is not active'; end if;
  return app.catalog_images_core(v_tenant);
end;
$$;

create function app.list_catalog_images_for_reseller(p_auth_user uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.resolve_reseller_account(p_auth_user, p_tenant);
  return app.catalog_images_core(p_tenant);
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment proofs (Reseller Portal)
-- ---------------------------------------------------------------------------
create function app.assert_payment_proof_upload(p_auth_user uuid, p_tenant uuid, p_order uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_account app.reseller_accounts%rowtype; v_order app.sales_orders%rowtype;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  select * into v_order from app.sales_orders where tenant_id = p_tenant and id = p_order and customer_id = v_account.customer_id;
  if not found then raise exception using errcode = 'HCFL3', message = 'The order was not found'; end if;
  if v_order.status not in ('submitted', 'confirmed', 'partially_fulfilled', 'fulfilled') then
    raise exception using errcode = 'HCFL5', message = 'Payment proof is not accepted for this order';
  end if;
  if (select count(*) from app.payment_proofs where tenant_id = p_tenant and sales_order_id = p_order and status = 'pending') >= 5 then
    raise exception using errcode = 'HCFL4', message = 'Wait for the pending proofs to be checked first';
  end if;
end;
$$;

create function app.record_payment_proof(
  p_auth_user uuid, p_tenant uuid, p_order uuid, p_payload jsonb, p_key text, p_hash text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_account app.reseller_accounts%rowtype; v_order app.sales_orders%rowtype; v_existing app.idempotency_records%rowtype;
  v_file uuid; v_proof uuid; v_amount numeric; v_method text; v_response jsonb;
begin
  v_account := app.resolve_reseller_account(p_auth_user, p_tenant);
  if coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' or nullif(p_hash, '') is null
    or jsonb_typeof(p_payload->'amountMinor') is distinct from 'number'
    or char_length(btrim(coalesce(p_payload->>'reference', ''))) not between 4 and 64
    or coalesce(p_payload->>'method', '') not in ('gcash', 'bank_transfer') then
    raise exception using errcode = 'HCFL2', message = 'Payment proof details are invalid';
  end if;
  perform app.validate_file_payload(p_payload - 'amountMinor' - 'reference' - 'method', 5242880, false);
  v_amount := (p_payload->>'amountMinor')::numeric;
  if v_amount <> trunc(v_amount) or v_amount < 1 or v_amount > 9007199254740991 then
    raise exception using errcode = 'HCFL2', message = 'Payment proof details are invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':payment-proofs:' || p_order::text, 0));
  select * into v_existing from app.idempotency_records
  where tenant_id = p_tenant and operation = 'reseller_portal.payment_proof:' || v_account.id::text and idempotency_key = p_key;
  if found then
    if v_existing.request_hash <> p_hash then raise exception using errcode = 'HCS08', message = 'Idempotency key conflict'; end if;
    return v_existing.response_body;
  end if;
  perform app.assert_payment_proof_upload(p_auth_user, p_tenant, p_order);
  select * into v_order from app.sales_orders where tenant_id = p_tenant and id = p_order;
  v_method := p_payload->>'method';
  v_file := (p_payload->>'fileId')::uuid;
  insert into app.files (id, tenant_id, kind, storage_key, thumb_storage_key, mime_type, size_bytes, thumb_size_bytes,
    sha256, original_filename, uploaded_by_reseller_account_id)
  values (v_file, p_tenant, 'payment_proof', 't/' || p_tenant || '/payment_proof/' || v_file || '/main',
    case when p_payload ? 'thumbSizeBytes' then 't/' || p_tenant || '/payment_proof/' || v_file || '/thumb' end,
    p_payload->>'mimeType', (p_payload->>'sizeBytes')::integer, (p_payload->>'thumbSizeBytes')::integer,
    p_payload->>'sha256', btrim(p_payload->>'originalFilename'), v_account.id);
  insert into app.payment_proofs (tenant_id, sales_order_id, file_id, reseller_account_id, method, amount, reference)
  values (p_tenant, p_order, v_file, v_account.id, v_method, v_amount / 100, btrim(p_payload->>'reference'))
  returning id into v_proof;
  v_response := jsonb_build_object('proofId', v_proof, 'fileId', v_file, 'salesOrderId', p_order, 'status', 'pending',
    'amountMinor', v_amount::bigint, 'method', v_method);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'system', v_account.id, 'payment_proof.submitted', 'sales_order', p_order,
    v_response || jsonb_build_object('actorKind', 'reseller', 'resellerAccountId', v_account.id,
      'orderNumber', v_order.order_number::text, 'fileId', v_file, 'sha256', p_payload->>'sha256'));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'payment_proof.submitted', 'sales_order', p_order, v_response);
  insert into app.idempotency_records (tenant_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at, expires_at)
  values (p_tenant, 'reseller_portal.payment_proof:' || v_account.id::text, p_key, p_hash, 201, v_response, now(), now() + interval '24 hours');
  return v_response;
end;
$$;

-- Verification only: an accepted proof does not post money. Payments are still recorded through the
-- audited wholesale payment and paid-fulfillment commands, using the proof's reference.
create function app.review_payment_proof(p_actor uuid, p_tenant uuid, p_proof uuid, p_payload jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_proof app.payment_proofs%rowtype; v_decision text := p_payload->>'decision';
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), ''); v_response jsonb;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if coalesce(v_decision, '') not in ('accept', 'reject') or (v_decision = 'reject' and v_reason is null)
    or (v_reason is not null and char_length(v_reason) not between 2 and 500) then
    raise exception using errcode = 'HCRP3', message = 'Review decision is invalid';
  end if;
  select * into v_proof from app.payment_proofs where tenant_id = p_tenant and id = p_proof for update;
  if not found then raise exception using errcode = 'HCRA4', message = 'The payment proof was not found'; end if;
  if v_proof.status <> 'pending' then raise exception using errcode = 'HCRA5', message = 'The payment proof was already reviewed'; end if;
  update app.payment_proofs set status = case when v_decision = 'accept' then 'accepted' else 'rejected' end,
    review_reason = v_reason, reviewed_by = p_actor, reviewed_at = now()
  where tenant_id = p_tenant and id = p_proof;
  v_response := jsonb_build_object('proofId', p_proof, 'salesOrderId', v_proof.sales_order_id,
    'status', case when v_decision = 'accept' then 'accepted' else 'rejected' end);
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, reason, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'payment_proof.' || (v_response->>'status'), 'sales_order',
    v_proof.sales_order_id, v_reason, v_response || jsonb_build_object('reference', v_proof.reference,
      'amountMinor', round(v_proof.amount * 100)::bigint));
  insert into integration.event_outbox (tenant_id, topic, aggregate_type, aggregate_id, payload)
  values (p_tenant, 'payment_proof.' || (v_response->>'status'), 'sales_order', v_proof.sales_order_id, v_response);
  return v_response;
end;
$$;

-- Proofs attached to an order, with storage keys for the API to sign.
create function app.payment_proofs_json(p_tenant uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', proof.id, 'method', proof.method, 'amountMinor', round(proof.amount * 100)::bigint,
    'reference', proof.reference, 'status', proof.status, 'reviewReason', proof.review_reason,
    'createdAt', proof.created_at, 'reviewedAt', proof.reviewed_at,
    'mimeType', file.mime_type, 'storageKey', file.storage_key, 'thumbStorageKey', file.thumb_storage_key
  ) order by proof.created_at, proof.id), '[]'::jsonb)
  from app.payment_proofs proof
  join app.files file on file.tenant_id = proof.tenant_id and file.id = proof.file_id
  where proof.tenant_id = p_tenant and proof.sales_order_id = p_order;
$$;
revoke all on function app.payment_proofs_json(uuid, uuid) from public, anon, authenticated, hcs_hyperdrive;

-- Portal and review-queue orders now carry their payment proofs.
create or replace function app.reseller_order_json(p_tenant uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'orderNumber', o.order_number::text, 'status', o.status, 'source', o.source,
    'reviewReason', o.review_reason, 'reviewDecisionReason', o.review_decision_reason,
    'fulfillmentMethod', o.fulfillment_method, 'deliveryAddress', o.delivery_address,
    'paymentPreference', o.payment_preference, 'notes', o.notes,
    'customerId', o.customer_id, 'customerName', coalesce(o.customer_name_snapshot, customer.full_name),
    'customerNumber', coalesce(o.customer_number_snapshot, customer.customer_number::text),
    'locationName', location.name,
    'totalMinor', round(o.total * 100)::bigint, 'createdAt', o.created_at, 'confirmedAt', o.confirmed_at,
    'cancelledAt', o.cancelled_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
      'id', line.id, 'variantId', line.variant_id, 'productName', line.product_name_snapshot,
      'variantName', line.variant_name_snapshot, 'sku', line.sku_snapshot,
      'orderedQuantityMilli', round(line.ordered_quantity * 1000)::bigint,
      'fulfilledQuantityMilli', round(line.fulfilled_quantity * 1000)::bigint,
      'cancelledQuantityMilli', round(line.cancelled_quantity * 1000)::bigint,
      'unitPriceMinor', round(line.unit_price * 100)::bigint, 'lineTotalMinor', round(line.line_total * 100)::bigint,
      'stockStatus', app.reseller_stock_status(o.tenant_id, o.location_id, line.variant_id)
    ) order by line.product_name_snapshot, line.variant_name_snapshot, line.id)
      from app.sales_order_lines line where line.tenant_id = o.tenant_id and line.sales_order_id = o.id), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object(
      'id', invoice.id, 'invoiceNumber', invoice.invoice_number::text,
      'totalMinor', round(invoice.total * 100)::bigint, 'issuedAt', invoice.issued_at
    ) order by invoice.issued_at, invoice.id)
      from app.invoices invoice where invoice.tenant_id = o.tenant_id and invoice.sales_order_id = o.id), '[]'::jsonb),
    'paymentProofs', app.payment_proofs_json(o.tenant_id, o.id)
  )
  from app.sales_orders o
  join app.customers customer on customer.tenant_id = o.tenant_id and customer.id = o.customer_id
  join app.locations location on location.tenant_id = o.tenant_id and location.id = o.location_id
  where o.tenant_id = p_tenant and o.id = p_order;
$$;

-- Back Office: pending proofs across all portal orders, oldest first.
create function app.list_pending_payment_proofs(p_actor uuid, p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  return jsonb_build_object('proofs', coalesce((select jsonb_agg(jsonb_build_object(
    'id', proof.id, 'salesOrderId', o.id, 'orderNumber', o.order_number::text, 'orderStatus', o.status,
    'orderTotalMinor', round(o.total * 100)::bigint,
    'customerName', coalesce(o.customer_name_snapshot, customer.full_name),
    'method', proof.method, 'amountMinor', round(proof.amount * 100)::bigint, 'reference', proof.reference,
    'createdAt', proof.created_at, 'mimeType', file.mime_type,
    'storageKey', file.storage_key, 'thumbStorageKey', file.thumb_storage_key
  ) order by proof.created_at, proof.id)
    from app.payment_proofs proof
    join app.files file on file.tenant_id = proof.tenant_id and file.id = proof.file_id
    join app.sales_orders o on o.tenant_id = proof.tenant_id and o.id = proof.sales_order_id
    join app.customers customer on customer.tenant_id = o.tenant_id and customer.id = o.customer_id
    where proof.tenant_id = p_tenant and proof.status = 'pending'), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: only the API role may execute public entry points.
-- ---------------------------------------------------------------------------
revoke all on function app.assert_product_image_upload(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app.record_product_image(uuid, uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function app.reorder_product_images(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function app.archive_product_image(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function app.list_catalog_images_for_member(uuid, uuid) from public, anon, authenticated;
revoke all on function app.list_catalog_images_for_pos(text) from public, anon, authenticated;
revoke all on function app.list_catalog_images_for_reseller(uuid, uuid) from public, anon, authenticated;
revoke all on function app.assert_payment_proof_upload(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app.record_payment_proof(uuid, uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function app.review_payment_proof(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function app.list_pending_payment_proofs(uuid, uuid) from public, anon, authenticated;

grant execute on function app.assert_product_image_upload(uuid, uuid, uuid) to hcs_hyperdrive;
grant execute on function app.record_product_image(uuid, uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;
grant execute on function app.reorder_product_images(uuid, uuid, uuid, jsonb, text) to hcs_hyperdrive;
grant execute on function app.archive_product_image(uuid, uuid, uuid, uuid, text) to hcs_hyperdrive;
grant execute on function app.list_catalog_images_for_member(uuid, uuid) to hcs_hyperdrive;
grant execute on function app.list_catalog_images_for_pos(text) to hcs_hyperdrive;
grant execute on function app.list_catalog_images_for_reseller(uuid, uuid) to hcs_hyperdrive;
grant execute on function app.assert_payment_proof_upload(uuid, uuid, uuid) to hcs_hyperdrive;
grant execute on function app.record_payment_proof(uuid, uuid, uuid, jsonb, text, text, text) to hcs_hyperdrive;
grant execute on function app.review_payment_proof(uuid, uuid, uuid, jsonb, text) to hcs_hyperdrive;
grant execute on function app.list_pending_payment_proofs(uuid, uuid) to hcs_hyperdrive;

commit;
