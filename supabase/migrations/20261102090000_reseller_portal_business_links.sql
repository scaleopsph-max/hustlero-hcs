-- Business links for the reseller portal: until a business names its portal, it is called
-- "<business> Reseller", the name resellers see on the sign-in page, in the portal, and on the
-- installed app. Owner direction 2026-11-02.
begin;

create or replace function app.reseller_branding_json(p_tenant uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'portalName', coalesce(s.brand_name, t.name || ' Reseller'),
    'businessName', t.name,
    'accentColor', coalesce(s.brand_accent, 'gold'),
    'logoStorageKey', (select f.storage_key from app.files f where f.tenant_id = s.tenant_id and f.id = s.brand_logo_file_id
      and f.status = 'active'))
  from app.tenants t left join app.reseller_portal_settings s on s.tenant_id = t.id
  where t.id = p_tenant;
$$;
revoke all on function app.reseller_branding_json(uuid) from public, anon, authenticated, hcs_hyperdrive;

commit;
