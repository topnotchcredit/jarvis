# JARVIS

An operations command center for launching and running Shopify brands: one place for brands, stores, money, marketing and AI agents that act inside limits you set.

**This repository is Milestone 1 of 6: the foundation.** It is a working, tested application, but most of the product is not built yet. The table below is the honest state of things; the app itself says the same on every screen.

## What exists today

| Area | State |
| --- | --- |
| Sign up, email confirmation, sign in, sign out, password recovery | Built. Verified end to end in a browser against a local Supabase-equivalent stack. Not yet run against a hosted Supabase project. |
| Organizations, roles (owner, admin, operator, viewer) | Built and verified. Inviting people and changing roles has no screen yet. |
| Tenant isolation (Row Level Security on all 33 tables, composite foreign keys) | Built and verified at the database and through the API. |
| Brands: create and list | Built and verified. |
| Kill switch for autonomous actions | The switch, its audit trail and the policy rule that honours it are built and verified. There are no agents yet for it to stop. |
| Audit log (append-only, written by database triggers) | Built and verified. |
| Full data model for all six milestones | Built: migrations, constraints, indexes, policies. Verified by 52 database tests. |
| Action policy engine (tiers, limits, approvals, margin floor) | Built and unit-tested as a pure function. Nothing calls it yet. |
| Finance calculations | Built and unit-tested against a hand-worked example. No screen, no data source yet. |
| Webhook signature check, credential encryption, log redaction, AI output schema guard | Built and unit-tested. Not wired to anything yet. |
| Shopify connection and sync | **Not built** (Milestone 2). |
| Finance screens, product research, suppliers, launch manager | **Not built** (Milestone 3). |
| AI agents, background jobs, approvals screen, action executor | **Not built** (Milestone 4). |
| Marketing, retention, experiments, executive reports | **Not built** (Milestone 5). |
| Monitoring, alerting, production hardening | **Not built** (Milestone 6). |

`docs/ACCEPTANCE.md` maps each of the specification's 24 acceptance criteria to its status and the test that covers it. No sample or demo figures appear anywhere in the interface.

## Stack

Next.js 16 (App Router, Cache Components) with TypeScript and Tailwind CSS 4; Supabase for Postgres, authentication and Row Level Security; Zod for validation; Vitest, PGlite and Playwright for tests. Versions are pinned in `package.json`. The framework ships breaking changes relative to older Next.js releases; `AGENTS.md` points at the bundled docs.

## Run it locally

Requirements: Node 22 or newer, and a Supabase project (hosted, or `supabase start` with Docker).

1. `npm install`
2. Create a Supabase project. Apply the two files in `supabase/migrations/` in order (SQL editor, or `supabase db push`).
3. In Supabase, under Authentication → URL Configuration, set the Site URL to `http://localhost:3000` and add `http://localhost:3000/**` to the redirect allow-list.
4. `cp .env.example .env.local` and fill in the Supabase URL, publishable key and secret key.
5. `npm run dev`, open http://localhost:3000, create an account, confirm it by email, name your organization.
6. Optional sample records: sign up first, then run `supabase/seed.sql`. Everything it adds is labelled as seed data. Never run it in production.

Without Supabase settings the app shows a setup screen and nothing else.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Route type generation and `tsc` |
| `npm test` | Unit tests and database tests (in-process Postgres; no services needed) |
| `npm run test:e2e` | Browser tests; needs the app running against a local stack, see `tests/e2e/README.md` |
| `npm run check:env` | Fails if a secret-looking variable is exposed to the browser |
| `npm run verify` | check:env, lint, typecheck, test, build |

## Environment variables

See `.env.example` for the full annotated list.

| Variable | Needed | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Now | Compiled in at **build** time. Set before `next build`. |
| `SUPABASE_SECRET_KEY` | Now | Server only. Powers rate limiting today, and server-side writes later. |
| `SITE_URL` | Production | Public origin, used in email links. |
| `APP_ENV` | Recommended | `development`, `staging` or `production`. Use a separate Supabase project for each. |
| `JARVIS_ENCRYPTION_KEY`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | Milestone 2 | |
| `ANTHROPIC_API_KEY` | Milestone 4 | |

## Data model

`supabase/migrations/` holds the schema; the comments in those files are the reference. The essentials:

- Every business row has `organization_id`. Brand and store ownership use composite foreign keys, so a row cannot reference another tenant's brand or store even from server code, and `organization_id` can never be changed.
- Money is `bigint` minor units with an explicit currency code. No floating point.
- An unknown product cost is `NULL`, never zero, and order lines snapshot their cost at order time.
- Shopify identifiers are unique per store, so re-syncing cannot duplicate records. Webhook deliveries are de-duplicated on `X-Shopify-Webhook-Id`.
- Browser clients can write only planning records (suppliers, quotes, expenses, tasks, experiments) and, for admins, brands, budgets and workflows. Stores, synced commerce data, AI runs, the action queue, approvals and metrics are written by server code only. Credentials and webhook events are unreachable from any client.
- Approvals are validated by a database trigger: owner or admin of the same organization, action still pending and unexpired, payload hash matches, and not the requester (unless an owner). A queued action's content cannot be altered afterwards.
- `audit_logs` is append-only for everyone, including server code. An organization with audit history cannot be hard-deleted.

## Security

`docs/SECURITY.md` covers the model, the checklist, backup and restore, and the incident procedure. In short: the session is verified on every request, authorization is enforced in Postgres, secrets stay on the server, responses carry a Content Security Policy and related headers, sign-in is rate limited, and logs are redacted.

## Deploying

Nothing has been deployed from this repository; these are instructions, not a record of a deployment.

1. Create a **production** Supabase project, separate from development. Apply the migrations. Set the Site URL and redirect allow-list to your domain. Configure a real SMTP provider (the built-in mailer is rate limited to a few emails an hour and is meant for testing).
2. Host the app. Vercel runs this Next.js version without configuration, but its free Hobby plan is restricted to non-commercial use, so a business needs Pro. Netlify and others can host Next.js too; their support for this framework version was not checked.
3. Set every variable from `.env.example` in the host, with `APP_ENV=production` and `SITE_URL` set to the public origin, **before** the build runs.
4. Run `npm run verify` in CI (`.github/workflows/ci.yml` is included but has never run on GitHub).

## Expected running costs

Checked on 2026-10-12 against the providers' own pages; confirm before relying on them.

| Item | Cost | Note |
| --- | --- | --- |
| Supabase Free | $0 | 500 MB database, 2 active projects, **paused after 1 week of inactivity, no automatic backups**. Fine for development, not for a live business. |
| Supabase Pro | From $25/month | Daily backups kept 7 days. The realistic minimum for production. |
| Vercel Pro | $20 per developer seat/month | Hobby is free but non-commercial only. |
| Shopify | Your store's plan | Development stores for building and testing were free when last known; confirm in the Shopify dev dashboard. |
| Anthropic API | Usage-based | Not needed until Milestone 4. Per-task cost logging and a monthly AI budget are in the data model. |
| Transactional email (SMTP) | Varies | Needed in production for confirmation and reset emails. |

A realistic production floor is therefore about $45/month before Shopify and AI usage. Free tiers do not cover unlimited traffic, jobs or API calls.

## Known limitations

- Auth was verified against Supabase Auth v2.177 and PostgREST 12.2 running locally, not against a hosted project. Hosted projects add a gateway and the newer key format; expect to confirm the flow once after connecting.
- A user's first organization is the active one; there is no organization switcher.
- No screens yet for inviting members, changing roles, or editing budgets. The database enforces all three.
- The Content Security Policy allows inline scripts, which this framework needs unless every page is rendered per request with a nonce. Other directives are strict.
- Rate limiting needs `SUPABASE_SECRET_KEY`. Without it the app logs a warning and relies on Supabase's own limits. With it, a limiter failure blocks the attempt rather than allowing it.
- Rate limits key on the client IP from `X-Forwarded-For`, which is only trustworthy behind a host that sets it.
- An unknown address inside the signed-in area shows the not-found screen with HTTP 200 rather than 404.
- `npm audit` reports 5 high-severity findings, all in ESLint tooling used only at development time. Production dependencies report none.
- Refunds reduce net sales in the finance calculations, but the cost of refunded goods is not reversed (no restock data yet).
- The local test stack scripts under `tests/e2e/local-stack/` are for environments without Docker and download nothing themselves.

## Milestones

1. **Foundation** (this repository).
2. Shopify development-store connection, product and order sync, webhooks, health monitoring.
3. Financial screens, product research, supplier comparison, launch manager.
4. AI orchestration, background jobs, action queue and approvals screens, policy enforcement at execution.
5. Marketing workflows, campaign analytics, retention, experiments, executive reporting.
6. Multi-brand isolation at scale, monitoring, production hardening.
