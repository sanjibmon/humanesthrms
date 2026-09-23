# HumaNest — go-live runbook

Checked against the live schema in Supabase project `acxitxszyhmqskswetej`. Column
names, role names, status values and RPC signatures are real, not remembered.

---

## What changed in this build

The admin portal is no longer read-only. It now has working create, edit and
delete across every screen, plus real email invitations.

- **Customers** — Add Customer creates the organisation, its licence and its
  modules in one database transaction, and emails the owner an invitation. Edit,
  suspend, reactivate, and a guarded hard delete that makes you type the company
  name. Trials can be extended or converted; converting swaps the licence and
  re-syncs modules to the new plan, switching off anything the new plan does not
  grant, deepest dependency first.
- **Customer detail page** — per-customer module toggles (dependencies enforced
  by the database), licence editing with negotiated pricing and seat caps,
  invite/deactivate portal users.
- **Trials** — live trials, a lapsed-trial warning, and the conversion funnel.
- **Licences & plans** — edit plan names, prices, seat caps and whether a plan is
  still sellable, plus a click-to-toggle matrix of which modules each plan grants.
- **Module catalog** — add, edit and delete modules, with dependency declarations.
- **Platform users** — invite staff by email, change roles, deactivate, delete.
  Guards stop you removing the last super admin or locking yourself out.
- **Support** — full ticket workflow against the real vocabulary the database
  allows (open / in progress / resolved; technical / billing / feature request).
- **Reports** — revenue, plan mix, module adoption, industry mix and the trial
  funnel, all computed from live rows.
- **Settings** — environment health, the Resend setup steps, and the statutory
  rule book with the citation behind every number.

Three new migrations were applied and verified: `0015` (provisioning RPCs),
`0016` (platform visibility of org members), `0017` (exposing the `api` schema to
PostgREST — without it every RPC returned 404).

The customer portal is still read-only. That is the next phase.

---

## Step 1 — GitHub

Extract `humanest-source.zip`, then from that folder run `setup-and-push.cmd`, or:

```bash
git init && git add . && git commit -m "HumaNest"
git branch -M main
git remote add origin https://github.com/<you>/humanest.git
git push -u origin main
```

## Step 2 — Vercel

Both projects exist with root directories and environment variables already set.

| Project | ID | Root directory |
|---|---|---|
| `humanest-admin` | `prj_uks3dQSkCYJeqMP6MnCh6LOHZcV8` | `apps/admin` |
| `humanest-customer` | `prj_bfFAkvcG7FFHvopAFDDBHGEIKsdn` | `apps/customer` |

Open each → Settings → Git → Connect → pick the repo. The build starts by itself.

**One variable you must add yourself**, because it is a secret I will not handle:

1. Supabase → Project Settings → API → copy the **service_role** key.
2. Vercel → each project → Settings → Environment Variables → add
   `SUPABASE_SERVICE_ROLE_KEY`, scope **Production**, mark it **Sensitive**.
3. Redeploy.

Without it the portal still runs, but nobody can be invited by email — the
Settings page will say so in plain words. Never prefix it with `NEXT_PUBLIC_`.

`NEXT_PUBLIC_SITE_URL` is already set to `https://admin.humanest.co.in` and
`https://portal.humanest.co.in`. Change the second one if you pick a different
subdomain.

## Step 3 — Email (Resend)

Supabase's built-in mailer sends a handful per hour and is not for production.

1. Sign up at resend.com, add **humanest.co.in** as a domain, publish the DNS
   records it gives you, wait for verification.
2. Create an API key.
3. Supabase → Project Settings → Authentication → SMTP Settings → enable custom
   SMTP: host `smtp.resend.com`, port `465`, username `resend`, password = the
   API key, sender `HumaNest <no-reply@humanest.co.in>`.
4. Supabase → Authentication → URL Configuration → set Site URL to the admin
   portal and add both portals plus `/auth/callback` to Redirect URLs.

## Step 4 — the first super admin

`app.platform_can()` only returns true for a row in `platform_users`, in an
**AAL2** (authenticator-verified) session. Nothing in the portal can create that
first row, so it is seeded once by hand.

1. Supabase → Authentication → Users → **Add user** → your email, a strong
   password, tick **Auto Confirm User**. Copy the UUID.
2. SQL Editor (runs as `postgres`, so RLS does not block it):

```sql
insert into public.platform_users (id, email, full_name, role, is_active)
values ('<the uuid>', 'you@humanest.co.in', 'Your Name', 'super_admin', true);
```

3. Sign in at the admin portal. You land on the MFA screen with a QR code.

### How the authenticator actually works

Creating the user in the dashboard does not create anything for the authenticator
app, and it does not need to. TOTP is not issued by the server — it is enrolled by
the user on first sign-in:

- The app calls `mfa.enroll()`. Supabase generates a secret and returns it as a QR
  code plus the raw string.
- You scan it into Google Authenticator, Authy, Microsoft Authenticator or
  1Password. The app stores the secret on your phone.
- You type the six digits once; `mfa.verify()` confirms the phone and the server
  agree, and the factor becomes `verified`.
- After that, every sign-in asks for a code. Your phone computes it from the
  secret plus the current 30-second time window — offline, no SMS, no email. The
  server computes the same number and compares.

Until that first code is verified the session is AAL1, `app.platform_can()`
returns false, and every list is empty. That is the system working. The middleware
will not release a protected route below AAL2.

Everyone invited afterwards — staff or customer — goes through the same flow:
email invitation → `/auth/callback` → `/auth/set-password` → authenticator
enrolment → portal.

## Step 5 — creating a customer, end to end

All of this is now clickable; the SQL below is only for reference.

**Trial.** Customers → Add Customer. Four steps: company details (the short name
auto-fills from the company name and is validated against the database's own
pattern), plan and seats, statutory identifiers (PAN, TAN, GSTIN each validated
against the real regex), and the owner's email. On save, one transaction creates
the organisation, the licence and every module the plan grants, then the owner is
emailed.

**Extend.** Trials → Extend. Adds 7, 14 or 30 days from whichever is later —
today or the current end date — and increments the extension counter.

**Convert.** Trials or Customers → Convert. Sets the account active, swaps the
licence, sets the next billing date, and re-syncs modules to the new plan.

**Downgrade.** Change the plan on the licence, then Re-sync to plan on the
customer page. Non-core modules the new plan does not grant switch off in
dependency order; core modules never do.

**Suspend / reactivate.** Suspension blocks sign-in and leaves data intact.

**Delete.** Type the company name to confirm. Cascades through employees, pay
runs, leave, documents and audit rows. A customer with invoices is refused —
cancel the account instead so the billing history survives.

**Seats.** `app.enforce_seat_limit()` raises `SEAT_LIMIT_REACHED` on the employee
insert that would exceed the licence, unless you turn off over-allocation
blocking on that customer's licence.

### What each plan grants

| Plan | Price / seat | Max seats | Modules |
|---|---|---|---|
| `trial` | ₹0 | 50 | 16 |
| `starter` | ₹199 | 50 | 7 |
| `growth` | ₹299 | 200 | 16 |
| `enterprise` | ₹499 | unlimited | 20 |

Editable from Licences & Plans.

### Platform roles

| Role | Permissions |
|---|---|
| `super_admin` | edit_modules, manage_customers, manage_licenses, manage_platform_users, manage_statutory_rules, support_access, view_audit_logs, view_revenue |
| `sales` | edit_modules, manage_customers |
| `finance` | manage_licenses, view_revenue |
| `support` | support_access, view_audit_logs |

Every screen hides what your role cannot do, and the database refuses it again if
anyone gets past the UI.

---

## Step 6 — testing the admin portal

Do these in order; each one exercises a guard that should hold.

1. Sign in, enrol the authenticator, confirm the dashboard loads.
2. Add a customer as a 14-day trial with an owner email. Check the invitation
   arrives, the link lands on Set Password, and the authenticator is then forced.
3. Open the customer. Toggle a module **on** whose dependency is off — the
   database should refuse with a readable sentence, not a stack trace.
4. Try to disable a core module — the switch is disabled, and the database would
   refuse anyway.
5. Edit the licence down to fewer seats than employees, then try adding an
   employee — expect `SEAT_LIMIT_REACHED`.
6. Extend the trial, then convert it to Growth. Check the modules re-synced.
7. Downgrade to Starter and re-sync. Nine modules should switch off; the seven
   Starter modules and the core ones stay.
8. Deactivate the only owner — expect the last-owner guard to refuse.
9. Invite a second staff member as `sales`. Sign in as them and confirm Licences
   is read-only and Platform Users is not offered.
10. Try to delete a customer with the wrong name typed — expect a refusal.
11. Raise a ticket, start it, resolve it, reopen it, delete it.
12. Delete the test customer with the correct name. Confirm it and everything
    under it is gone.

## Before a paying customer

1. Run `npm install && npm run typecheck` in each app once and send me anything it
   reports. The sandbox that wrote this code cannot install npm packages, so it
   type-checks against hand-written stubs for `next`, `react` and `@supabase`;
   those model the APIs we call but not the entire React DOM surface. Once it is
   clean, delete the `typescript: { ignoreBuildErrors: true }` block from both
   `next.config.mjs` files.
2. Supabase Free has no backups and pauses after a week idle. Move to Pro before
   real employee data lands.
3. EPFO's ₹25,000 ceiling was a Cabinet decision on 16 Sep 2026 with no effective
   date; the engine holds ₹15,000 until the Gazette notification. Check
   Professional Tax and LWF for your launch states against the state notifications.
4. Penetration test and a DPDP review of the consent and reveal flows.
5. Only then move `apps.humanest.co.in` off the marketing page.
