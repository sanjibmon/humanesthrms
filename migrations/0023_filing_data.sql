-- Statutory filings need per-employee detail that no single table holds: the
-- identifiers live on employee_statutory (UAN, ESI IP number, PAN), the money
-- lives inside pay_run_items.payload, and the establishment codes live on
-- legal_entities. This gathers them.
--
-- Two rules it will not bend:
--
--   Only runs in status locked or paid are read. A computed or approved run can
--   still change, and a return filed off figures that later moved is a revised
--   return, a penalty, and a conversation with an inspector.
--
--   Form 16 and 24Q genuinely need the full PAN, so the function decrypts it,
--   but only for those two filing types and only when the caller holds
--   pii.reveal at AAL2. A caller with compliance.read alone still gets a
--   complete, usable file with masked PANs and is told why. A bulk decrypt
--   hidden behind a download button would quietly undo the permission that
--   exists to stop exactly this.

create or replace function app.filing_data(
  p_org uuid,
  p_type text,
  p_period text,
  p_entity uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  months text[];
  ent public.legal_entities%rowtype;
  org_row public.organizations%rowtype;
  rows jsonb := '[]'::jsonb;
  totals jsonb;
  fy_start int;
  q text;
  reveal boolean;
  key text;
begin
  if not app.can_mfa(p_org, 'compliance.read') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  reveal := p_type in ('form16', 'tds_return') and app.aal2() and app.can(p_org, 'pii.reveal');
  if reveal then
    key := app.pii_key();
  end if;

  select * into org_row from public.organizations where id = p_org;
  if p_entity is not null then
    select * into ent from public.legal_entities where id = p_entity and org_id = p_org;
  else
    select * into ent from public.legal_entities where org_id = p_org and is_default limit 1;
  end if;

  -- A period is a month (2026-08), a financial-year quarter (FY2026-27-Q2) or a
  -- whole financial year (FY2026-27), depending on what the return covers.
  if p_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    months := array[p_period];
    fy_start := case when substr(p_period, 6, 2)::int >= 4
                     then substr(p_period, 1, 4)::int
                     else substr(p_period, 1, 4)::int - 1 end;
  elsif p_period ~ '^FY[0-9]{4}-[0-9]{2}-Q[1-4]$' then
    fy_start := substr(p_period, 3, 4)::int;
    q := right(p_period, 1);
    months := case q
      when '1' then array[fy_start||'-04', fy_start||'-05', fy_start||'-06']
      when '2' then array[fy_start||'-07', fy_start||'-08', fy_start||'-09']
      when '3' then array[fy_start||'-10', fy_start||'-11', fy_start||'-12']
      else array[(fy_start+1)||'-01', (fy_start+1)||'-02', (fy_start+1)||'-03'] end;
  elsif p_period ~ '^FY[0-9]{4}-[0-9]{2}$' then
    fy_start := substr(p_period, 3, 4)::int;
    months := array[
      fy_start||'-04', fy_start||'-05', fy_start||'-06', fy_start||'-07',
      fy_start||'-08', fy_start||'-09', fy_start||'-10', fy_start||'-11',
      fy_start||'-12', (fy_start+1)||'-01', (fy_start+1)||'-02', (fy_start+1)||'-03'];
  else
    raise exception 'Period % is not a month, a financial-year quarter or a financial year', p_period
      using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(r order by r->>'code'), '[]'::jsonb) into rows from (
    select jsonb_build_object(
      'employeeId',  e.id,
      'code',        e.employee_code,
      'name',        e.full_name,
      'doj',         e.doj,
      'exitDate',    e.exit_date,
      'uan',         s.uan,
      'esiIp',       s.esi_ip_number,
      'panLast4',    s.pan_last4,
      'pan',         case when reveal and s.pan_enc is not null
                          then extensions.pgp_sym_decrypt(s.pan_enc, key) else null end,
      'regime',      coalesce(s.tax_regime, 'new'),
      'state',       coalesce(l.state_code, le.state_code),
      'months',      jsonb_agg(jsonb_build_object(
                       'month',       pr.period_month,
                       'paidDays',    i.paid_days,
                       'lopDays',     i.lop_days,
                       'gross',       i.gross,
                       'net',         i.net,
                       'pfEmployee',  i.pf_employee,
                       'esiEmployee', i.esi_employee,
                       'pt',          i.pt,
                       'tds',         i.tds,
                       'pf',          i.payload -> 'pf',
                       'esi',         i.payload -> 'esi',
                       'lwf',         i.payload -> 'lwf',
                       'taxAnnual',   i.payload -> 'tds' -> 'annual',
                       'earnings',    i.payload -> 'earnings',
                       'deductions',  i.payload -> 'deductions',
                       'employer',    i.payload -> 'employerContributions',
                       'ytd',         i.payload -> 'nextYtd'
                     ) order by pr.period_month)
    ) as r
    from public.pay_run_items i
    join public.pay_runs pr on pr.id = i.run_id
    join public.employees e on e.id = i.employee_id
    left join public.employee_statutory s on s.employee_id = e.id
    left join public.locations l on l.id = e.location_id
    left join public.legal_entities le on le.id = e.entity_id
    where pr.org_id = p_org
      and pr.period_month = any(months)
      and pr.status in ('locked', 'paid')
      and (ent.id is null or pr.entity_id is null or pr.entity_id = ent.id)
      and not i.hold
    group by e.id, e.employee_code, e.full_name, e.doj, e.exit_date,
             s.uan, s.esi_ip_number, s.pan_last4, s.pan_enc, s.tax_regime, l.state_code, le.state_code
  ) x;

  select jsonb_build_object(
    'employees',   count(distinct i.employee_id),
    'gross',       coalesce(sum(i.gross), 0),
    'pfEmployee',  coalesce(sum(i.pf_employee), 0),
    'pfEmployer',  coalesce(sum(coalesce((i.payload->'pf'->>'employerTotal')::numeric, 0)), 0),
    'eps',         coalesce(sum(coalesce((i.payload->'pf'->>'eps')::numeric, 0)), 0),
    'edli',        coalesce(sum(coalesce((i.payload->'pf'->>'edli')::numeric, 0)), 0),
    'pfAdmin',     coalesce(sum(coalesce((i.payload->'pf'->>'admin')::numeric, 0)), 0),
    'esiEmployee', coalesce(sum(i.esi_employee), 0),
    'esiEmployer', coalesce(sum(coalesce((i.payload->'esi'->>'employer')::numeric, 0)), 0),
    'pt',          coalesce(sum(i.pt), 0),
    'lwfEmployee', coalesce(sum(coalesce((i.payload->'lwf'->>'employee')::numeric, 0)), 0),
    'lwfEmployer', coalesce(sum(coalesce((i.payload->'lwf'->>'employer')::numeric, 0)), 0),
    'tds',         coalesce(sum(i.tds), 0)
  ) into totals
  from public.pay_run_items i
  join public.pay_runs pr on pr.id = i.run_id
  where pr.org_id = p_org
    and pr.period_month = any(months)
    and pr.status in ('locked', 'paid')
    and (ent.id is null or pr.entity_id is null or pr.entity_id = ent.id)
    and not i.hold;

  return jsonb_build_object(
    'type', p_type,
    'period', p_period,
    'months', to_jsonb(months),
    'fyStart', fy_start,
    'panRevealed', reveal,
    'org', jsonb_build_object('name', org_row.name, 'pan', org_row.pan, 'tan', org_row.tan,
                              'gstin', org_row.gstin),
    'entity', case when ent.id is null then null else jsonb_build_object(
                'id', ent.id, 'name', ent.name, 'pan', ent.pan, 'tan', ent.tan,
                'pfCode', ent.pf_code, 'esiCode', ent.esi_code, 'state', ent.state_code) end,
    'totals', coalesce(totals, '{}'::jsonb),
    'rows', rows
  );
end $$;

create or replace function api.filing_data(p_org uuid, p_type text, p_period text, p_entity uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.filing_data(p_org, p_type, p_period, p_entity) $$;

revoke all on function api.filing_data(uuid, text, text, uuid) from public;
grant execute on function api.filing_data(uuid, text, text, uuid) to authenticated;
