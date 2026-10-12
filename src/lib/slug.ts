/** URL-safe identifier matching the database check: lowercase letters, digits and hyphens. */
export function slugify(value: string): string {
  const slug = value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63).replace(/-+$/, "");
  return slug || "brand";
}
