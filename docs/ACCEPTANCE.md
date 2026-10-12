# Acceptance criteria status

Recorded 2026-10-12. "Verified" means an automated test exercising the behaviour was run and passed in this state of the repository. Where a criterion is only partly met, the part that is and is not covered is stated.

Test locations: database tests `tests/db/schema.test.ts` (real Postgres engine, in process), unit tests `src/lib/**/*.test.ts`, browser tests `tests/e2e/app.spec.ts` (Chromium against the built app, Postgres 16, Supabase Auth and PostgREST).

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Register, sign in, sign out, recover access | Verified locally | Browser tests: register and confirm by email, wrong password, sign out, password recovery. Not yet run against a hosted Supabase project. |
| 2 | No access to another organization's records | Verified | Database tests (tenant isolation, roles); browser test hitting the data API directly with another user's token. |
| 3 | A brand can be created and configured | Partly | Creation verified in the browser. Configuration (margin floor, budgets) has no screen. |
| 4 | Connect a development Shopify store | Not built | Milestone 2. |
| 5 | Products and orders synchronize | Not built | Milestone 2. Uniqueness constraints that make sync repeatable are verified. |
| 6 | Duplicate webhooks do not duplicate records | Partly | Storage-level de-duplication verified. No webhook endpoint yet. |
| 7 | Invalid webhook signatures rejected | Partly | Signature verification unit-tested against an independently computed vector. No endpoint yet. |
| 8 | API failures recover safely | Not built | Milestone 2. |
| 9 | Missing product cost flagged, not zero | Verified (logic and storage) | Finance unit test; database constraint test. No screen yet. |
| 10 | Revenue and margin match verified examples | Verified (logic) | Finance unit test against the worked example in `docs/METRICS.md`. |
| 11 | Historical costs unchanged when current cost changes | Verified (storage) | Database test. |
| 12 | Schema-violating AI output rejected | Verified (guard) | Unit test. No agent calls it yet. |
| 13 | Unauthorized action cannot execute | Partly | Policy engine unit tests. No executor exists, so nothing can execute at all. |
| 14 | Action above a spending limit blocked | Partly | Policy engine unit tests: not executed, routed to approval. |
| 15 | Restricted action requires authorized approval | Partly | Policy engine unit tests; database approval rules verified. No approvals screen. |
| 16 | Expired approvals cannot be used | Partly | Policy engine unit tests; database test rejecting approval of an expired action. |
| 17 | Repeated jobs do not duplicate side effects | Partly | Idempotency-key uniqueness verified in the database. No job system yet. |
| 18 | Kill switch prevents new autonomous mutations | Partly | Switch, audit entry and policy rule verified. No agents yet. |
| 19 | Failed integrations generate visible alerts | Not built | Milestone 2. Overview already counts integrations with problems. |
| 20 | A brand cannot affect another brand's store | Verified (database) | Composite foreign key tests. |
| 21 | Communication respects suppression and consent | Not built | Milestone 5. |
| 22 | Audit record for every consequential action | Partly | Verified for organization, member, brand, store, integration, credential, budget, workflow, action and approval changes. External actions do not exist yet. |
| 23 | Real data when connected, honest empty states when not | Verified for what exists | Browser tests assert the empty states; no sample figures in the code. |
| 24 | Builds; passes lint, type checks and tests | Verified | `npm run verify` and `npm run test:e2e`; results in the delivery message for this milestone. |
