import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const root = path.resolve(__dirname, "../..");
const migrationsDir = path.join(root, "supabase/migrations");

/** Fresh in-process Postgres with the Supabase shim and every migration applied in order. */
export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(__dirname, "supabase-shim.sql"), "utf8"));
  for (const file of readdirSync(migrationsDir).sort()) {
    if (!file.endsWith(".sql")) continue;
    try {
      await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
    } catch (error) {
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

/** Run statements exactly as a signed-in browser client would: role `authenticated` + JWT subject. */
export function asUser<T>(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId })]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  }) as Promise<T>;
}

export function asAnon<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    return fn(tx);
  }) as Promise<T>;
}

/** Server-side code path: secret key, bypasses RLS but not constraints or triggers. */
export function asService<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return fn(tx);
  }) as Promise<T>;
}

export async function createUser(db: PGlite, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  return rows[0].id;
}

export async function createOrg(db: PGlite, ownerId: string, name: string): Promise<string> {
  return asUser(db, ownerId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>("select public.create_organization($1) as id", [name]);
    return rows[0].id;
  });
}

export async function addMember(db: PGlite, orgId: string, userId: string, role: string): Promise<void> {
  await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)", [
    orgId,
    userId,
    role,
  ]);
}

export async function createBrand(db: PGlite, orgId: string, name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const { rows } = await db.query<{ id: string }>(
    "insert into public.brands (organization_id, name, slug) values ($1, $2, $3) returning id",
    [orgId, name, slug],
  );
  return rows[0].id;
}

export async function createStore(db: PGlite, orgId: string, brandId: string, shop: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.stores (organization_id, brand_id, shop_domain) values ($1, $2, $3) returning id",
    [orgId, brandId, `${shop}.myshopify.com`],
  );
  return rows[0].id;
}
