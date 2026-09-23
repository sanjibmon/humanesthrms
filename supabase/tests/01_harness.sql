-- Tiny test harness: impersonate a Supabase user (role + JWT claims) and record assertions.
create schema if not exists t;
create table if not exists t.results (n serial, name text, ok boolean, detail text);
grant usage on schema t to authenticated, anon;
grant all on t.results to authenticated, anon;
grant usage on sequence t.results_n_seq to authenticated, anon;

create or replace function t.login(u uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'aal', aal, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;

create or replace function t.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;

create or replace function t.expect(nm text, actual anyelement, expected anyelement) returns void language plpgsql as $$
begin
  insert into t.results (name, ok, detail)
  values (nm, actual is not distinct from expected, case when actual is not distinct from expected then null else format('expected %s got %s', expected, actual) end);
end $$;

-- Run a query returning one row-count as the current role.
create or replace function t.count(q text) returns bigint language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from (' || q || ') x' into n; return n; end $$;

-- Expect the statement to fail (optionally with a message fragment).
create or replace function t.throws(nm text, stmt text, frag text default null) returns void language plpgsql as $$
begin
  execute stmt;
  insert into t.results (name, ok, detail) values (nm, false, 'expected an error but statement succeeded');
exception when others then
  if frag is null or sqlerrm ilike '%' || frag || '%' then
    insert into t.results (name, ok, detail) values (nm, true, null);
  else
    insert into t.results (name, ok, detail) values (nm, false, 'wrong error: ' || sqlerrm);
  end if;
end $$;

-- Expect the statement to succeed.
create or replace function t.works(nm text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  insert into t.results (name, ok, detail) values (nm, true, null);
exception when others then
  insert into t.results (name, ok, detail) values (nm, false, 'unexpected error: ' || sqlerrm);
end $$;

-- Number of rows an INSERT/UPDATE/DELETE actually touched (RLS hides rows silently on UPDATE/DELETE).
create or replace function t.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin execute stmt; get diagnostics n = row_count; return n; end $$;

grant execute on all functions in schema t to authenticated, anon;
