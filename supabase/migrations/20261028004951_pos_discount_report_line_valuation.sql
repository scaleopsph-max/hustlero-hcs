begin;
-- Both existing report readers already scope tenant, branch, channel and business
-- dates before invoking this private helper. Preserve the wholesale/normal path.
alter function app.wholesale_reporting_line_payable(uuid,uuid) rename to reporting_line_payable_before_pos_discount;
revoke all on function app.reporting_line_payable_before_pos_discount(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
create function app.wholesale_reporting_line_payable(p_tenant uuid,p_sale_line uuid)
returns numeric language plpgsql stable security definer set search_path='' as $$
declare v_sale uuid;v_snapshot jsonb;v_net numeric;
begin
 select line.sale_id into v_sale from app.sale_lines line join app.pos_sale_discount_snapshots h
 on h.tenant_id=line.tenant_id and h.sale_id=line.sale_id where line.tenant_id=p_tenant and line.id=p_sale_line;
 if not found then return app.reporting_line_payable_before_pos_discount(p_tenant,p_sale_line); end if;
 begin
  v_snapshot:=app.discount_return_snapshot(p_tenant,v_sale);
 exception when sqlstate 'HCSA7' then raise exception using errcode='HCSD3',message='Original retail discount valuation requires reconciliation'; end;
 select (value->>'netMinor')::numeric/100 into v_net from jsonb_array_elements(v_snapshot->'lines') where value->>'saleLineId'=p_sale_line::text;
 if not found then raise exception using errcode='HCSD3',message='Original retail discount valuation requires reconciliation'; end if;
 return v_net;
end; $$;
revoke all on function app.wholesale_reporting_line_payable(uuid,uuid) from public,anon,authenticated,hcs_hyperdrive;
commit;
