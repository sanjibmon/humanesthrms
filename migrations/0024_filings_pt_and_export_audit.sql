-- Two additions to the filing register.
--
-- 1. Professional tax and the ESI return. generate_filings created PF, ESI
--    challan and TDS rows but no PT return, even though payroll deducts
--    professional tax every month. PT is a state tax: the return is filed per
--    state, so one row per state the organisation actually has people in, not
--    one for the organisation.
--
--    The due date is the 20th of the following month, which is the most common,
--    and the row carries a note saying so, because the real date varies by
--    state -- Maharashtra, Karnataka and West Bengal do not agree. Guessing
--    silently would be worse than guessing out loud.
--
--    LWF is deliberately not generated at all: it is half-yearly in some states
--    and annual in others, and inventing a monthly row would create twelve
--    fictitious obligations. It is added by hand from the Compliance screen.
--
-- 2. An audit row when a filing file is exported, so a bulk PAN reveal for Form
--    16 or 24Q leaves a trace that names the filing.

create or replace function app.generate_filings(p_org uuid, p_month text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  ent uuid; y int := substr(p_month, 1, 4)::int; m int := substr(p_month, 6, 2)::int;
  n integer := 0; k integer;
  nxt date := (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date;
  q text; qdue date;
begin
  if not app.can_mfa(p_org, 'compliance.file') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select id into ent from public.legal_entities where org_id = p_org and is_default limit 1;

  insert into public.statutory_filings (org_id, entity_id, filing_type, period, due_date) values
    (p_org, ent, 'pf_challan', p_month, make_date(extract(year from nxt)::int, extract(month from nxt)::int, 15)),
    (p_org, ent, 'pf_ecr',     p_month, make_date(extract(year from nxt)::int, extract(month from nxt)::int, 15)),
    (p_org, ent, 'esi_challan',p_month, make_date(extract(year from nxt)::int, extract(month from nxt)::int, 15)),
    (p_org, ent, 'esi_return', p_month, make_date(extract(year from nxt)::int, extract(month from nxt)::int, 15)),
    (p_org, ent, 'tds_challan',p_month, case when m = 3 then make_date(y, 4, 30)
                                             else make_date(extract(year from nxt)::int, extract(month from nxt)::int, 7) end)
  on conflict do nothing;
  get diagnostics k = row_count; n := n + k;

  insert into public.statutory_filings (org_id, entity_id, filing_type, state_code, period, due_date, notes)
  select distinct p_org, ent, 'pt_return', st, p_month,
         make_date(extract(year from nxt)::int, extract(month from nxt)::int, 20),
         'Due date shown is the 20th of the following month, which is the most common. Confirm the date this state actually uses before filing.'
    from (
      select coalesce(l.state_code, le.state_code) as st
        from public.employees e
        left join public.locations l on l.id = e.location_id
        left join public.legal_entities le on le.id = e.entity_id
       where e.org_id = p_org and e.status in ('active','on_notice','exited')
    ) s
   where st is not null
  on conflict do nothing;
  get diagnostics k = row_count; n := n + k;

  if m in (6, 9, 12, 3) then
    q := case m when 6 then 'Q1' when 9 then 'Q2' when 12 then 'Q3' else 'Q4' end;
    qdue := case m when 6 then make_date(y, 7, 31) when 9 then make_date(y, 10, 31)
                   when 12 then make_date(y + 1, 1, 31) else make_date(y, 5, 31) end;
    insert into public.statutory_filings (org_id, entity_id, filing_type, period, due_date)
    values (p_org, ent, 'tds_return',
            'FY' || (case when m = 3 then y - 1 else y end) || '-' ||
            right(((case when m = 3 then y else y + 1 end))::text, 2) || '-' || q, qdue)
    on conflict do nothing;
    get diagnostics k = row_count; n := n + k;
  end if;

  if m = 3 then
    insert into public.statutory_filings (org_id, entity_id, filing_type, period, due_date)
    values (p_org, ent, 'form16', 'FY' || (y - 1) || '-' || right(y::text, 2), make_date(y, 6, 15))
    on conflict do nothing;
    get diagnostics k = row_count; n := n + k;
  end if;

  return n;
end $$;

create or replace function app.note_filing_export(p_org uuid, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not app.can_mfa(p_org, 'compliance.read') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform app.log_event(p_org, 'compliance.export', 'statutory_filings',
                        coalesce(p_detail ->> 'filingId', ''), p_detail);
end $$;

create or replace function api.note_filing_export(p_org uuid, p_detail jsonb)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.note_filing_export(p_org, p_detail) $$;

revoke all on function api.note_filing_export(uuid, jsonb) from public;
grant execute on function api.note_filing_export(uuid, jsonb) to authenticated;
