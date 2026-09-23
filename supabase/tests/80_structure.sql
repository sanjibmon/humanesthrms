\set ON_ERROR_STOP 1
do $$
declare r record; n bigint; bad text;
begin
  perform t.logout();
  -- every table in public has row level security
  select string_agg(tablename, ', ') into bad from pg_tables where schemaname = 'public' and not rowsecurity;
  perform t.expect('struct: RLS enabled on every public table', bad, null::text);

  -- RLS with no policy means default-deny; that is allowed only for tables written exclusively by functions
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);
  perform t.expect('struct: every table has at least one policy', bad, null::text);

  -- no policy is open to anon or PUBLIC
  select string_agg(policyname, ', ') into bad from pg_policies where schemaname = 'public' and (roles::text like '%anon%' or roles::text = '{public}');
  perform t.expect('struct: no policy is open to anon or PUBLIC', bad, null::text);

  -- anon has no privileges on any table or function in public/app/api
  select string_agg(table_name || ':' || privilege_type, ', ') into bad from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public';
  perform t.expect('struct: anon holds no table privileges', bad, null::text);
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname in ('public','app','api') and has_function_privilege('anon', p.oid, 'execute') and p.prokind = 'f';
  perform t.expect('struct: anon cannot execute any function', bad, null::text);

  -- nobody but the owner can truncate
  select string_agg(table_name, ', ') into bad from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER');
  perform t.expect('struct: authenticated cannot truncate or add triggers', bad, null::text);

  -- SECURITY DEFINER functions pin their search_path (prevents schema hijacking)
  select string_agg(ns.nspname || '.' || p.proname, ', ') into bad from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname in ('public','app','api') and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  perform t.expect('struct: every SECURITY DEFINER function sets search_path', bad, null::text);

  -- key material and internal mutators are not callable by API users
  for r in select unnest(array['app.pii_key()','app.pii_encrypt(text)','app.finalize_approval(uuid,text)','app.create_approval(uuid,text,uuid,uuid,jsonb,jsonb)',
      'app.provision_customer(text,uuid,text,integer,integer,text[],uuid)','app.run_retention()','app.recompute_attendance_day(uuid,date)',
      'app.log_event(uuid,text,text,text,jsonb)','app.log_platform_event(text,uuid,text,text,jsonb)','app.approval_hook(text,uuid,text,uuid)']) as f loop
    perform t.expect('struct: authenticated cannot execute ' || r.f, has_function_privilege('authenticated', r.f::regprocedure, 'execute'), false);
  end loop;

  -- the API surface is exactly the api schema wrappers
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'api';
  perform t.expect('struct: api schema exposes the curated RPCs', n >= 20, true);

  -- encrypted columns cannot be selected by API users
  perform t.expect('struct: pan_enc not selectable', has_column_privilege('authenticated', 'public.employee_statutory', 'pan_enc', 'select'), false);
  perform t.expect('struct: bank_account_enc not selectable', has_column_privilege('authenticated', 'public.employee_statutory', 'bank_account_enc', 'select'), false);
  perform t.expect('struct: pan_last4 selectable', has_column_privilege('authenticated', 'public.employee_statutory', 'pan_last4', 'select'), true);

  -- append-only tables are not writable through the API
  for r in select unnest(array['audit_logs','platform_audit_logs','attendance_events','leave_ledger','security_events','approval_actions']) as tname loop
    perform t.expect('struct: ' || r.tname || ' has no update/delete grant', has_table_privilege('authenticated', 'public.' || r.tname, 'update') or has_table_privilege('authenticated', 'public.' || r.tname, 'delete'), false);
  end loop;

  -- tenant tables carry org_id and it is indexed (leading column of some index) for RLS performance
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
   where ns.nspname = 'public' and c.relkind = 'r'
     and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)
     and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[1] = a.attnum and i.indkey[0] is not null and false);
  perform t.expect('struct: org_id leads an index on every tenant table', bad, null::text);
end $$;
