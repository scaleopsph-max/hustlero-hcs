begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('app', 'audit', 'integration', 'platform', 'reporting')
      and relation.relkind in ('r', 'p')
      and not relation.relrowsecurity
  ),
  'all private business tables keep RLS enabled'
);

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('app', 'audit', 'integration', 'platform', 'reporting')
      and relation.relkind in ('r', 'p')
      and has_table_privilege('anon', relation.oid, 'select,insert,update,delete')
  ),
  'anonymous browser role has no private table DML'
);

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('app', 'audit', 'integration', 'platform', 'reporting')
      and relation.relkind in ('r', 'p')
      and has_table_privilege('authenticated', relation.oid, 'select,insert,update,delete')
  ),
  'authenticated browser role has no private table DML'
);

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('app', 'audit', 'integration', 'platform', 'reporting')
      and relation.relkind in ('r', 'p')
      and has_table_privilege('hcs_hyperdrive', relation.oid, 'select,insert,update,delete')
  ),
  'Hyperdrive API role has no direct private table DML'
);

select ok(
  not exists (
    select 1
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname in ('app', 'audit', 'integration', 'platform', 'reporting')
      and function.prosecdef
      and has_function_privilege('public', function.oid, 'execute')
  ),
  'PUBLIC cannot execute private security-definer functions'
);

select ok(
  not exists (
    select 1
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname in ('app', 'audit', 'integration', 'platform', 'reporting')
      and function.prosecdef
      and has_function_privilege('anon', function.oid, 'execute')
  ),
  'anonymous browser role cannot execute private security-definer functions'
);

select ok(
  not exists (
    select 1
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname in ('app', 'audit', 'integration', 'platform', 'reporting')
      and function.prosecdef
      and has_function_privilege('authenticated', function.oid, 'execute')
  ),
  'authenticated browser role cannot execute private security-definer functions'
);

select ok(
  not has_function_privilege(
    'hcs_hyperdrive',
    'app.complete_pos_cash_sale(text,jsonb,bigint,text,text,text)',
    'execute'
  ),
  'Hyperdrive cannot execute the legacy POS sale command that bypasses cutover'
);

select ok(
  has_function_privilege(
    'hcs_hyperdrive',
    'app.complete_pos_cash_sale_with_customer(text,jsonb,bigint,uuid,text,text,text)',
    'execute'
  ),
  'Hyperdrive can execute the cutover-gated POS sale command'
);

select is(
  (select count(*)::integer from pg_policies where schemaname in ('app', 'audit', 'integration', 'platform', 'reporting')),
  13,
  'only the reviewed private-schema RLS policies are present'
);

select * from finish();
rollback;
