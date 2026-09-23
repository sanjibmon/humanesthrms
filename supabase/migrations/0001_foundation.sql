-- HumaNest HRMS: foundation
-- Portable PostgreSQL 15+. Everything Supabase-specific is isolated in 0100_supabase_glue.sql so the
-- same migrations run unchanged on a dedicated PostgreSQL server later.
--
-- Conventions
--   * Every tenant table carries org_id and has row level security ON.
--   * Helper functions live in schema "app" (never exposed through the REST API).
--   * Money is numeric(14,2) in rupees. Timestamps are timestamptz (stored UTC, shown in Asia/Kolkata).
--   * Text + CHECK is used instead of enum types so a value can be added without a table rewrite.

-- pgcrypto lives in its own schema so its functions are never exposed as API endpoints. Always call them qualified.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
comment on schema app is 'Internal helpers used by RLS policies and triggers. Not exposed via the API.';

-- ---------------------------------------------------------------------------------------------
-- Identity helpers. Supabase sets request.jwt.claims for every request; a dedicated API layer can
-- do the same with set_config() so RLS keeps working after migration off Supabase.
-- ---------------------------------------------------------------------------------------------
create or replace function app.jwt_claim(k text) returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.' || k, true), ''),
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> k, '')
  )
$$;

create or replace function app.uid() returns uuid
language sql stable as $$
  select nullif(app.jwt_claim('sub'), '')::uuid
$$;

-- True when the session passed multi-factor authentication (Supabase AAL2). Sensitive tables demand it.
create or replace function app.aal2() returns boolean
language sql stable as $$
  select coalesce(app.jwt_claim('aal') = 'aal2', false)
$$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Tamper-evident audit trail. Each row stores the hash of the previous row for the same chain
-- key, so deleting or editing history breaks the chain and is detectable (see app.verify_audit_chain).
-- ---------------------------------------------------------------------------------------------
create or replace function app.audit_chain() returns trigger
language plpgsql as $$
declare
  prev text;
  chain_key text;
begin
  chain_key := coalesce(new.org_id::text, 'platform');
  perform pg_advisory_xact_lock(hashtext('audit:' || chain_key));
  if tg_table_name = 'platform_audit_logs' then
    select row_hash into prev from public.platform_audit_logs order by seq desc limit 1;
  else
    select row_hash into prev from public.audit_logs where org_id = new.org_id order by seq desc limit 1;
  end if;
  new.prev_hash := coalesce(prev, repeat('0', 64));
  new.row_hash := encode(
    extensions.digest(
      new.prev_hash || coalesce(new.actor_id::text, '') || new.action || coalesce(new.entity_type, '') ||
      coalesce(new.entity_id, '') || coalesce(new.detail::text, '') || new.created_at::text,
      'sha256'),
    'hex');
  return new;
end $$;

-- Immutable: audit rows can be inserted, never updated or deleted, not even by table owners' triggers.
create or replace function app.deny_modification() returns trigger
language plpgsql as $$
begin
  raise exception 'Table % is append-only', tg_table_name using errcode = '42501';
end $$;

-- Shared domains keep CHECKs consistent across tables.
create domain app.state_code as text check (value ~ '^[A-Z]{2}$');
