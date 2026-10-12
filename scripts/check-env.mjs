// Fails if any browser-exposed variable (NEXT_PUBLIC_*) looks like a secret, in the
// environment or in any .env file. Run in CI and before every deploy.
import { existsSync, readdirSync, readFileSync } from "node:fs";

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PRIVATE|SERVICE_ROLE|ENCRYPTION|API_KEY)/i;
const names = new Set(Object.keys(process.env));
for (const file of readdirSync(".").filter((f) => f.startsWith(".env"))) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) names.add(match[1]);
  }
}
const exposed = [...names].filter((name) => name.startsWith("NEXT_PUBLIC_") && SECRET_NAME.test(name));
if (exposed.length > 0) {
  console.error(`These variables would be shipped to the browser but look like secrets: ${exposed.join(", ")}`);
  process.exit(1);
}
console.log("check:env ok - no secret-looking NEXT_PUBLIC_ variables");
