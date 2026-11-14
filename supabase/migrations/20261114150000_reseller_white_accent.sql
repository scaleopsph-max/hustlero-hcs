-- A white accent for reseller portals (owner request 2026-11-14), for brands whose look is black and white.
begin;

alter table app.reseller_portal_settings drop constraint reseller_portal_settings_brand_accent_check;
alter table app.reseller_portal_settings add constraint reseller_portal_settings_brand_accent_check
  check (brand_accent in ('gold', 'emerald', 'sky', 'rose', 'violet', 'orange', 'white'));

CREATE OR REPLACE FUNCTION app.save_reseller_portal_branding(p_actor uuid, p_tenant uuid, p_payload jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_name text := nullif(btrim(coalesce(p_payload->>'portalName', '')), ''); v_previous uuid;
begin
  perform app.assert_reseller_portal_admin(p_actor, p_tenant);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('portalName', 'accentColor', 'removeLogo'))
    or jsonb_typeof(p_payload->'portalName') not in ('string', 'null')
    or coalesce(p_payload->>'accentColor', '') not in ('gold', 'emerald', 'sky', 'rose', 'violet', 'orange', 'white')
    or (p_payload ? 'removeLogo' and jsonb_typeof(p_payload->'removeLogo') is distinct from 'boolean')
    or (v_name is not null and char_length(v_name) not between 2 and 60) then
    raise exception using errcode = 'HCRP3', message = 'Branding details are invalid';
  end if;
  select brand_logo_file_id into v_previous from app.reseller_portal_settings where tenant_id = p_tenant for update;
  if not found then raise exception using errcode = 'HCRP2', message = 'The reseller portal is not configured'; end if;
  update app.reseller_portal_settings set brand_name = v_name, brand_accent = p_payload->>'accentColor',
    brand_logo_file_id = case when coalesce((p_payload->>'removeLogo')::boolean, false) then null else brand_logo_file_id end,
    updated_by = p_actor
  where tenant_id = p_tenant;
  if coalesce((p_payload->>'removeLogo')::boolean, false) and v_previous is not null then
    update app.files set status = 'archived', archived_at = now(), archived_by = p_actor
    where tenant_id = p_tenant and id = v_previous and status = 'active';
  end if;
  insert into audit.audit_events (tenant_id, request_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, p_request_id, 'tenant_user', p_actor, 'reseller_portal.branding_saved', 'tenant', p_tenant,
    jsonb_build_object('portalName', v_name, 'accentColor', p_payload->>'accentColor',
      'removeLogo', coalesce((p_payload->>'removeLogo')::boolean, false)));
  return app.reseller_branding_json(p_tenant);
end;
$function$;

commit;
