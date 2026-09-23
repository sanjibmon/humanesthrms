select set_config('app.pii_key', 'test-key-not-for-production', false);
\set ON_ERROR_STOP 1
do $$
declare
  U_OWNER constant uuid := '00000000-0000-0000-0000-0000000000b1'; U_HR constant uuid := '00000000-0000-0000-0000-0000000000b2';
  U_MGR constant uuid := '00000000-0000-0000-0000-0000000000b3'; U_E1 constant uuid := '00000000-0000-0000-0000-0000000000b4';
  U_E2 constant uuid := '00000000-0000-0000-0000-0000000000b5'; U_PAY constant uuid := '00000000-0000-0000-0000-0000000000b6';
  U_SUPER constant uuid := '00000000-0000-0000-0000-0000000000a1'; U_GEMP constant uuid := '00000000-0000-0000-0000-0000000000c2';
  a uuid := t.id('orgA'); b uuid := t.id('orgB'); lt uuid := t.id('ltA');
  lv uuid; lv2 uuid; req uuid; res text; steps text; n numeric; c uuid;
begin
  -- ================= leave application =================
  perform t.login(U_E1);
  perform t.expect('leave: balance starts at 12', app.leave_balance(t.id('e1'), lt, 2026), 12::numeric);
  perform t.throws('leave: cannot exceed balance', format($q$select app.apply_leave(%L, '2026-10-05', '2026-10-30')$q$, lt), 'BALANCE');
  perform t.throws('leave: to before from', format($q$select app.apply_leave(%L, '2026-10-08', '2026-10-05')$q$, lt), 'before');
  perform t.throws('leave: Sunday only is refused', format($q$select app.apply_leave(%L, '2026-10-04', '2026-10-04')$q$, lt), 'weekly offs');
  lv := app.apply_leave(lt, '2026-10-05', '2026-10-07', 'none', 'Family function');   -- Mon-Wed = 3 days
  perform t.expect('leave: 3 working days counted', (select days from public.leave_requests where id = lv), 3::numeric);
  perform t.expect('leave: starts pending', (select status from public.leave_requests where id = lv), 'pending');
  perform t.throws('leave: overlap refused', format($q$select app.apply_leave(%L, '2026-10-07', '2026-10-08')$q$, lt), 'OVERLAP');
  perform t.expect('leave: employee sees own request', t.count('select 1 from public.leave_requests'), 1::bigint);
  perform t.throws('leave: employee cannot insert request directly', format($q$insert into public.leave_requests (org_id, employee_id, leave_type_id, from_date, to_date, days, status) values (%L,%L,%L,'2026-11-02','2026-11-02',1,'approved')$q$, a, t.id('e1'), lt));
  perform t.throws('leave: employee cannot forge ledger credit', format($q$insert into public.leave_ledger (org_id, employee_id, leave_type_id, entry_date, leave_year, delta, reason) values (%L,%L,%L,'2026-10-01',2026,100,'opening')$q$, a, t.id('e1'), lt));
  perform t.login(U_E2);
  perform t.expect('leave: colleague cannot see the request', t.count('select 1 from public.leave_requests'), 0::bigint);
  req := (select approval_request_id from public.leave_requests where id = lv);   -- readable? requester only
  perform t.login(U_E1);
  req := (select approval_request_id from public.leave_requests where id = lv);
  steps := (select string_agg(approver_type, ',' order by level) from public.approval_steps where request_id = req);
  perform t.expect('leave: chain is manager then HR', steps, 'manager,hr');
  perform t.throws('leave: cannot approve own request', format($q$select app.decide_approval(%L,'approve')$q$, req), 'your own request');

  -- ================= approval chain =================
  perform t.login(U_E2);
  perform t.throws('approval: colleague cannot decide', format($q$select app.decide_approval(%L,'approve')$q$, req), 'not the approver');
  perform t.login(U_HR);
  perform t.throws('approval: HR cannot skip the manager step', format($q$select app.decide_approval(%L,'approve')$q$, req), 'not the approver');
  perform t.login(U_MGR);
  perform t.expect('approval: manager sees only the step assigned to them', t.count(format('select 1 from public.approval_steps where request_id=%L', req)), 1::bigint);
  perform t.expect('approval: manager approves, HR next', app.decide_approval(req, 'approve', 'ok'), 'pending');
  perform t.expect('approval: balance not yet debited', app.leave_balance(t.id('e1'), lt, 2026), 12::numeric);
  perform t.throws('approval: manager cannot approve twice', format($q$select app.decide_approval(%L,'approve')$q$, req), 'not the approver');
  perform t.login(U_HR);
  perform t.expect('approval: HR gives final approval', app.decide_approval(req, 'approve'), 'approved');
  perform t.expect('approval: balance debited', app.leave_balance(t.id('e1'), lt, 2026), 9::numeric);
  perform t.expect('approval: request marked approved', (select status from public.leave_requests where id = lv), 'approved');
  perform t.expect('approval: attendance marked leave', (select count(*) from public.attendance_daily where employee_id = t.id('e1') and status = 'leave'), 3::bigint);
  perform t.throws('approval: decided request cannot be decided again', format($q$select app.decide_approval(%L,'approve')$q$, req), 'not pending');
  perform t.login(U_E1);
  perform t.works('leave: employee cancels approved leave', format('select app.cancel_leave(%L)', lv));
  perform t.expect('leave: balance restored on cancel', app.leave_balance(t.id('e1'), lt, 2026), 12::numeric);
  perform t.expect('leave: leave attendance rows removed on cancel', (select count(*) from public.attendance_daily where employee_id = t.id('e1') and status = 'leave'), 0::bigint);
  perform t.login(U_E2);
  perform t.throws('leave: cannot cancel someone else''s leave', format('select app.cancel_leave(%L)', lv), 'Not permitted');

  -- rejection path
  perform t.login(U_E1);
  lv2 := app.apply_leave(lt, '2026-11-02', '2026-11-02', 'none', 'Personal');
  req := (select approval_request_id from public.leave_requests where id = lv2);
  perform t.login(U_MGR);
  perform t.expect('approval: manager can reject', app.decide_approval(req, 'reject', 'Project deadline'), 'rejected');
  perform t.expect('approval: rejected leave does not debit', app.leave_balance(t.id('e1'), lt, 2026), 12::numeric);
  perform t.expect('approval: rejected status on leave', (select status from public.leave_requests where id = lv2), 'rejected');

  -- forward path
  perform t.login(U_E1);
  lv2 := app.apply_leave(lt, '2026-11-03', '2026-11-03', 'none', 'Personal');
  req := (select approval_request_id from public.leave_requests where id = lv2);
  perform t.login(U_MGR);
  perform t.expect('approval: manager forwards to payroll colleague', app.decide_approval(req, 'forward', 'Please decide', t.id('pay')), 'forwarded');
  perform t.login(U_PAY);
  perform t.expect('approval: forwardee approves, HR step remains', app.decide_approval(req, 'approve'), 'pending');
  perform t.login(U_HR);
  perform t.expect('approval: HR finishes forwarded request', app.decide_approval(req, 'approve'), 'approved');

  -- manager on leave: HR handles first (auto-escalation)
  perform t.logout();
  insert into public.leave_requests (org_id, employee_id, leave_type_id, from_date, to_date, days, status)
    values (a, t.id('mgr'), lt, '2026-12-07', '2026-12-09', 3, 'approved');
  perform t.login(U_E2);
  lv2 := app.apply_leave(lt, '2026-12-08', '2026-12-08', 'none', 'Personal');
  req := (select approval_request_id from public.leave_requests where id = lv2);
  perform t.expect('approval: manager on leave escalates to HR first', (select approver_type from public.approval_steps where request_id = req and level = 1), 'hr');

  -- probation, gender, documents
  perform t.logout();
  insert into public.leave_types (org_id, code, name, days_per_year, probation_days, approval_levels) values (a,'PL','Probation Locked',5,365,1) returning id into c;
  insert into public.leave_types (org_id, code, name, days_per_year, gender_specific, approval_levels) values (a,'ML','Maternity',180,'F',1);
  insert into public.leave_types (org_id, code, name, days_per_year, doc_required_after_days, allow_negative, approval_levels) values (a,'SL','Sick',12,2,true,1);
  perform t.login(U_HR);
  perform t.throws('leave: HR cannot create leave types without leave.config', format($q$insert into public.leave_types (org_id, code, name) values (%L,'ZZ','x')$q$, b));
  perform t.login(U_E1);
  perform t.works('leave: sick leave with negative balance allowed', format($q$select app.apply_leave((select id from public.leave_types where code='SL' and org_id=%L), '2026-09-28','2026-09-28')$q$, a));
  perform t.throws('leave: document required for more than 2 days', format($q$select app.apply_leave((select id from public.leave_types where code='SL' and org_id=%L), '2026-10-12','2026-10-14')$q$, a), 'DOCUMENT');
  perform t.throws('leave: gender check passes for eligible employee (then fails on balance)', format($q$select app.apply_leave((select id from public.leave_types where code='ML' and org_id=%L), '2026-10-12','2026-10-12')$q$, a), 'BALANCE');
  perform t.login(U_E2);
  perform t.throws('leave: male employee refused maternity', format($q$select app.apply_leave((select id from public.leave_types where code='ML' and org_id=%L), '2026-10-12','2026-10-12')$q$, a), 'GENDER');
  perform t.login(U_GEMP);
  perform t.throws('leave: other org employee cannot apply for Acme leave type', format($q$select app.apply_leave(%L, '2026-10-12','2026-10-12')$q$, lt), 'Not an employee');

  -- ================= attendance =================
  perform t.logout();
  update public.locations set lat = 18.5204, lng = 73.8567, geofence_radius_m = 100 where org_id = a;
  perform t.expect('attendance: fixture has no location yet', (select count(*) from public.locations where org_id = a), 0::bigint);
  insert into public.locations (org_id, name, city, state_code, lat, lng, geofence_radius_m) values (a,'Pune HQ','Pune','MH',18.5204,73.8567,100) returning id into c;
  update public.employees set location_id = c where org_id = a;
  perform t.login(U_E1);
  perform t.works('attendance: employee punches in from the office', format($q$insert into public.attendance_events (org_id, employee_id, event_time, event_type, source, lat, lng, inside_geofence, client_event_id) values (%L,%L,now(),'in','mobile_selfie',18.5205,73.8568,false,gen_random_uuid())$q$, a, t.id('e1')));
  perform t.expect('attendance: server computed geofence (client value ignored)', (select inside_geofence from public.attendance_events where employee_id = t.id('e1') and event_type = 'in'), true);
  perform t.expect('attendance: punch stamped with caller', (select created_by from public.attendance_events where employee_id = t.id('e1') limit 1), U_E1);
  perform t.works('attendance: punch out far away', format($q$insert into public.attendance_events (org_id, employee_id, event_time, event_type, source, lat, lng, inside_geofence, is_mock_location) values (%L,%L,now(),'out','mobile_selfie',19.0760,72.8777,true,true)$q$, a, t.id('e1')));
  perform t.expect('attendance: far punch flagged outside geofence', (select inside_geofence from public.attendance_events where employee_id = t.id('e1') and event_type = 'out'), false);
  perform t.expect('attendance: mock location flagged', (select 'mock_location' = any(flags) from public.attendance_events where employee_id = t.id('e1') and event_type = 'out'), true);
  perform t.throws('attendance: cannot punch for a colleague', format($q$insert into public.attendance_events (org_id, employee_id, event_time, event_type, source) values (%L,%L,now(),'in','web')$q$, a, t.id('e2')));
  perform t.throws('attendance: cannot back-date a punch', format($q$insert into public.attendance_events (org_id, employee_id, event_time, event_type, source) values (%L,%L,now() - interval '2 days','in','web')$q$, a, t.id('e1')));
  perform t.throws('attendance: cannot use biometric source', format($q$insert into public.attendance_events (org_id, employee_id, event_time, event_type, source) values (%L,%L,now(),'in','biometric')$q$, a, t.id('e1')));
  perform t.throws('attendance: punches are immutable', $q$update public.attendance_events set event_type='out'$q$, 'permission denied');
  perform t.logout();
  perform t.throws('attendance: punches are immutable even for the owner role', $q$update public.attendance_events set event_type='out'$q$, 'append-only');
  perform t.login(U_E2);
  perform t.expect('attendance: colleague cannot see punches', t.count(format('select 1 from public.attendance_events where employee_id=%L', t.id('e1'))), 0::bigint);
  perform t.login(U_MGR);
  perform t.expect('attendance: manager sees team punches', (t.count(format('select 1 from public.attendance_events where employee_id=%L', t.id('e1'))) > 0), true);
  perform t.expect('attendance: manager cannot see non-team punches', t.count(format('select 1 from public.attendance_events where employee_id=%L', t.id('hr'))), 0::bigint);
  perform t.login(U_E1);
  perform t.works('attendance: regularisation request', $q$select app.request_regularization(current_date - 2, 'missed_in', now() - interval '2 days 9 hours', now() - interval '2 days 1 hour', 'Forgot to punch')$q$);
  perform t.throws('attendance: cannot regularise beyond 31 days', $q$select app.request_regularization(current_date - 60, 'missed_in', now(), now(), 'old')$q$, '31 days');
  perform t.throws('attendance: cannot regularise the future', $q$select app.request_regularization(current_date + 3, 'missed_in', now(), now(), 'future')$q$, 'future');

  -- ================= modules and seats =================
  perform t.logout();
  perform t.throws('modules: core module cannot be disabled', format($q$update public.organization_modules set enabled=false where org_id=%L and module_code='employee_core'$q$, a), 'Core module');
  perform t.works('modules: payroll can be enabled after its dependencies', format($q$update public.organization_modules set enabled=true where org_id=%L and module_code='payroll'$q$, a));
  perform t.throws('modules: cannot disable a module something depends on', format($q$update public.organization_modules set enabled=false where org_id=%L and module_code='attendance'$q$, a), 'required by');
  perform t.throws('modules: statutory cannot be enabled without payroll', format($q$update public.organization_modules set enabled=true where org_id=%L and module_code='statutory'$q$, b), 'requires module');
  c := app.provision_customer('Initech', '00000000-0000-0000-0000-0000000000c1', 'starter', 2, 14, array['payroll'], U_SUPER);
  perform t.expect('modules: provisioning payroll pulls in its dependencies', (select count(*) from public.organization_modules where org_id = c and enabled), 5::bigint); -- core x2 + attendance + leave + payroll
  perform t.throws('modules: plan seat maximum enforced at provisioning', $q$select app.provision_customer('Big Co', '00000000-0000-0000-0000-0000000000c1', 'starter', 500, 14)$q$, 'at most');
  insert into public.employees (org_id, employee_code, full_name, doj, status) values (c,'I1','One','2026-01-01','active'),(c,'I2','Two','2026-01-01','active');
  perform t.throws('seats: third employee blocked at the seat limit', format($q$insert into public.employees (org_id, employee_code, full_name, doj, status) values (%L,'I3','Three','2026-01-01','active')$q$, c), 'SEAT_LIMIT_REACHED');
  perform t.works('seats: exited employees do not consume a seat', format($q$insert into public.employees (org_id, employee_code, full_name, doj, status, exit_date) values (%L,'I0','Old','2020-01-01','exited','2025-01-01')$q$, c));
  perform t.expect('seats: counter tracks usage', (select seats_used from public.organization_licenses where org_id = c), 2);
end $$;
