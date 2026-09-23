-- Two customers with realistic roles, employees, leave setup and two HumaNest staff.
select set_config('app.pii_key', 'test-key-not-for-production', false);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1','super@humanest.co.in'),
  ('00000000-0000-0000-0000-0000000000a2','support@humanest.co.in'),
  ('00000000-0000-0000-0000-0000000000a3','sales@humanest.co.in'),
  ('00000000-0000-0000-0000-0000000000b1','owner@acme.test'),
  ('00000000-0000-0000-0000-0000000000b2','hr@acme.test'),
  ('00000000-0000-0000-0000-0000000000b3','mgr@acme.test'),
  ('00000000-0000-0000-0000-0000000000b4','emp1@acme.test'),
  ('00000000-0000-0000-0000-0000000000b5','emp2@acme.test'),
  ('00000000-0000-0000-0000-0000000000b6','payroll@acme.test'),
  ('00000000-0000-0000-0000-0000000000b7','auditor@acme.test'),
  ('00000000-0000-0000-0000-0000000000c1','owner@globex.test'),
  ('00000000-0000-0000-0000-0000000000c2','emp@globex.test');

insert into public.platform_users (id, email, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1','super@humanest.co.in','Super Admin','super_admin'),
  ('00000000-0000-0000-0000-0000000000a2','support@humanest.co.in','Support Agent','support'),
  ('00000000-0000-0000-0000-0000000000a3','sales@humanest.co.in','Sales Rep','sales');

create table t.ids (k text primary key, v uuid); grant select on t.ids to authenticated, anon;
create function t.id(key text) returns uuid language sql stable as $$ select v from t.ids where k = key $$; grant execute on function t.id(text) to authenticated, anon;
insert into t.ids select 'orgA', app.provision_customer('Acme Pvt Ltd', '00000000-0000-0000-0000-0000000000b1', 'growth', 10, 14, array['attendance','leave'], '00000000-0000-0000-0000-0000000000a1');
insert into t.ids select 'orgB', app.provision_customer('Globex India LLP', '00000000-0000-0000-0000-0000000000c1', 'growth', 10, 14, array['attendance','leave'], '00000000-0000-0000-0000-0000000000a1');

-- Acme employees: hr <- mgr <- (emp1, emp2); payroll and auditor report to hr
do $$
declare a uuid := (select v from t.ids where k='orgA'); b uuid := (select v from t.ids where k='orgB');
  hr uuid; mgr uuid; e1 uuid; e2 uuid; pay uuid; aud uuid; own uuid; gx uuid; gx2 uuid;
begin
  insert into public.employees (org_id, employee_code, full_name, work_email, doj, status) values (a,'A001','Hema HR','hr@acme.test','2020-01-01','active') returning id into hr;
  insert into public.employees (org_id, employee_code, full_name, work_email, doj, status, reporting_manager_id) values (a,'A002','Manoj Manager','mgr@acme.test','2021-01-01','active',hr) returning id into mgr;
  insert into public.employees (org_id, employee_code, full_name, work_email, doj, status, reporting_manager_id) values (a,'A003','Esha One','emp1@acme.test','2022-01-01','active',mgr) returning id into e1;
  insert into public.employees (org_id, employee_code, full_name, work_email, doj, status, reporting_manager_id) values (a,'A004','Eknath Two','emp2@acme.test','2022-06-01','active',mgr) returning id into e2;
  insert into public.employees (org_id, employee_code, full_name, work_email, doj, status, reporting_manager_id) values (a,'A005','Pooja Payroll','payroll@acme.test','2020-06-01','active',hr) returning id into pay;
  insert into public.employees (org_id, employee_code, full_name, work_email, doj, status, reporting_manager_id) values (a,'A006','Arun Auditor','auditor@acme.test','2020-09-01','active',hr) returning id into aud;
  insert into public.employees (org_id, employee_code, full_name, doj, status) values (a,'A000','Owen Owner','2019-01-01','active') returning id into own;
  insert into public.employees (org_id, employee_code, full_name, doj, status) values (b,'G001','Gita Globex','2021-01-01','active') returning id into gx;
  insert into public.employees (org_id, employee_code, full_name, doj, status) values (b,'G002','Gopal Globex','2021-02-01','active') returning id into gx2;
  insert into t.ids values ('hr',hr),('mgr',mgr),('e1',e1),('e2',e2),('pay',pay),('aud',aud),('own',own),('gx',gx),('gx2',gx2);

  update public.org_members set employee_id = own where org_id=a and user_id='00000000-0000-0000-0000-0000000000b1';
  insert into public.org_members (org_id, user_id, role, employee_id) values
    (a,'00000000-0000-0000-0000-0000000000b2','hr_admin',hr),
    (a,'00000000-0000-0000-0000-0000000000b3','manager',mgr),
    (a,'00000000-0000-0000-0000-0000000000b4','employee',e1),
    (a,'00000000-0000-0000-0000-0000000000b5','employee',e2),
    (a,'00000000-0000-0000-0000-0000000000b6','payroll_admin',pay),
    (a,'00000000-0000-0000-0000-0000000000b7','auditor',aud),
    (b,'00000000-0000-0000-0000-0000000000c2','employee',gx);
  update public.org_members set employee_id = gx2 where org_id=b and user_id='00000000-0000-0000-0000-0000000000c1';

  insert into public.employee_personal (employee_id, org_id, dob, gender, personal_phone) values
    (e1,a,'1995-05-05','F','9000000001'), (e2,a,'1994-04-04','M','9000000002'), (mgr,a,'1985-01-01','M','9000000003');
  insert into public.employee_statutory (employee_id, org_id, pan_enc, pan_last4, bank_account_enc, bank_last4, ifsc)
    values (e1,a,app.pii_encrypt('ABCDE1234F'),'234F',app.pii_encrypt('123456789012'),'9012','HDFC0001234'),
           (e2,a,app.pii_encrypt('PQRSX9876Z'),'876Z',app.pii_encrypt('998877665544'),'5544','ICIC0004321');

  insert into public.leave_types (org_id, code, name, days_per_year, approval_levels) values (a,'EL','Earned Leave',12,2) returning id into gx; -- reuse var
  insert into t.ids values ('ltA', gx);
  insert into public.leave_ledger (org_id, employee_id, leave_type_id, entry_date, leave_year, delta, reason, created_by)
    select a, e, gx, '2026-01-01', 2026, 12, 'opening', null from unnest(array[e1,e2,mgr]) e;
end $$;
