create index risk_alerts_acknowledged_by_idx on app.risk_alerts (tenant_id, acknowledged_by)
where acknowledged_by is not null;

create index risk_alerts_resolved_by_idx on app.risk_alerts (tenant_id, resolved_by)
where resolved_by is not null;

create index risk_alerts_dismissed_by_idx on app.risk_alerts (tenant_id, dismissed_by)
where dismissed_by is not null;
