import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(SUPABASE)) throw new Error("E2E tests only run against a local Supabase stack");

const run = Date.now().toString(36);
const alice = { email: `alice-${run}@jarvis.test`, password: "correct horse battery staple", newPassword: "another long passphrase 42" };
const bob = { email: `bob-${run}@jarvis.test`, password: "bob has a long password too" };
const BRAND = `Northwind Wellness ${run}`;

async function latestLinkFor(page: Page, email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const mail: { to: string; body: string }[] = await (await page.request.get(`${SUPABASE}/__mail`)).json();
    const message = mail.filter((m) => m.to === email).at(-1);
    const href = message?.body.match(/href="([^"]+)"/)?.[1];
    if (href) return href.replaceAll("&amp;", "&");
    await page.waitForTimeout(250);
  }
  throw new Error(`no email for ${email}`);
}

async function signUp(page: Page, user: { email: string; password: string }) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email for a confirmation link.")).toBeVisible();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Sign in and wait until the session is established. */
async function signInOk(page: Page, email: string, password: string) {
  await signIn(page, email, password);
  await expect(page.getByRole("heading", { name: "Executive overview" })).toBeVisible();
}

async function accessToken(page: Page, email: string, password: string): Promise<string> {
  const response = await page.request.post(`${SUPABASE}/auth/v1/token?grant_type=password`, { headers: { apikey: ANON }, data: { email, password } });
  expect(response.ok()).toBe(true);
  return (await response.json()).access_token;
}

test.describe.configure({ mode: "serial" });

const SERVICE = env.SUPABASE_SECRET_KEY;
async function clearRateLimits(request: import("@playwright/test").APIRequestContext) {
  const response = await request.delete(`${SUPABASE}/rest/v1/rate_limits?bucket=like.*`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  expect(response.ok()).toBe(true);
}
test.beforeAll(async ({ request }) => clearRateLimits(request));
test.afterAll(async ({ request }) => clearRateLimits(request));

test("signed-out visitors are sent to sign-in and cannot open any page", async ({ page }) => {
  for (const path of ["/", "/brands", "/settings", "/activity", "/finance", "/onboarding"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login/);
  }
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("every response carries the security headers", async ({ request }) => {
  const headers = (await request.get("/login")).headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("the health check reports status without exposing configuration values", async ({ request }) => {
  const body = await (await request.get("/api/health")).text();
  expect(JSON.parse(body)).toMatchObject({ status: "ok", supabaseConfigured: true });
  expect(body).not.toContain(ANON);
  expect(body).not.toContain(env.SUPABASE_SECRET_KEY);
});

test("sign-up rejects a short password", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`short-${run}@jarvis.test`);
  await page.getByLabel("Password").evaluate((el: HTMLInputElement) => el.removeAttribute("minlength"));
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
});

test("register, confirm by email, create an organization (criterion 1)", async ({ page }) => {
  await signUp(page, alice);

  // Not confirmed yet: sign-in is refused.
  await signIn(page, alice.email, alice.password);
  await expect(page.getByText("Confirm your email first.")).toBeVisible();

  await page.goto(await latestLinkFor(page, alice.email));
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Organization name").fill(`Acme Holdings ${run}`);
  await page.getByRole("button", { name: "Create organization" }).click();

  await expect(page).toHaveURL(/127\.0\.0\.1:3100\/$/);
  await expect(page.getByRole("heading", { name: "Executive overview" })).toBeVisible();
  await expect(page.getByText(`Acme Holdings ${run}`)).toBeVisible();
  await expect(page.getByText(`${alice.email} (owner)`)).toBeVisible();
  await expect(page.getByText("No sales data yet")).toBeVisible();
});

test("a wrong password is refused with a message that does not reveal whether the account exists", async ({ page }) => {
  await signIn(page, alice.email, "not the password at all");
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await signIn(page, `nobody-${run}@jarvis.test`, "not the password at all");
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a post-login redirect cannot leave the site", async ({ page }) => {
  await page.goto("/login?next=//evil.example/steal");
  await page.getByLabel("Email").fill(alice.email);
  await page.getByLabel("Password").fill(alice.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:3100\/$/);
});

test("create a brand, see it listed and audited; duplicates are refused (criterion 3)", async ({ page }) => {
  await signInOk(page, alice.email, alice.password);
  await page.goto("/brands");
  await expect(page.getByText("No brands yet")).toBeVisible();
  await page.getByLabel("Brand name").fill(BRAND);
  await page.getByLabel("Currency").fill("usd");
  await page.getByRole("button", { name: "Create brand" }).click();
  await expect(page.getByText(`Created ${BRAND}.`)).toBeVisible();
  await expect(page.getByRole("cell", { name: BRAND })).toBeVisible();
  await expect(page.getByText("No store connected")).toBeVisible();

  await page.getByLabel("Brand name").fill(BRAND);
  await page.getByRole("button", { name: "Create brand" }).click();
  await expect(page.getByText("A brand with that name already exists.")).toBeVisible();

  await page.goto("/activity");
  const row = page.getByRole("row").filter({ hasText: "brands.insert" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(alice.email);
});

test("the kill switch turns autonomous actions off and on, and is audited (criterion 18, control part)", async ({ page }) => {
  await signInOk(page, alice.email, alice.password);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Stop all autonomous actions" }).click();
  await expect(page.getByText("Autonomous actions are off", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow autonomous actions" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByText(/Autonomous actions were switched off/)).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Allow autonomous actions" }).click();
  await expect(page.getByRole("button", { name: "Stop all autonomous actions" })).toBeVisible();
  await page.goto("/activity");
  await expect(page.getByRole("row").filter({ hasText: "organizations.update" })).toHaveCount(2);
});

test("areas that are not built say so and show no figures", async ({ page }) => {
  await signInOk(page, alice.email, alice.password);
  for (const [path, title] of [["/finance", "Financial performance"], ["/agents", "AI agents and runs"], ["/orders", "Orders and fulfillment"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("This area is not built yet")).toBeVisible();
  }
  await page.goto("/no-such-area");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("sign out ends the session", async ({ page }) => {
  await signInOk(page, alice.email, alice.password);
  await expect(page.getByRole("heading", { name: "Executive overview" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/brands");
  await expect(page).toHaveURL(/\/login/);
});

test("another organization sees none of the first one's data, in the app or through the API (criteria 2 and 20)", async ({ page }) => {
  await signUp(page, bob);
  await page.goto(await latestLinkFor(page, bob.email));
  await page.getByLabel("Organization name").fill(`Bob Org ${run}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByRole("heading", { name: "Executive overview" })).toBeVisible();

  await page.goto("/brands");
  await expect(page.getByText("No brands yet")).toBeVisible();
  await expect(page.getByText(BRAND)).toHaveCount(0);
  await page.goto("/activity");
  await expect(page.getByText(alice.email)).toHaveCount(0);
  await expect(page.getByText("brands.insert")).toHaveCount(0);

  // Straight at the data API with Bob's own token, bypassing the app entirely.
  const aliceToken = await accessToken(page, alice.email, alice.password);
  const bobToken = await accessToken(page, bob.email, bob.password);
  const api = (token: string, path: string, init: { method?: string; data?: unknown } = {}) =>
    page.request.fetch(`${SUPABASE}/rest/v1/${path}`, {
      method: init.method ?? "GET",
      headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
      data: init.data,
    });

  const aliceBrands = await (await api(aliceToken, "brands?select=id,organization_id,name")).json();
  expect(aliceBrands).toHaveLength(1);
  const { id: brandId, organization_id: orgA } = aliceBrands[0];

  for (const table of ["brands", "organizations", "organization_members", "audit_logs", "stores", "orders", "action_queue", "budget_policies"]) {
    const column = table === "organizations" ? "id" : "organization_id";
    const response = await api(bobToken, `${table}?${column}=eq.${orgA}&select=*`);
    expect(response.status(), table).toBe(200);
    expect(await response.json(), table).toEqual([]);
  }
  expect((await api(bobToken, "brands", { method: "POST", data: { organization_id: orgA, name: "Intruder", slug: "intruder" } })).status()).toBe(403);
  expect(await (await api(bobToken, `brands?id=eq.${brandId}`, { method: "PATCH", data: { name: "Renamed by Bob" } })).json()).toEqual([]);
  expect((await api(bobToken, "organization_members", { method: "POST", data: { organization_id: orgA, user_id: (JSON.parse(Buffer.from(bobToken.split(".")[1], "base64url").toString())).sub, role: "owner" } })).status()).toBe(403);
  for (const table of ["integration_secrets", "webhook_events", "rate_limits"]) {
    expect((await api(bobToken, `${table}?select=*`)).status(), table).toBe(403);
  }
  expect((await api(bobToken, "audit_logs", { method: "POST", data: { organization_id: orgA, actor_type: "user", action: "x", target_type: "x" } })).status()).toBe(403);
  expect((await api(bobToken, "rpc/check_rate_limit", { method: "POST", data: { p_bucket: "x", p_limit: 1, p_window_seconds: 1 } })).status()).toBe(403);

  // No session at all: only the public key.
  expect([401, 403]).toContain((await api(ANON, "brands?select=*")).status());

  // Alice's data is untouched.
  expect(await (await api(aliceToken, "brands?select=name")).json()).toEqual([{ name: BRAND }]);
});

test("recover access by email and sign in with the new password (criterion 1)", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(alice.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If that address has an account, a reset link is on its way.")).toBeVisible();

  await page.goto(await latestLinkFor(page, alice.email));
  await expect(page).toHaveURL(/\/update-password$/);
  await page.getByLabel("New password").fill(alice.newPassword);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Executive overview" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, alice.email, alice.password);
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await signIn(page, alice.email, alice.newPassword);
  await expect(page.getByRole("heading", { name: "Executive overview" })).toBeVisible();
});

test("a reset request for an unknown address gives the same answer", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(`ghost-${run}@jarvis.test`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If that address has an account, a reset link is on its way.")).toBeVisible();
});

test("repeated sign-in attempts from one address are cut off", async ({ page, request }) => {
  await clearRateLimits(request);
  for (let attempt = 1; attempt <= 10; attempt++) {
    await signIn(page, `nobody-${run}@jarvis.test`, "wrong password, attempt");
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  }
  await signIn(page, alice.email, alice.newPassword);
  await expect(page.getByText("Too many attempts. Wait a few minutes and try again.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
