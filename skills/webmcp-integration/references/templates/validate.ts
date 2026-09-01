/**
 * In-handler argument validation. The browser does NOT validate agent-supplied
 * arguments against your declared inputSchema before calling execute — the declared
 * schema is advertising; this is the actual check. Hand-rolled JSON-Schema subset
 * (type / properties / required / enum / min / max / minItems / items /
 * additionalProperties). Unknown keywords pass — a false rejection is worse than a miss.
 * MIT.
 */

export interface SchemaProblem { path: string; message: string }
type Schema = Record<string, unknown>;

export function validateArgs(schema: Schema | undefined, args: unknown): SchemaProblem[] {
  if (!schema) return [];
  return check(schema, args ?? {}, "");
}

function check(schema: Schema, value: unknown, path: string): SchemaProblem[] {
  const problems: SchemaProblem[] = [];
  const at = path || "(root)";
  const type = schema["type"];

  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return [{ path: at, message: "must be an object" }];
    const obj = value as Record<string, unknown>;
    const props = (schema["properties"] ?? {}) as Record<string, Schema>;
    for (const key of (schema["required"] as string[] | undefined) ?? [])
      if (obj[key] === undefined) problems.push({ path: `${path}${key}`, message: "is required" });
    if (schema["additionalProperties"] === false)
      for (const key of Object.keys(obj))
        if (!(key in props)) problems.push({ path: `${path}${key}`, message: "is not a declared parameter" });
    for (const [key, sub] of Object.entries(props))
      if (obj[key] !== undefined) problems.push(...check(sub, obj[key], `${path}${key}.`).map(tidy));
    return problems;
  }

  if (type === "array") {
    if (!Array.isArray(value)) return [{ path: at, message: "must be an array" }];
    const min = schema["minItems"] as number | undefined;
    if (min !== undefined && value.length < min)
      problems.push({ path: at, message: `needs at least ${min} item(s)` });
    const items = schema["items"] as Schema | undefined;
    if (items) value.forEach((v, i) => problems.push(...check(items, v, `${path}${i}.`).map(tidy)));
    return problems;
  }

  if (type === "string") {
    if (typeof value !== "string") return [{ path: at, message: "must be a string" }];
  } else if (type === "number" || type === "integer") {
    if (typeof value !== "number" || Number.isNaN(value)) return [{ path: at, message: "must be a number" }];
    if (type === "integer" && !Number.isInteger(value)) problems.push({ path: at, message: "must be an integer" });
    const min = schema["minimum"] as number | undefined;
    const xmin = schema["exclusiveMinimum"] as number | undefined;
    const max = schema["maximum"] as number | undefined;
    if (min !== undefined && value < min) problems.push({ path: at, message: `must be >= ${min}` });
    if (xmin !== undefined && value <= xmin) problems.push({ path: at, message: `must be > ${xmin}` });
    if (max !== undefined && value > max) problems.push({ path: at, message: `must be <= ${max}` });
  } else if (type === "boolean") {
    if (typeof value !== "boolean") return [{ path: at, message: "must be a boolean" }];
  }

  const allowed = schema["enum"] as unknown[] | undefined;
  if (allowed && !allowed.some((v) => v === value))
    problems.push({ path: at, message: `must be one of: ${allowed.map(String).join(", ")}` });

  return problems;
}

const tidy = (p: SchemaProblem): SchemaProblem => ({
  ...p, path: p.path.endsWith(".") ? p.path.slice(0, -1) : p.path,
});
