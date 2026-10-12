# Security

## Model

- **Identity.** Supabase Auth. The session cookie is HTTP-only and refreshed by `src/proxy.ts`. Every page and server action re-verifies the token through `src/lib/auth/session.ts`; the proxy's redirect is a convenience, not the boundary.
- **Authorization.** Enforced in Postgres with Row Level Security on every table, by organization membership and role. Server code using the secret key bypasses RLS and must authorize first and filter by organization explicitly (`src/lib/supabase/admin.ts`).
- **Secrets.** Server-side environment variables only. Integration credentials will be stored encrypted (AES-256-GCM, bound to the organization) in a table no client can reach.
- **Automation.** Agents will act only through the policy engine (`src/lib/policy/engine.ts`): an allowlist of action types, three risk tiers, spending and frequency limits, margin floors, expiring human approvals bound to the exact payload, dry-run by default, and a kill switch. Agents cannot request changes to permissions, budgets, policies, approvals or credentials. Who may approve is enforced by a database trigger.
- **Untrusted content.** Web pages, emails, supplier documents and product descriptions are data. Model output is validated against a strict schema before anything uses it.
- **Forgery.** Server Actions are same-origin only; cookies are SameSite=Lax; `form-action 'self'`.

## Checklist before going live

- [ ] Separate Supabase projects for development, staging and production.
- [ ] Supabase Pro or higher on production (free projects pause and have no backups).
- [ ] Production keys exist only in the host's environment settings.
- [ ] `npm run check:env` and `npm audit --omit=dev` pass in CI.
- [ ] Secret scanning enabled on the repository (GitHub secret scanning or gitleaks).
- [ ] Custom SMTP configured; email confirmation left on.
- [ ] Site URL and redirect allow-list contain only your domains.
- [ ] `SITE_URL` and `APP_ENV=production` set.
- [ ] MFA on the Supabase, hosting, GitHub and Shopify accounts.
- [ ] A restore from backup has been rehearsed once.

## Backup and restore

Supabase Pro takes daily backups and keeps them 7 days; point-in-time recovery is a paid add-on. To restore: Supabase dashboard → Database → Backups → choose a backup → Restore. This replaces the whole database, so stop autonomous actions first and expect to lose changes made after the backup. For an independent copy, run `supabase db dump` on a schedule and store the file off-platform. This procedure is written from Supabase's documentation and has not been rehearsed for this project.

## If something goes wrong

1. **Stop automation.** Settings → Stop all autonomous actions. The dashboard keeps working.
2. **Contain.** If a credential may be exposed: rotate it at the provider (Supabase keys, Shopify app secret, Anthropic key), update the host's environment, redeploy. If an account is compromised: remove the member and sign out their sessions in Supabase Auth.
3. **Understand.** Activity and audit logs show who changed what; entries cannot be edited or deleted. Check Supabase and host logs for the same period.
4. **Recover.** Correct data, or restore from backup if needed.
5. **Resume.** Allow autonomous actions again only once the cause is fixed.
6. **Record.** Write down what happened, the impact, and what changed to prevent a repeat. If customer data was involved, check your legal notification duties.
