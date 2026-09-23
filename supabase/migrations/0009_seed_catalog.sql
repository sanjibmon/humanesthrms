-- Reference data every environment needs: module catalog, plans, permission catalogs, states.
-- Prices are in paise per seat per month, excluding GST.

-- ---------------------------------------------------------------------------------------------
-- Modules. Dependencies are enforced by a trigger; core modules cannot be switched off.
-- ---------------------------------------------------------------------------------------------
insert into public.modules (code, name, description, is_core, default_enabled, depends_on, sort_order) values
  ('employee_core', 'Core HR',            'Employee directory, org structure, documents, history, ESS',          true,  true,  '{}',                                   10),
  ('approvals',     'Approvals',          'Multi-step approval engine used by leave, attendance, expenses, exits', true,  true,  '{}',                                   20),
  ('attendance',    'Attendance',         'Web/mobile punch, geofence, shifts, regularisation, biometric import', false, true,  '{employee_core}',                      30),
  ('leave',         'Leave',              'Leave policies, ledger, holidays, encashment, approvals',              false, true,  '{employee_core,approvals}',            40),
  ('payroll',       'Payroll',            'CTC structures, pay runs, payslips, F&F, Form 16 data',                false, false, '{employee_core,attendance,leave}',     50),
  ('statutory',     'Statutory & Compliance', 'PF ECR, ESI, PT, LWF, TDS challans, returns calendar',            false, false, '{payroll}',                            60),
  ('loans',         'Loans & Advances',   'Salary advances and loans with EMI recovery through payroll',          false, false, '{payroll}',                            70),
  ('expenses',      'Expenses & Reimbursements', 'Claims, receipts, policy limits, payout through payroll',       false, false, '{employee_core,approvals}',            80),
  ('recruitment',   'Recruitment (ATS)',  'Requisitions, jobs, candidates, interviews, offers',                   false, false, '{employee_core}',                      90),
  ('performance',   'Performance',        'Goals/OKRs, review cycles, 360 feedback, 1:1s',                        false, false, '{employee_core}',                      100),
  ('helpdesk',      'HR Helpdesk',        'Employee queries with SLA tracking and a knowledge base',              false, false, '{employee_core}',                      110),
  ('assets',        'Assets',             'Asset register, allocation, return at exit',                           false, false, '{employee_core}',                      120),
  ('offboarding',   'Offboarding',        'Resignation, notice, clearance checklist, exit interview, F&F',        false, false, '{employee_core,approvals}',            130)
on conflict (code) do nothing;

-- Plan structure and prices follow the product prompt: Starter Rs 199, Growth Rs 299, Enterprise Rs 499 per seat per month
-- (stored in paise, excluding GST). Which modules Growth includes beyond payroll and recruitment is an assumption to confirm.
insert into public.plans (code, name, price_per_seat_paise, max_seats, features) values
  ('starter',    'Starter',    19900, 50,   '{"support":"email","api":false,"sso":false}'),
  ('growth',     'Growth',     29900, 200,  '{"support":"email+chat","api":false,"sso":false,"most_popular":true}'),
  ('enterprise', 'Enterprise', 49900, null, '{"support":"priority","api":true,"sso":true}')
on conflict (code) do nothing;

insert into public.plan_modules (plan_id, module_code)
select p.id, m.code from public.plans p join public.modules m on
  (p.code = 'starter'    and m.code in ('employee_core','approvals','attendance','leave','helpdesk'))
  or (p.code = 'growth'  and m.code in ('employee_core','approvals','attendance','leave','helpdesk','payroll','statutory','loans','expenses','recruitment','assets','offboarding'))
  or (p.code = 'enterprise')
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------
-- HumaNest staff permissions
-- ---------------------------------------------------------------------------------------------
insert into public.platform_permissions (code, description) values
  ('manage_platform_users',  'Create and deactivate HumaNest staff accounts and change role permissions'),
  ('manage_customers',       'Create and suspend customer organisations'),
  ('manage_licenses',        'Change plans, seats and issue invoices'),
  ('edit_modules',           'Enable or disable modules for a customer'),
  ('manage_statutory_rules', 'Publish statutory rates, PT slabs and LWF tables'),
  ('support_access',         'Request time-boxed, customer-approved access to a customer''s data'),
  ('view_audit_logs',        'Read the platform audit log'),
  ('view_revenue',           'See billing and revenue dashboards')
on conflict do nothing;

insert into public.platform_role_permissions (role, permission) values
  ('super_admin','manage_platform_users'),('super_admin','manage_customers'),('super_admin','manage_licenses'),
  ('super_admin','edit_modules'),('super_admin','manage_statutory_rules'),('super_admin','support_access'),
  ('super_admin','view_audit_logs'),('super_admin','view_revenue'),
  ('support','support_access'),('support','view_audit_logs'),
  ('sales','manage_customers'),('sales','edit_modules'),
  ('finance','manage_licenses'),('finance','view_revenue')
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------
-- Customer role permissions (copied into each new organisation, which can then customise them).
-- Least privilege: HR does not see payroll unless granted; managers act through team-scoped policies.
-- ---------------------------------------------------------------------------------------------
insert into public.default_org_role_permissions (role, permission) values
  ('owner', '*'),
  -- HR administrator
  ('hr_admin','people.read'),('hr_admin','people.write'),('hr_admin','people.sensitive.read'),('hr_admin','people.sensitive.write'),
  ('hr_admin','attendance.read'),('hr_admin','attendance.write'),('hr_admin','attendance.approve'),
  ('hr_admin','leave.read'),('hr_admin','leave.approve'),('hr_admin','leave.config'),
  ('hr_admin','approvals.read'),('hr_admin','settings.read'),('hr_admin','settings.write'),('hr_admin','members.read'),
  ('hr_admin','audit.read'),('hr_admin','reports.read'),
  ('hr_admin','recruitment.read'),('hr_admin','recruitment.write'),
  ('hr_admin','performance.read'),('hr_admin','performance.write'),('hr_admin','performance.admin'),
  ('hr_admin','helpdesk.read'),('hr_admin','helpdesk.manage'),('hr_admin','assets.read'),('hr_admin','assets.manage'),
  ('hr_admin','expenses.read'),('hr_admin','offboarding.read'),('hr_admin','offboarding.manage'),
  ('hr_admin','compliance.read'),('hr_admin','privacy.manage'),
  -- Payroll administrator
  ('payroll_admin','people.read'),('payroll_admin','people.sensitive.read'),('payroll_admin','pii.reveal'),
  ('payroll_admin','attendance.read'),('payroll_admin','leave.read'),('payroll_admin','settings.read'),
  ('payroll_admin','payroll.read'),('payroll_admin','payroll.run'),('payroll_admin','payroll.config'),
  ('payroll_admin','compliance.read'),('payroll_admin','compliance.file'),('payroll_admin','expenses.read'),
  ('payroll_admin','reports.read'),('payroll_admin','offboarding.read'),
  -- Finance approver (maker-checker second signature and payout)
  ('finance_approver','payroll.read'),('finance_approver','payroll.approve'),('finance_approver','payroll.pay'),
  ('finance_approver','expenses.read'),('finance_approver','expenses.approve'),('finance_approver','expenses.pay'),
  ('finance_approver','compliance.read'),('finance_approver','reports.read'),
  -- Recruiter
  ('recruiter','recruitment.read'),('recruiter','recruitment.write'),
  -- Auditor (read only, MFA enforced by the policies themselves)
  ('auditor','attendance.read'),('auditor','leave.read'),('auditor','approvals.read'),
  ('auditor','settings.read'),('auditor','audit.read'),('auditor','reports.read'),('auditor','compliance.read'),
  ('auditor','payroll.read')
on conflict do nothing;
-- manager and employee hold no organisation-wide permissions: they work through team and self scoped policies.

-- ---------------------------------------------------------------------------------------------
-- States and union territories (GST state code style two-letter codes used across the product)
-- ---------------------------------------------------------------------------------------------
insert into public.states (code, name, is_ut) values
  ('AP','Andhra Pradesh',false),('AR','Arunachal Pradesh',false),('AS','Assam',false),('BR','Bihar',false),
  ('CG','Chhattisgarh',false),('GA','Goa',false),('GJ','Gujarat',false),('HR','Haryana',false),
  ('HP','Himachal Pradesh',false),('JH','Jharkhand',false),('KA','Karnataka',false),('KL','Kerala',false),
  ('MP','Madhya Pradesh',false),('MH','Maharashtra',false),('MN','Manipur',false),('ML','Meghalaya',false),
  ('MZ','Mizoram',false),('NL','Nagaland',false),('OD','Odisha',false),('PB','Punjab',false),
  ('RJ','Rajasthan',false),('SK','Sikkim',false),('TN','Tamil Nadu',false),('TG','Telangana',false),
  ('TR','Tripura',false),('UP','Uttar Pradesh',false),('UK','Uttarakhand',false),('WB','West Bengal',false),
  ('AN','Andaman and Nicobar Islands',true),('CH','Chandigarh',true),('DN','Dadra and Nagar Haveli and Daman and Diu',true),
  ('DL','Delhi',true),('JK','Jammu and Kashmir',true),('LA','Ladakh',true),('LD','Lakshadweep',true),('PY','Puducherry',true)
on conflict do nothing;
