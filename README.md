# HumaNest — HRMS platform

Two Next.js applications and one Postgres schema, built for Indian payroll and
statutory compliance.

| Part | Lives in | Runs at |
|---|---|---|
| Platform admin portal (the software company) | `apps/admin` | `admin.humanest.co.in` |
| Customer portal (employers + employee self service) | `apps/customer` | `apps.humanest.co.in` |
| Database, RLS, RPC, audit and seed data | `supabase/migrations` | Supabase project `acxitxszyhmqskswetej` (Mumbai) |
| Clickable HTML prototypes | `prototype/` | open the files directly |
| Logo and colour tokens taken from the live site | `brand/` | — |

## Stack

- Next.js 14 App Router, React 18, TypeScript 5.5, Tailwind 3.4
- Supabase Auth with **mandatory TOTP multi-factor**; middleware refuses any
  protected route until the session reaches AAL2
- Postgres with row level security on every tenant table, a curated `api` schema
  of security-invoker RPCs, and a hash-chained, append-only audit log
- Hosted on Vercel, functions pinned to `bom1` (Mumbai)

## Database at a glance

92 tables · 190 RLS policies · 20 catalog modules (covering the 18 sellable
ones) · 4 plans · statutory reference data seeded (EPF, ESI, Professional Tax
for MH/KA/TN/TG/WB/GJ, LWF, TDS old and new regime, gratuity, bonus) · zero
security advisor lints · **zero customer and employee rows** — nothing is
dummy data.

Sensitive fields follow DPDP data minimisation: PAN and bank details are
encrypted at rest, Aadhaar is stored as the last four digits only, and every
reveal is written to the audit chain.

## Local development

```bash
cd apps/admin      # or apps/customer
cp .env.example .env.local     # fill in the publishable key
npm install
npm run dev
```

Both apps read exactly two environment variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://acxitxszyhmqskswetej.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key from the Supabase dashboard>
```

## Before you trust the build

This tree was written in a sandbox that could not reach the npm registry, so it
has never been compiled. `next.config.mjs` in both apps currently sets
`typescript.ignoreBuildErrors` so the first deployment succeeds. Run

```bash
npm install && npx tsc --noEmit
```

fix whatever it reports, then delete that block from both configs.

## Deploying

See `DEPLOY.md`.
