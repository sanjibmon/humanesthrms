-- 0014_pin_function_search_path.sql
-- Supabase's security advisor flags any function without an explicit search_path
-- (function_search_path_mutable). This pins every function in the app and api
-- schemas. After this migration the advisors return zero lints.

do $$
declare r record;
begin
  for r in
    select n.nspname as sch, p.proname as fn,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('app','api')
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
       )
  loop
    execute format('alter function %I.%I(%s) set search_path = public, pg_temp', r.sch, r.fn, r.args);
  end loop;
end $$;
