import { z } from "zod";

export type GuardedOutput<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_json" | "schema_violation"; issues: string[] };

/**
 * Gate between a model response and anything that acts on it. Output that is not valid
 * JSON, or does not match the declared schema exactly, is rejected and never repaired.
 * Callers record a rejected run as status `rejected_schema`.
 */
export function guardAgentOutput<T>(schema: z.ZodType<T>, raw: string): GuardedOutput<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not_json", issues: ["Response was not valid JSON"] };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: "schema_violation",
      issues: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    };
  }
  return { ok: true, data: result.data };
}
