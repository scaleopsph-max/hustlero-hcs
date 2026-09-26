begin;

create index platform_support_access_granted_by_idx
  on platform.support_access_grants (granted_by, created_at desc, id);
create index platform_support_access_revoked_by_idx
  on platform.support_access_grants (revoked_by, revoked_at desc, id)
  where revoked_by is not null;

commit;
