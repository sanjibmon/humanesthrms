\set ON_ERROR_STOP 1
do $$
declare
  U_OWNER constant uuid := '00000000-0000-0000-0000-0000000000b1'; U_HR constant uuid := '00000000-0000-0000-0000-0000000000b2';
  U_MGR constant uuid := '00000000-0000-0000-0000-0000000000b3'; U_E1 constant uuid := '00000000-0000-0000-0000-0000000000b4';
  U_PAY constant uuid := '00000000-0000-0000-0000-0000000000b6'; U_AUD constant uuid := '00000000-0000-0000-0000-0000000000b7';
  U_SUPER constant uuid := '00000000-0000-0000-0000-0000000000a1'; U_GOWN constant uuid := '00000000-0000-0000-0000-0000000000c1';
  a uuid := t.id('orgA'); b uuid := t.id('orgB'); cid uuid; pid uuid; n integer; ch uuid;
begin
  -- ================= DPDP: consent, requests, breach =================
  perform t.login(U_E1);
  perform t.works('dpdp: employee records own consent', format($q$insert into public.consents (org_id, subject_type, subject_id, purpose, notice_version) values (%L,'employee',%L,'biometric_attendance',1)$q$, a, t.id('e1')));
  perform t.throws('dpdp: cannot record consent for a colleague', format($q$insert into public.consents (org_id, subject_type, subject_id, purpose) values (%L,'employee',%L,'marketing')$q$, a, t.id('e2')));
  cid := (select id from public.consents limit 1);
  perform t.throws('dpdp: consent rows cannot be rewritten directly', format($q$update public.consents set withdrawn_at = null, purpose='marketing' where id=%L$q$, cid), 'permission denied');
  perform t.login(U_E1); perform t.works('dpdp: employee withdraws consent', format('select app.withdraw_consent(%L)', cid));
  perform t.expect('dpdp: withdrawal recorded, record kept', (select withdrawn_at is not null from public.consents where id = cid), true);
  perform t.login(U_MGR);
  perform t.expect('dpdp: manager cannot see consent records', t.count('select 1 from public.consents'), 0::bigint);
  perform t.login(U_HR);
  perform t.expect('dpdp: HR (privacy.manage) sees consent records', t.count('select 1 from public.consents'), 1::bigint);
  perform t.login(U_E1);
  perform t.works('dpdp: employee raises an access request', format($q$insert into public.data_subject_requests (org_id, employee_id, request_type, details) values (%L,%L,'access','Please share the data you hold on me')$q$, a, t.id('e1')));
  perform t.throws('dpdp: cannot raise a request as a colleague', format($q$insert into public.data_subject_requests (org_id, employee_id, request_type) values (%L,%L,'erasure')$q$, a, t.id('e2')));
  perform t.throws('dpdp: cannot pre-complete own request', format($q$insert into public.data_subject_requests (org_id, employee_id, request_type, status) values (%L,%L,'access','completed')$q$, a, t.id('e1')));
  perform t.expect('dpdp: request has an SLA due date', (select due_at > received_at from public.data_subject_requests limit 1), true);
  perform t.expect('dpdp: employee cannot close their own request', t.affected($q$update public.data_subject_requests set status='completed'$q$), 0::bigint);
  perform t.login(U_HR);
  perform t.expect('dpdp: HR closes the request', t.affected($q$update public.data_subject_requests set status='completed', completed_at=now(), resolution='Export sent' where request_type='access'$q$), 1::bigint);
  perform t.login(U_HR, 'aal2');
  perform t.works('dpdp: HR logs a breach with MFA', format($q$insert into public.breach_register (org_id, detected_at, description, data_categories, affected_count, severity) values (%L, now(), 'Laptop lost with payroll export', '{payroll}', 12, 'high')$q$, a));
  perform t.login(U_HR);
  perform t.expect('dpdp: breach register hidden without MFA', t.count('select 1 from public.breach_register'), 0::bigint);
  perform t.login(U_E1, 'aal2');
  perform t.expect('dpdp: employees never see the breach register', t.count('select 1 from public.breach_register'), 0::bigint);
  perform t.login(U_GOWN, 'aal2');
  perform t.expect('dpdp: other tenant sees no Acme consents or breaches', t.count('select 1 from public.consents') + t.count('select 1 from public.breach_register') + t.count('select 1 from public.data_subject_requests'), 0::bigint);

  -- ================= POSH =================
  perform t.login(U_E1);
  perform t.works('posh: employee files a complaint', format($q$insert into public.posh_complaints (org_id, complainant_employee_id, respondent_employee_id, description, incident_date) values (%L,%L,%L,'Confidential description',current_date - 3)$q$, a, t.id('e1'), t.id('mgr')));
  perform t.expect('posh: complaint number generated', (select complaint_no from public.posh_complaints limit 1), 'POSH-' || to_char(now(), 'YYYY') || '-001');
  perform t.expect('posh: 90 day inquiry window set', (select inquiry_due_at::date - received_at::date from public.posh_complaints limit 1), 90);
  perform t.expect('posh: complainant sees own complaint', t.count('select 1 from public.posh_complaints'), 1::bigint);
  perform t.throws('posh: cannot file as someone else', format($q$insert into public.posh_complaints (org_id, complainant_employee_id, description) values (%L,%L,'x')$q$, a, t.id('e2')));
  perform t.login(U_MGR, 'aal2');
  perform t.expect('posh: the respondent cannot see the complaint', t.count('select 1 from public.posh_complaints'), 0::bigint);
  perform t.login(U_HR, 'aal2');
  perform t.expect('posh: HR without posh.manage cannot see it', t.count('select 1 from public.posh_complaints'), 0::bigint);
  perform t.login(U_AUD, 'aal2');
  perform t.expect('posh: auditor cannot see it', t.count('select 1 from public.posh_complaints'), 0::bigint);
  perform t.login(U_OWNER);
  perform t.expect('posh: owner needs MFA', t.count('select 1 from public.posh_complaints'), 0::bigint);
  perform t.login(U_OWNER, 'aal2');
  perform t.expect('posh: owner with MFA can see it', t.count('select 1 from public.posh_complaints'), 1::bigint);
  perform t.works('posh: committee moves it to inquiry', $q$update public.posh_complaints set status='inquiry'$q$);
  perform t.login(U_AUD, 'aal2');
  perform t.expect('posh: audit log carries status only, not the description', (select count(*) from public.audit_logs where entity_type = 'posh_complaint' and detail::text like '%Confidential%'), 0::bigint);
  perform t.expect('posh: audit log records the transition', (select count(*) from public.audit_logs where entity_type = 'posh_complaint'), 2::bigint);

  -- ================= policies, regulatory centre, calendar =================
  perform t.login(U_HR);
  insert into public.policy_documents (org_id, title, body, published_at) values (a, 'Code of conduct', 'text', now()) returning id into pid;
  perform t.login(U_E1);
  perform t.works('policy: employee acknowledges', format($q$insert into public.policy_acks (policy_id, org_id, employee_id) values (%L,%L,%L)$q$, pid, a, t.id('e1')));
  perform t.throws('policy: cannot acknowledge for a colleague', format($q$insert into public.policy_acks (policy_id, org_id, employee_id) values (%L,%L,%L)$q$, pid, a, t.id('e2')));
  perform t.expect('reg: customers can read regulatory changes', (t.count('select 1 from public.regulatory_changes') >= 5), true);
  perform t.expect('reg: EPFO ceiling is announced, not in force', (select status from public.regulatory_changes where rule_key = 'pf.wageCeiling'), 'announced');
  perform t.expect('reg: customers cannot edit regulatory changes', t.affected($q$update public.regulatory_changes set status='in_force'$q$), 0::bigint);
  perform t.login(U_SUPER, 'aal2');
  perform t.works('reg: HumaNest staff can publish a change', $q$insert into public.regulatory_changes (title, summary, area, status, source) values ('Test change','x','other','announced','test')$q$);
  perform t.login(U_PAY, 'aal2');
  perform t.works('reg: payroll records an adoption decision', format($q$insert into public.org_regulatory_decisions (org_id, change_id, decision, adopt_from_month) select %L, id, 'defer', '2026-11' from public.regulatory_changes where rule_key='pf.wageCeiling'$q$, a));
  perform t.login(U_E1);
  perform t.expect('reg: employees cannot see the decisions', t.count('select 1 from public.org_regulatory_decisions'), 0::bigint);
  perform t.login(U_PAY, 'aal2');
  n := app.generate_filings(a, '2026-09');
  perform t.expect('calendar: September creates 4 monthly filings plus the Q2 TDS return', n, 5);
  perform t.expect('calendar: PF due on 15 October', (select due_date from public.statutory_filings where filing_type='pf_ecr' and period='2026-09'), date '2026-10-15');
  perform t.expect('calendar: TDS challan due on 7 October', (select due_date from public.statutory_filings where filing_type='tds_challan' and period='2026-09'), date '2026-10-07');
  perform t.expect('calendar: Q2 return due 31 October', (select due_date from public.statutory_filings where filing_type='tds_return'), date '2026-10-31');
  perform t.expect('calendar: generation is idempotent', app.generate_filings(a, '2026-09'), 0);
  n := app.generate_filings(a, '2027-03');
  perform t.expect('calendar: March adds Q4 return and Form 16', (select count(*) from public.statutory_filings where period like '%Q4' or filing_type = 'form16'), 2::bigint);
  perform t.expect('calendar: March TDS due 30 April', (select due_date from public.statutory_filings where filing_type='tds_challan' and period='2027-03'), date '2027-04-30');
  perform t.expect('calendar: Q4 FY26-27 return due 31 May 2027', (select due_date from public.statutory_filings where period = 'FY2026-27-Q4'), date '2027-05-31');
  perform t.expect('calendar: Form 16 due 15 June 2027', (select due_date from public.statutory_filings where filing_type='form16'), date '2027-06-15');
  perform t.login(U_HR, 'aal2');
  perform t.throws('calendar: HR cannot generate filings', format('select app.generate_filings(%L, %L)', a, '2026-10'), 'Not permitted');

  -- ================= security events and notifications =================
  perform t.logout();
  insert into public.security_events (org_id, user_id, event_type, ip) values (a, U_E1, 'login_success', '203.0.113.5'), (a, U_MGR, 'login_failed', '203.0.113.9');
  insert into public.notifications (org_id, user_id, kind, title) values (a, U_E1, 'leave', 'Leave approved'), (a, U_MGR, 'leave', 'Approval pending');
  perform t.login(U_E1);
  perform t.expect('sec: user sees only own security events', t.count('select 1 from public.security_events'), 1::bigint);
  perform t.throws('sec: user cannot write security events', format($q$insert into public.security_events (user_id, event_type) values (%L,'login_success')$q$, U_E1), 'permission denied');
  perform t.expect('notif: user sees only own notifications', t.count('select 1 from public.notifications'), 1::bigint);
  perform t.works('notif: user marks read', $q$update public.notifications set read_at = now()$q$);
  perform t.throws('notif: user cannot create notifications', format($q$insert into public.notifications (user_id, kind, title) values (%L,'x','y')$q$, U_E1), 'permission denied');
  perform t.login(U_AUD, 'aal2');
  perform t.expect('sec: auditor with MFA sees the organisation''s events', t.count('select 1 from public.security_events'), 2::bigint);
  perform t.login(U_GOWN, 'aal2');
  perform t.expect('sec: other tenant sees none', t.count('select 1 from public.security_events'), 0::bigint);
  perform t.logout();
  perform t.throws('sec: security events are append-only', $q$delete from public.security_events$q$, 'append-only');

  -- ================= retention =================
  insert into public.candidates (org_id, full_name, stage, retain_until) values (a, 'Old Applicant', 'rejected', current_date - 1), (a, 'Fresh Applicant', 'applied', current_date + 100), (a, 'Hired Long Ago', 'hired', current_date - 400);
  perform t.expect('retention: purge removes expired rejected candidates only', (app.run_retention() ->> 'candidates')::int, 1);
  perform t.expect('retention: hired and current candidates survive', (select count(*) from public.candidates where full_name in ('Fresh Applicant','Hired Long Ago')), 2::bigint);
  perform t.login(U_HR);
  perform t.throws('retention: users cannot run the purge', 'select app.run_retention()', 'permission denied');
end $$;
