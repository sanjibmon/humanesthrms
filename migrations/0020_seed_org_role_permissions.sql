-- 0020_seed_org_role_permissions.sql
--
-- Every RLS policy on customer data goes through app.can(org, perm), which reads
-- org_role_permissions. Nothing ever populated that table for a new customer, so
-- a freshly provisioned organisation granted its own owner exactly nothing:
-- every insert and update in the customer portal failed the WITH CHECK clause.
-- The template had been sitting in default_org_role_permissions, unused.
--
-- Seeded by a trigger rather than inside api.create_customer so that every route
-- into the table is covered — the RPC, a manual insert, a future import.

create or replace function app.seed_org_role_permissions(p_org uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  insert into public.org_role_permissions (org_id, role, permission)
  select p_org, d.role, d.permission from public.default_org_role_permissions d
  on conflict (org_id, role, permission) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

comment on function app.seed_org_role_permissions(uuid) is
  'Copies default_org_role_permissions into one organisation. Idempotent.';

create or replace function app.organizations_seed_roles()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.seed_org_role_permissions(new.id);
  return new;
end $$;

drop trigger if exists organizations_seed_roles on public.organizations;
create trigger organizations_seed_roles
  after insert on public.organizations
  for each row execute function app.organizations_seed_roles();

-- Backfill every organisation created before the trigger existed.
select app.seed_org_role_permissions(id) from public.organizations;
