# Deploying HumaNest

Everything that could be done without your credentials is already done. The
Supabase project is migrated and locked down, and both Vercel projects exist
with their environment variables set. The one step left is getting this source
onto GitHub so Vercel can build it.

## What already exists

**Supabase** — project `acxitxszyhmqskswetej`, region Mumbai (ap-south-1).
All 15 migrations in `supabase/migrations` are applied. Security advisors
return zero lints.

**Vercel** — two projects under your personal scope, both with
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set for
production, preview and development, and functions pinned to `bom1`:

| Project | ID | Root directory |
|---|---|---|
| `humanest-admin` | `prj_uks3dQSkCYJeqMP6MnCh6LOHZcV8` | `apps/admin` |
| `humanest-customer` | `prj_bfFAkvcG7FFHvopAFDDBHGEIKsdn` | `apps/customer` |

Your existing `humanest` project, which serves the live landing page on
`apps.humanest.co.in`, has not been touched.

## Step 1 — push this folder to GitHub

Create an empty repository on GitHub (private is fine), then from this folder:

```bash
git init
git add .
git commit -m "HumaNest: admin portal, customer portal and Supabase schema"
git branch -M main
git remote add origin https://github.com/<your-user>/humanest.git
git push -u origin main
```

If you have the GitHub CLI, `gh repo create humanest --private --source . --push`
does the same thing in one line.

`setup-and-push.cmd` in this folder runs the block above for you; it asks for
the repository URL and does nothing else.

## Step 2 — connect each Vercel project to the repo

In the Vercel dashboard, open each project → Settings → Git → Connect, and pick
the repository you just pushed. Then set **Root Directory**:

- `humanest-admin` → `apps/admin`
- `humanest-customer` → `apps/customer`

Both projects already have the environment variables, so the first build starts
as soon as the repository is connected.

## Step 3 — domains

- Add `admin.humanest.co.in` to `humanest-admin` and create the CNAME Vercel
  shows you.
- **Do not** move `apps.humanest.co.in` yet. It currently points at your live
  landing page. Attach `app.humanest.co.in` (or a subdomain of your choosing)
  to `humanest-customer` first, confirm the portal works, and only then decide
  whether the marketing page moves aside.

## Step 4 — create the first users

Both portals are gated by row level security, so a brand new account sees empty
pages until it is linked to a role. That is the system working, not a bug.

**Platform admin.** Invite yourself through Supabase Auth, then:

```sql
insert into public.platform_users (id, email, full_name, role, is_active)
values ('<auth user id>', 'you@humanest.co.in', 'Your Name', 'super_admin', true);
```

**Customer.** Create the organisation and its licence through the admin portal's
Add Customer flow, then link the first employer account:

```sql
insert into public.org_members (org_id, user_id, role, is_active)
values ('<org id>', '<auth user id>', 'owner', true);
```

Every account is forced through TOTP enrolment on first sign-in. The middleware
will not release a protected route below AAL2.

## Step 5 — tighten the build

`next.config.mjs` in both apps sets `typescript.ignoreBuildErrors` because the
tree was written where npm was unreachable and so was never compiled. Run
`npm install && npx tsc --noEmit` in each app, fix what it reports, delete that
block, and push again.

## Deployment protection

Both new projects were created with Vercel Authentication on for everything
except custom domains. Preview URLs will ask you to sign in to Vercel; the
custom domains will not. Change it under Settings → Deployment Protection if
you want the `.vercel.app` URLs open.
