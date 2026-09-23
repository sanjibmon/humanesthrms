select set_config('app.pii_key', 'test-key-not-for-production', false);
\set ON_ERROR_STOP 1
do $$
declare
  U_OWNER constant uuid := '00000000-0000-0000-0000-0000000000b1'; U_HR constant uuid := '00000000-0000-0000-0000-0000000000b2';
  U_MGR constant uuid := '00000000-0000-0000-0000-0000000000b3'; U_E1 constant uuid := '00000000-0000-0000-0000-0000000000b4';
  U_E2 constant uuid := '00000000-0000-0000-0000-0000000000b5'; U_PAY constant uuid := '00000000-0000-0000-0000-0000000000b6';
  U_AUD constant uuid := '00000000-0000-0000-0000-0000000000b7'; U_GOWN constant uuid := '00000000-0000-0000-0000-0000000000c1';
  U_GEMP constant uuid := '00000000-0000-0000-0000-0000000000c2'; U_SUP constant uuid := '00000000-0000-0000-0000-0000000000a2';
  U_SUPER constant uuid := '00000000-0000-0000-0000-0000000000a1'; U_SALES constant uuid := '00000000-0000-0000-0000-0000000000a3';
  a uuid := t.id('orgA'); b uuid := t.id('orgB'); n bigint; s text;
begin
  -- ================= tenant isolation =================
  perform t.login(U_HR, 'aal2');
  perform t.expect('iso: HR sees only own org employees', t.count('select 1 from public.employees'), 7::bigint);
  perform t.expect('iso: HR sees no employees of other org', t.count(format('select 1 from public.employees where org_id=%L', b)), 0::bigint);
  perform t.throws('iso: HR cannot insert employee into other org', format($q$insert into public.employees (org_id, employee_code, full_name, doj) values (%L,'X1','Intruder','2026-01-01')$q$, b));
  perform t.expect('iso: HR cannot update other org employee', t.affected(format($q$update public.employees set full_name='hacked' where org_id=%L$q$, b)), 0::bigint);
  perform t.expect('iso: HR cannot delete other org employee', t.affected(format($q$delete from public.employees where org_id=%L$q$, b)), 0::bigint);
  perform t.expect('iso: HR cannot see other org members', t.count(format('select 1 from public.org_members where org_id=%L', b)), 0::bigint);
  perform t.expect('iso: HR cannot see other org leave types', t.count(format('select 1 from public.leave_types where org_id=%L', b)), 0::bigint);
  perform t.throws('iso: cross-org foreign key blocked', format($q$insert into public.employee_personal (employee_id, org_id) values (%L, %L)$q$, t.id('gx'), a));
  perform t.login(U_GEMP);
  perform t.expect('iso: other org employee sees own org directory only', t.count('select 1 from public.employees'), 2::bigint);
  perform t.expect('iso: other org employee cannot see Acme statutory', t.count('select 1 from public.employee_statutory'), 0::bigint);

  -- ================= directory and personal data =================
  perform t.login(U_E1);
  perform t.expect('dir: employee sees company directory', t.count('select 1 from public.employees'), 7::bigint);
  perform t.expect('dir: employee sees only own personal record', t.count('select 1 from public.employee_personal'), 1::bigint);
  perform t.expect('dir: employee cannot see statutory without MFA', t.count('select 1 from public.employee_statutory'), 0::bigint);
  perform t.login(U_E1, 'aal2');
  perform t.expect('dir: employee sees own statutory with MFA', t.count('select 1 from public.employee_statutory'), 1::bigint);
  perform t.expect('dir: employee cannot write directory', t.affected($q$update public.employees set full_name='Me Boss' where employee_code='A003'$q$), 0::bigint);
  perform t.throws('dir: employee cannot create employee', format($q$insert into public.employees (org_id, employee_code, full_name, doj) values (%L,'Z9','Fake','2026-01-01')$q$, a));
  perform t.login(U_HR);
  perform t.expect('dir: HR without MFA cannot see statutory', t.count('select 1 from public.employee_statutory'), 0::bigint);
  perform t.expect('dir: HR sees all personal records', t.count('select 1 from public.employee_personal'), 3::bigint);
  perform t.login(U_HR, 'aal2');
  perform t.expect('dir: HR with MFA sees statutory rows', t.count('select 1 from public.employee_statutory'), 2::bigint);
  perform t.login(U_MGR, 'aal2');
  perform t.expect('dir: manager cannot see personal data of reports', t.count(format('select 1 from public.employee_personal where employee_id=%L', t.id('e1'))), 0::bigint);
  perform t.expect('dir: manager cannot see statutory even with MFA', t.count('select 1 from public.employee_statutory'), 0::bigint);
  perform t.expect('dir: manager sees job profiles of team only', t.count('select 1 from public.employee_job_profile'), 0::bigint);
  perform t.login(U_AUD, 'aal2');
  perform t.expect('dir: auditor cannot see statutory (no sensitive permission)', t.count('select 1 from public.employee_statutory'), 0::bigint);
  perform t.expect('dir: auditor cannot see personal data (data minimisation)', t.count('select 1 from public.employee_personal'), 0::bigint);
  perform t.expect('dir: auditor is read only', t.affected($q$update public.employees set full_name='x'$q$), 0::bigint);

  -- ================= PII reveal =================
  perform t.login(U_PAY, 'aal2');
  perform t.expect('pii: payroll admin reveals PAN', app.reveal_statutory(t.id('e1'), 'pan'), 'ABCDE1234F');
  perform t.login(U_PAY);
  perform t.throws('pii: reveal needs MFA', format('select app.reveal_statutory(%L, %L)', t.id('e1'), 'pan'), 'Not permitted');
  perform t.login(U_HR, 'aal2');
  perform t.throws('pii: HR without pii.reveal cannot reveal full PAN', format('select app.reveal_statutory(%L, %L)', t.id('e1'), 'pan'), 'Not permitted');
  perform t.login(U_E1, 'aal2');
  perform t.expect('pii: employee reveals own bank account', app.reveal_statutory(t.id('e1'), 'bank_account'), '123456789012');
  perform t.throws('pii: employee cannot reveal colleague', format('select app.reveal_statutory(%L, %L)', t.id('e2'), 'pan'), 'Not permitted');
  perform t.login(U_HR, 'aal2');
  perform t.expect('pii: reveals are audited', t.count($q$select 1 from public.audit_logs where action='pii.reveal'$q$), 2::bigint);

  -- ================= support access =================
  perform t.login(U_SUP, 'aal2');
  perform t.expect('support: no data access without grant', t.count('select 1 from public.employees'), 0::bigint);
  perform t.throws('support: grant longer than 24h rejected', format($q$insert into public.support_access_grants (org_id, platform_user_id, reason, starts_at, expires_at) values (%L,%L,'Investigate payslip bug', now(), now() + interval '30 hours')$q$, a, U_SUP));
  perform t.works('support: can request a grant', format($q$insert into public.support_access_grants (org_id, platform_user_id, reason) values (%L,%L,'Investigate leave balance issue')$q$, a, U_SUP));
  perform t.expect('support: request alone gives no access', t.count('select 1 from public.employees'), 0::bigint);
  perform t.expect('support: cannot self approve', t.affected(format($q$update public.support_access_grants set approved_by=%L, starts_at=now(), expires_at=now()+interval '2 hours' where org_id=%L$q$, U_SUP, a)), 0::bigint);
  perform t.expect('support: self approval changes nothing', t.count('select 1 from public.support_access_grants where approved_by is not null'), 0::bigint);
  perform t.login(U_OWNER, 'aal2');
  perform t.expect('support: owner sees the request', t.count('select 1 from public.support_access_grants'), 1::bigint);
  perform t.expect('support: owner approves for 2 hours', t.affected(format($q$update public.support_access_grants set approved_by=%L, approved_at=now(), starts_at=now(), expires_at=now()+interval '2 hours' where org_id=%L$q$, U_OWNER, a)), 1::bigint);
  perform t.login(U_SUP, 'aal2');
  perform t.expect('support: sees directory while grant is active', t.count('select 1 from public.employees'), 7::bigint);
  perform t.expect('support: never sees personal data', t.count('select 1 from public.employee_personal'), 0::bigint);
  perform t.expect('support: never sees statutory data', t.count('select 1 from public.employee_statutory'), 0::bigint);
  perform t.expect('support: cannot write', t.affected($q$update public.employees set full_name='x'$q$), 0::bigint);
  perform t.expect('support: cannot see other org', t.count(format('select 1 from public.employees where org_id=%L', b)), 0::bigint);
  perform t.login(U_SUP);
  perform t.expect('support: no access without MFA even with grant', t.count('select 1 from public.employees'), 0::bigint);
  perform t.login(U_OWNER, 'aal2');
  perform t.expect('support: owner revokes', t.affected(format($q$update public.support_access_grants set revoked_at=now(), approved_by=%L where org_id=%L$q$, U_OWNER, a)), 1::bigint);
  perform t.login(U_SUP, 'aal2');
  perform t.expect('support: no access after revoke', t.count('select 1 from public.employees'), 0::bigint);

  -- ================= MFA and platform staff =================
  perform t.login(U_SUPER);
  perform t.expect('mfa: platform staff without MFA see nothing', t.count('select 1 from public.platform_users'), 1::bigint);  -- only self
  perform t.expect('mfa: staff without MFA cannot see customers', t.count('select 1 from public.organizations'), 0::bigint);
  perform t.login(U_SUPER, 'aal2');
  perform t.expect('mfa: super admin with MFA sees all staff', t.count('select 1 from public.platform_users'), 3::bigint);
  perform t.expect('mfa: super admin sees all customers', t.count('select 1 from public.organizations'), 2::bigint);
  perform t.expect('mfa: super admin cannot read tenant employees', t.count('select 1 from public.employees'), 0::bigint);
  perform t.login(U_SALES, 'aal2');
  perform t.expect('rbac: sales can see customers', t.count('select 1 from public.organizations'), 2::bigint);
  perform t.expect('rbac: sales cannot see invoices', t.count('select 1 from public.invoices'), 0::bigint);
  perform t.expect('rbac: sales cannot manage platform staff', t.affected($q$update public.platform_users set role='super_admin' where role='sales'$q$), 0::bigint);
  perform t.login(U_SUP, 'aal2');
  perform t.expect('rbac: support cannot edit statutory rules', t.affected($q$update public.statutory_rules set value='99999'::jsonb$q$), 0::bigint);
  perform t.login(U_SUPER, 'aal2');
  perform t.expect('rbac: super admin can publish statutory rules', t.affected($q$update public.statutory_rules set note = note where rule_key='pf.wageCeiling'$q$), 2::bigint);
  perform t.login(U_HR, 'aal2');
  perform t.expect('rbac: customer cannot edit statutory rules', t.affected($q$update public.statutory_rules set value='99999'::jsonb$q$), 0::bigint);
  perform t.expect('rbac: customer can read statutory rules', (t.count('select 1 from public.statutory_rules') > 10), true);

  -- ================= organisation lifecycle protection =================
  perform t.login(U_OWNER, 'aal2');
  perform t.works('org: owner can edit company profile', format($q$update public.organizations set legal_name='Acme Private Limited' where id=%L$q$, a));
  perform t.throws('org: owner cannot change own status', format($q$update public.organizations set status='active' where id=%L$q$, a), 'Only HumaNest staff');
  perform t.throws('org: owner cannot extend own trial', format($q$update public.organizations set trial_ends_at = now() + interval '5 years' where id=%L$q$, a), 'Only HumaNest staff');
  perform t.expect('org: owner cannot change licence', t.affected(format($q$update public.organization_licenses set seats_total=9999 where org_id=%L$q$, a)), 0::bigint);
  perform t.expect('org: owner cannot enable modules', t.affected(format($q$update public.organization_modules set enabled=true where org_id=%L$q$, a)), 0::bigint);
  perform t.login(U_SALES, 'aal2');
  perform t.works('org: sales can suspend a customer', format($q$update public.organizations set status='suspended', status_reason='non payment' where id=%L$q$, a));
  perform t.login(U_HR, 'aal2');
  perform t.expect('org: suspended customer loses data access', t.count('select 1 from public.employees'), 0::bigint);
  perform t.login(U_SALES, 'aal2');
  perform t.works('org: sales reactivates', format($q$update public.organizations set status='active', status_reason=null where id=%L$q$, a));
  perform t.login(U_HR, 'aal2');
  perform t.expect('org: reactivated customer regains access', t.count('select 1 from public.employees'), 7::bigint);
  perform t.logout();
  update public.organizations set status='trial', trial_ends_at = now() - interval '1 day' where id = a;
  perform t.login(U_HR, 'aal2');
  perform t.expect('org: expired trial blocks access', t.count('select 1 from public.employees'), 0::bigint);
  perform t.logout();
  update public.organizations set status='active', trial_ends_at = null where id = a;

  -- ================= audit trail =================
  perform t.login(U_AUD);
  perform t.expect('audit: auditor without MFA cannot read audit log', t.count('select 1 from public.audit_logs'), 0::bigint);
  perform t.login(U_AUD, 'aal2');
  perform t.expect('audit: auditor with MFA reads audit log', (t.count('select 1 from public.audit_logs') > 0), true);
  perform t.throws('audit: authenticated cannot insert audit rows', format($q$insert into public.audit_logs (org_id, action) values (%L,'forged')$q$, a));
  perform t.throws('audit: authenticated cannot delete audit rows', $q$delete from public.audit_logs$q$);
  perform t.login(U_OWNER, 'aal2');
  perform t.expect('audit: owner cannot see other org audit', t.count(format('select 1 from public.audit_logs where org_id=%L', b)), 0::bigint);
  perform t.logout();
  perform t.throws('audit: even the table owner cannot edit history', $q$update public.audit_logs set action='x'$q$, 'append-only');
  perform t.throws('audit: even the table owner cannot delete history', $q$delete from public.audit_logs$q$, 'append-only');
  perform t.expect('audit: chain verifies clean', (select ok from app.verify_audit_chain(a)), true);
  alter table public.audit_logs disable trigger user;
  update public.audit_logs set detail = '{"tampered":true}'::jsonb where seq = (select min(seq) from public.audit_logs where org_id = a);
  alter table public.audit_logs enable trigger user;
  perform t.expect('audit: tampering is detected', (select ok from app.verify_audit_chain(a)), false);
end $$;
