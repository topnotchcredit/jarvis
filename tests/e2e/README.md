# End-to-end tests

`app.spec.ts` drives a real browser through the built app. It refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` is a local address, and it creates accounts and deletes rate-limit rows, so never point it at a real project.

With Docker: `supabase start`, apply the migrations, put the local URL and keys in `.env.local`, `npm run build && npm start -- -p 3100`, then `npm run test:e2e`. The tests read captured email from `/__mail` on the gateway in `local-stack/`; with the Supabase CLI's own mail catcher that helper needs adapting.

Without Docker (how they were run for Milestone 1): place the `auth` (Supabase Auth) and `postgrest` release binaries in a folder, start Postgres 16 on port 54329, then

```
STACK_DIR=/path/to/binaries tests/e2e/local-stack/start.sh
STACK_DIR=/path/to/binaries tests/e2e/local-stack/serve-app.sh
npm run test:e2e
```
