/**
 * Structured JSON logging with redaction. Every log call passes through `redact`,
 * so credentials and customer details are removed even if a caller logs a whole object.
 */
const SENSITIVE_KEY =
  /(pass(word)?|secret|token|authorization|cookie|api[-_]?key|hmac|signature|ciphertext|email|phone|address|first[-_]?name|last[-_]?name|card|iban)/i;

const SENSITIVE_VALUE: RegExp[] = [
  /shp(at|ca|pa|ss|ua)_[A-Za-z0-9]+/g, // Shopify tokens
  /sk-ant-[A-Za-z0-9_-]+/g, // Anthropic keys
  /sb_(secret|publishable)_[A-Za-z0-9_-]+/g, // Supabase keys
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWTs
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // email addresses
];

const REDACTED = "[redacted]";

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") {
    return SENSITIVE_VALUE.reduce((text, pattern) => text.replace(pattern, REDACTED), value);
  }
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message, depth + 1) };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        SENSITIVE_KEY.test(key) && inner !== null && inner !== undefined ? REDACTED : redact(inner, depth + 1),
      ]),
    );
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, event: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...(redact(fields ?? {}) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
