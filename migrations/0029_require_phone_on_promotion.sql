-- The phone requirement, applied to promotions as well as to new rows.
--
-- Migration 0019 made a contact number mandatory for administrator roles, but
-- the trigger only guarded INSERT. So the rule held when somebody was added as
-- an HR admin and quietly did not hold when a phone-less employee was promoted
-- into one -- which, now that HR can change roles, is the common path rather
-- than the rare one. A probe caught it.
--
-- The UPDATE branch refuses only when the change is what creates the problem.
-- A row that was already a phone-less administrator from before this migration
-- can still be edited in other ways, and fixed, rather than becoming
-- impossible to touch.
--
-- finance_approver joins the administrator list here. It approves payment runs;
-- leaving it off was an oversight in 0019.

create or replace function app.require_phone()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare v_role text; v_admin boolean; v_was_admin boolean;
begin
  new.phone := app.normalize_phone(new.phone);

  if tg_nargs > 0 then
    v_role := to_jsonb(new) ->> tg_argv[0];
    v_admin := v_role in ('owner', 'hr_admin', 'payroll_admin', 'finance_approver');
  else
    v_admin := true;
  end if;

  if tg_op = 'INSERT' then
    if new.phone is null and v_admin then
      raise exception 'A contact number is required%.',
        case when tg_nargs > 0 then ' for an administrator' else '' end
        using errcode = '23502';
    end if;
    return new;
  end if;

  -- UPDATE from here.
  if old.phone is not null and new.phone is null then
    raise exception 'A contact number is required and cannot be removed.'
      using errcode = '23502';
  end if;

  if v_admin and new.phone is null then
    if tg_nargs > 0 then
      v_was_admin := (to_jsonb(old) ->> tg_argv[0])
                       in ('owner', 'hr_admin', 'payroll_admin', 'finance_approver');
    else
      v_was_admin := true;
    end if;
    if not v_was_admin then
      raise exception 'NEEDS_PHONE:A contact number is required for an administrator. Add one before giving this person an administrator role.'
        using errcode = '23502';
    end if;
  end if;

  return new;
end $$;
