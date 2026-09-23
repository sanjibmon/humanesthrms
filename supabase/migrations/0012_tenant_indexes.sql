-- Every RLS policy filters on org_id, so every tenant table needs an index that leads with it. Created here for any
-- table that does not already have one (composite unique keys and explicit indexes are respected).
do $$
declare r record;
begin
  for r in
    select c.relname as tbl, a.attnum as attnum
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
     where ns.nspname = 'public' and c.relkind = 'r'
       and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)
  loop
    execute format('create index %I on public.%I (org_id)', 'idx_' || r.tbl || '_org', r.tbl);
  end loop;
end $$;
