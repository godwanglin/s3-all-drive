export function serializeBigInt(value: unknown) {
  if (typeof value === "bigint") return Number(value);
  return value;
}

export function serializeRecord<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, serializeBigInt(value)]));
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
