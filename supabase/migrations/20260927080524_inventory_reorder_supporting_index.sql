begin;

create index inventory_reorder_policies_variant_idx
  on app.inventory_reorder_policies (tenant_id, variant_id);

commit;
