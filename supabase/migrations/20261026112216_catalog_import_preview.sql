begin;
create function app.load_catalog_import_snapshot(p_actor uuid,p_tenant uuid,p_skus text[],p_barcodes text[],p_categories text[])
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform app.lock_catalog_access(p_actor,p_tenant,true);
 if coalesce(cardinality(p_skus),0)>10000 or coalesce(cardinality(p_barcodes),0)>5000 or coalesce(cardinality(p_categories),0)>5000
 then raise exception using errcode='HCS11',message='Import snapshot limit exceeded'; end if;
 return (with target_variants as materialized (
   select v.* from app.product_variants v where v.tenant_id=p_tenant and
   (v.sku=any(p_skus::extensions.citext[]) or exists(select 1 from app.product_barcodes b
    where b.tenant_id=p_tenant and b.variant_id=v.id and b.barcode=any(p_barcodes::extensions.citext[])))
 ) select jsonb_build_object(
 'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'status',c.status) order by c.id),'[]'::jsonb)
   from app.product_categories c where c.tenant_id=p_tenant and lower(btrim(c.name))=any(p_categories)),
 'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,
   'categoryId',p.category_id,'status',p.status,'variants',(
     select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'isActive',v.is_active,'trackInventory',v.track_inventory,
       'barcodes',(select coalesce(jsonb_agg(b.barcode::text order by b.id),'[]'::jsonb) from app.product_barcodes b
       where b.tenant_id=p_tenant and b.variant_id=v.id)) order by v.id),'[]'::jsonb)
     from target_variants v where v.product_id=p.id)) order by p.id),'[]'::jsonb)
   from app.products p where p.tenant_id=p_tenant and exists(select 1 from target_variants v where v.product_id=p.id))));
end;
$$;
revoke all on function app.load_catalog_import_snapshot(uuid,uuid,text[],text[],text[]) from public,anon,authenticated;
grant execute on function app.load_catalog_import_snapshot(uuid,uuid,text[],text[],text[]) to hcs_hyperdrive;
commit;
