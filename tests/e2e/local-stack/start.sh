#!/usr/bin/env bash
# Starts a local Supabase-equivalent stack (Postgres + Supabase Auth + PostgREST + gateway)
# for end-to-end tests, without Docker. Requires: a running Postgres reachable as superuser
# at $PGURL, and the `auth` and `postgrest` release binaries in $STACK_DIR.
# With Docker available, `supabase start` is the simpler equivalent.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
STACK_DIR="${STACK_DIR:?set STACK_DIR to the folder holding the auth and postgrest binaries}"
PGURL="${PGURL:-postgres://postgres@127.0.0.1:54329/postgres}"
APP_URL="${APP_URL:-http://127.0.0.1:3100}"

# The signing secret is generated once per stack directory and never committed.
[ -f "$STACK_DIR/jwt.secret" ] || node -e 'console.log(require("crypto").randomBytes(48).toString("base64url"))' > "$STACK_DIR/jwt.secret"
SECRET="$(cat "$STACK_DIR/jwt.secret")"
pkill -f "$STACK_DIR/auth serve" 2>/dev/null || true; pkill -f "$STACK_DIR/postgrest" 2>/dev/null || true; pkill -f "$HERE/gateway.mjs" 2>/dev/null || true
jwt() { node -e '
  const c=require("crypto"),b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
  const d=b({alg:"HS256",typ:"JWT"})+"."+b({role:process.argv[1],iss:"local",iat:Math.floor(Date.now()/1e3),exp:Math.floor(Date.now()/1e3)+86400*30});
  console.log(d+"."+c.createHmac("sha256",process.argv[2]).update(d).digest("base64url"))' "$1" "$SECRET"; }

FRESH="$(psql "$PGURL" -Atc "select not exists (select 1 from pg_roles where rolname = 'authenticator')")"
[ "$FRESH" = "t" ] && psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$HERE/bootstrap.sql"

export GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:local-only@127.0.0.1:54329/postgres" \
  GOTRUE_DB_MIGRATIONS_PATH="$STACK_DIR/migrations" GOTRUE_DB_NAMESPACE=auth \
  GOTRUE_SITE_URL="$APP_URL" GOTRUE_URI_ALLOW_LIST="$APP_URL/**" API_EXTERNAL_URL="http://127.0.0.1:54321/auth/v1" \
  GOTRUE_API_HOST=127.0.0.1 PORT=9999 GOTRUE_JWT_SECRET="$SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_DISABLE_SIGNUP=false \
  GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=false GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=2525 \
  GOTRUE_SMTP_ADMIN_EMAIL=noreply@jarvis.test GOTRUE_SMTP_MAX_FREQUENCY=1s GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 \
  GOTRUE_PASSWORD_MIN_LENGTH=12 GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify \
  GOTRUE_LOG_LEVEL=warn
node "$HERE/gateway.mjs" > "$STACK_DIR/gateway.log" 2>&1 &
"$STACK_DIR/auth" migrate > "$STACK_DIR/auth-migrate.log" 2>&1
"$STACK_DIR/auth" serve > "$STACK_DIR/auth.log" 2>&1 &

if [ "$FRESH" = "t" ]; then
  for f in "$REPO"/supabase/migrations/*.sql; do psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$f"; done
fi

PGRST_DB_URI="postgres://authenticator:local-only@127.0.0.1:54329/postgres" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="$SECRET" PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT=3001 "$STACK_DIR/postgrest" > "$STACK_DIR/postgrest.log" 2>&1 &

cat > "$STACK_DIR/app.env" <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(jwt anon)
SUPABASE_SECRET_KEY=$(jwt service_role)
SITE_URL=$APP_URL
APP_ENV=development
ENV
sleep 3
echo "stack up; app environment written to $STACK_DIR/app.env"
