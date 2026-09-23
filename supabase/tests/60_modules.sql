\set ON_ERROR_STOP 1
update public.organization_modules set enabled = true
 where org_id = t.id('orgA') and module_code in ('expenses','helpdesk','recruitment','performance','assets','offboarding');

do $$
declare
  U_OWNER constant uuid := '00000000-0000-0000-0000-0000000000b1'; U_HR constant uuid := '00000000-0000-0000-0000-0000000000b2';
  U_MGR constant uuid := '00000000-0000-0000-0000-0000000000b3'; U_E1 constant uuid := '00000000-0000-0000-0000-0000000000b4';
  U_E2 constant uuid := '00000000-0000-0000-0000-0000000000b5'; U_PAY constant uuid := '00000000-0000-0000-0000-0000000000b6';
  U_FIN constant uuid := '00000000-0000-0000-0000-0000000000b8'; U_GOWN constant uuid := '00000000-0000-0000-0000-0000000000c1';
  a uuid := t.id('orgA'); b uuid := t.id('orgB');
  claim uuid; req uuid; tk uuid; cand uuid; rq uuid; ast uuid; ax uuid; cyc uuid; rv uuid; x uuid; res text; n bigint;
begin
  -- ================= expenses =================
  perform t.logout();
  insert into public.expense_policies (org_id, category, per_claim_limit, receipt_required_above) values (a, 'travel', 5000, 500);
  perform t.login(U_E1);
  insert into public.expense_claims (org_id, employee_id, title) values (a, t.id('e1'), 'Client visit Pune') returning id into claim;
  perform t.throws('exp: over the per-claim limit is refused', format($q$insert into public.expense_items (org_id, claim_id, expense_date, category, amount, receipt_path) values (%L,%L,current_date,'travel',6000,'r.pdf')$q$, a, claim), 'POLICY');
  perform t.throws('exp: receipt required above threshold', format($q$insert into public.expense_items (org_id, claim_id, expense_date, category, amount) values (%L,%L,current_date,'travel',900)$q$, a, claim), 'receipt is required');
  perform t.throws('exp: future dated expense refused', format($q$insert into public.expense_items (org_id, claim_id, expense_date, category, amount) values (%L,%L,current_date + 5,'travel',100)$q$, a, claim));
  perform t.works('exp: valid line accepted', format($q$insert into public.expense_items (org_id, claim_id, expense_date, category, amount, receipt_path) values (%L,%L,current_date,'travel',1800,'cab.pdf'),(%L,%L,current_date,'travel',200,null)$q$, a, claim, a, claim));
  perform t.expect('exp: claim total maintained', (select total from public.expense_claims where id = claim), 2000::numeric);
  perform t.login(U_E2);
  perform t.expect('exp: colleague cannot see the claim', t.count('select 1 from public.expense_claims'), 0::bigint);
  perform t.throws('exp: colleague cannot submit it', format('select app.submit_expense(%L)', claim), 'Not permitted');
  perform t.login(U_E1);
  req := app.submit_expense(claim);
  perform t.expect('exp: submitted', (select status from public.expense_claims where id = claim), 'submitted');
  perform t.throws('exp: submitted claim cannot get new lines', format($q$insert into public.expense_items (org_id, claim_id, expense_date, category, amount, receipt_path) values (%L,%L,current_date,'travel',100,'x.pdf')$q$, a, claim), 'draft claim');
  perform t.expect('exp: employee cannot forge approval', t.affected(format($q$update public.expense_claims set status='approved' where id=%L$q$, claim)), 0::bigint);
  perform t.login(U_MGR);
  perform t.expect('exp: manager sees team claim', t.count('select 1 from public.expense_claims'), 1::bigint);
  perform t.expect('exp: manager approves, finance next', app.decide_approval(req, 'approve'), 'pending');
  perform t.login(U_HR);
  perform t.throws('exp: HR without expenses.approve cannot decide', format($q$select app.decide_approval(%L,'approve')$q$, req), 'not the approver');
  perform t.login(U_FIN);
  perform t.expect('exp: finance approves', app.decide_approval(req, 'approve'), 'approved');
  perform t.expect('exp: claim approved', (select status from public.expense_claims where id = claim), 'approved');
  perform t.logout();
  perform t.expect('exp: reimbursement queued for payroll', (select amount from public.pay_adjustments where kind = 'reimbursement' and employee_id = t.id('e1')), 2000::numeric);
  update public.pay_adjustments set status = 'applied' where kind = 'reimbursement' and employee_id = t.id('e1');
  perform t.expect('exp: claim marked paid once payroll applies it', (select status from public.expense_claims where id = claim), 'paid');

  -- ================= helpdesk =================
  perform t.login(U_E1);
  insert into public.helpdesk_tickets (org_id, employee_id, subject, description) values (a, t.id('e1'), 'Form 16 not received', 'Please share Form 16') returning id into tk;
  perform t.expect('hd: ticket number generated', (select ticket_no from public.helpdesk_tickets where id = tk), 'HD-00001');
  perform t.expect('hd: SLA due date set', (select due_at is not null from public.helpdesk_tickets where id = tk), true);
  perform t.throws('hd: cannot raise a ticket as someone else', format($q$insert into public.helpdesk_tickets (org_id, employee_id, subject, description) values (%L,%L,'x','y')$q$, a, t.id('e2')));
  perform t.login(U_E2);
  perform t.expect('hd: colleague cannot see the ticket', t.count('select 1 from public.helpdesk_tickets'), 0::bigint);
  perform t.login(U_HR);
  perform t.expect('hd: HR sees the ticket', t.count('select 1 from public.helpdesk_tickets'), 1::bigint);
  perform t.works('hd: HR adds an internal note', format($q$insert into public.helpdesk_comments (org_id, ticket_id, body, is_internal) values (%L,%L,'Check with payroll',true)$q$, a, tk));
  perform t.works('hd: HR replies', format($q$insert into public.helpdesk_comments (org_id, ticket_id, body) values (%L,%L,'Will share by Friday')$q$, a, tk));
  perform t.works('hd: HR resolves', format($q$update public.helpdesk_tickets set status='resolved' where id=%L$q$, tk));
  perform t.expect('hd: resolved time stamped', (select resolved_at is not null from public.helpdesk_tickets where id = tk), true);
  perform t.login(U_E1);
  perform t.expect('hd: employee sees only the public reply', t.count('select 1 from public.helpdesk_comments'), 1::bigint);
  perform t.throws('hd: employee cannot write an internal note', format($q$insert into public.helpdesk_comments (org_id, ticket_id, body, is_internal) values (%L,%L,'x',true)$q$, a, tk));

  -- ================= recruitment =================
  perform t.login(U_HR);
  insert into public.job_requisitions (org_id, title, headcount) values (a, 'Senior Accountant', 2) returning id into rq;
  perform t.works('rec: HR opens a requisition draft', 'select 1');
  res := (select app.submit_requisition(rq))::text;
  perform t.expect('rec: awaiting approval', (select status from public.job_requisitions where id = rq), 'pending_approval');
  perform t.throws('rec: HR cannot approve their own submission', format($q$select app.decide_approval(%L,'approve')$q$, res::uuid), 'your own request');
  perform t.login(U_OWNER);
  perform t.expect('rec: owner approves requisition', app.decide_approval(res::uuid, 'approve'), 'approved');
  perform t.expect('rec: requisition open', (select status from public.job_requisitions where id = rq), 'open');
  perform t.login(U_HR);
  insert into public.candidates (org_id, requisition_id, full_name, email, consent_at) values (a, rq, 'Riya Sharma', 'riya@example.com', now()) returning id into cand;
  perform t.login(U_E2);
  perform t.expect('rec: employees cannot browse candidates', t.count('select 1 from public.candidates'), 0::bigint);
  perform t.login(U_HR);
  insert into public.interviews (org_id, candidate_id, interviewer_employee_id, scheduled_at) values (a, cand, t.id('e2'), now() + interval '2 days');
  perform t.login(U_E2);
  perform t.expect('rec: interviewer sees the candidate they interview', t.count('select 1 from public.candidates'), 1::bigint);
  perform t.works('rec: interviewer submits feedback', format($q$update public.interviews set score=8, feedback='Strong', recommendation='yes', status='completed' where candidate_id=%L$q$, cand));
  perform t.expect('rec: interviewer cannot see offers', t.count('select 1 from public.offers'), 0::bigint);
  perform t.expect('rec: interviewer cannot move the candidate', t.affected(format($q$update public.candidates set stage='hired' where id=%L$q$, cand)), 0::bigint);
  perform t.login(U_GOWN);
  perform t.throws('rec: other tenant without the module is gated', format($q$insert into public.job_requisitions (org_id, title) values (%L,'Nope')$q$, b), 'not enabled');

  -- ================= performance =================
  perform t.login(U_HR);
  insert into public.review_cycles (org_id, name, period_start, period_end, status) values (a, 'FY26-27 H1', '2026-04-01', '2026-09-30', 'active') returning id into cyc;
  perform t.login(U_E1);
  perform t.works('perf: employee writes a goal', format($q$insert into public.goals (org_id, employee_id, cycle_id, title, weight) values (%L,%L,%L,'Close books in 5 days',40)$q$, a, t.id('e1'), cyc));
  perform t.works('perf: employee submits self review', format($q$insert into public.reviews (org_id, cycle_id, employee_id, reviewer_employee_id, review_type, rating, comments, status) values (%L,%L,%L,%L,'self',4,'Good half','submitted')$q$, a, cyc, t.id('e1'), t.id('e1')));
  perform t.throws('perf: employee cannot write a manager review for themselves', format($q$insert into public.reviews (org_id, cycle_id, employee_id, reviewer_employee_id, review_type, rating) values (%L,%L,%L,%L,'manager',5)$q$, a, cyc, t.id('e1'), t.id('e1')));
  perform t.login(U_E2);
  perform t.expect('perf: colleague cannot see the goal', t.count('select 1 from public.goals'), 0::bigint);
  perform t.login(U_MGR);
  perform t.expect('perf: manager sees report''s goal', t.count('select 1 from public.goals'), 1::bigint);
  perform t.works('perf: manager writes review', format($q$insert into public.reviews (org_id, cycle_id, employee_id, reviewer_employee_id, review_type, rating, comments, status) values (%L,%L,%L,%L,'manager',3,'Needs improvement on timeliness','submitted')$q$, a, cyc, t.id('e1'), t.id('mgr')));
  perform t.login(U_E1);
  perform t.expect('perf: manager review is hidden until released', t.count($q$select 1 from public.reviews where review_type='manager'$q$), 0::bigint);
  perform t.expect('perf: own self review visible', t.count($q$select 1 from public.reviews where review_type='self'$q$), 1::bigint);
  perform t.login(U_MGR);
  perform t.expect('perf: manager cannot release the review', t.affected($q$update public.reviews set released=true where review_type='manager'$q$), 0::bigint);
  perform t.login(U_HR);
  perform t.expect('perf: HR releases reviews', t.affected($q$update public.reviews set released=true where review_type='manager'$q$), 1::bigint);
  perform t.login(U_E1);
  perform t.expect('perf: released review now visible to employee', t.count($q$select 1 from public.reviews where review_type='manager'$q$), 1::bigint);

  -- ================= assets =================
  perform t.login(U_HR);
  insert into public.assets (org_id, asset_tag, name, category, serial_no) values (a, 'LT-0001', 'Dell Latitude 5440', 'laptop', 'SN123') returning id into ast;
  insert into public.asset_allocations (org_id, asset_id, employee_id) values (a, ast, t.id('e2')) returning id into ax;
  perform t.expect('asset: allocation marks asset allocated', (select status from public.assets where id = ast), 'allocated');
  perform t.throws('asset: cannot allocate the same asset twice', format($q$insert into public.asset_allocations (org_id, asset_id, employee_id) values (%L,%L,%L)$q$, a, ast, t.id('e1')), 'duplicate key');
  perform t.login(U_E2);
  perform t.expect('asset: employee sees own allocation', t.count('select 1 from public.asset_allocations'), 1::bigint);
  perform t.expect('asset: employee cannot browse the register', t.count('select 1 from public.assets'), 0::bigint);
  perform t.works('asset: employee acknowledges receipt', format($q$update public.asset_allocations set acknowledged_at = now() where id=%L$q$, ax));
  perform t.login(U_E1);
  perform t.expect('asset: colleague sees none', t.count('select 1 from public.asset_allocations'), 0::bigint);

  -- ================= offboarding =================
  perform t.login(U_E2);
  x := app.submit_resignation('Relocating to Bengaluru', current_date + 30);
  perform t.throws('exit: only one open resignation', $q$select app.submit_resignation('again')$q$, 'duplicate key');
  req := (select approval_request_id from public.exit_requests where id = x);
  perform t.login(U_MGR);
  perform t.expect('exit: manager approves', app.decide_approval(req, 'approve'), 'pending');
  perform t.login(U_HR);
  perform t.expect('exit: HR approves', app.decide_approval(req, 'approve'), 'approved');
  perform t.logout();
  perform t.expect('exit: employee on notice', (select status from public.employees where id = t.id('e2')), 'on_notice');
  perform t.expect('exit: last working day set', (select exit_date from public.employees where id = t.id('e2')), current_date + 30);
  perform t.expect('exit: history recorded', (select count(*) from public.employee_history where employee_id = t.id('e2') and change_type = 'exit'), 1::bigint);
  perform t.expect('exit: clearance checklist created', (select count(*) from public.clearance_tasks where exit_id = x), 5::bigint);
  perform t.login(U_HR);
  perform t.throws('exit: cannot complete with clearance pending', format('select app.complete_exit(%L)', x), 'Clearance is incomplete');
  perform t.works('exit: HR clears the tasks', format($q$update public.clearance_tasks set status='done', done_at=now() where exit_id=%L$q$, x));
  perform t.throws('exit: cannot complete while the laptop is unreturned', format('select app.complete_exit(%L)', x), 'assets have not been returned');
  perform t.works('exit: laptop returned', format($q$update public.asset_allocations set returned_on = current_date where id=%L$q$, ax));
  perform t.expect('exit: returned asset is available again', (select status from public.assets where id = ast), 'available');
  perform t.login(U_E1);
  perform t.throws('exit: employee cannot complete an exit', format('select app.complete_exit(%L)', x), 'Not permitted');
  perform t.login(U_HR);
  perform t.works('exit: HR completes the exit', format('select app.complete_exit(%L)', x));
  perform t.expect('exit: employee is exited', (select status from public.employees where id = t.id('e2')), 'exited');
  perform t.login(U_E2);
  perform t.expect('exit: access revoked after exit', t.count('select 1 from public.employees'), 0::bigint);
end $$;
