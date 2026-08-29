import { z } from "zod";

/**
 * WebMCP tool input schemas are AUTHORED as JSON Schema in the builder (SPEC-C
 * D2). The F4 registry + executeTool validate with zod, so we convert the
 * authored JSON Schema into a zod schema with a MINIMAL converter.
 *
 * Supported: top-level `type: "object"` with `properties` (string / number /
 * integer / boolean / array / object, `enum` on strings, `description`),
 * `required` array, one level of recursion for nested objects/array items.
 * NOT supported (validated as `unknown` — documented limitation): format,
 * pattern, min/max bounds, oneOf/anyOf/allOf, $ref, additionalProperties:false
 * (extra keys always pass through — loose objects by design).
 */

type JsonSchema = Record<string, unknown>;

/** Throwing validator used at tool-save and publish time. */
export function validateInputSchema(raw: string): JsonSchema {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("input schema is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("input schema must be a JSON object");
  }
  return parsed as JsonSchema;
}

/** Publish-time gate: the schema must describe an object (execute_action args are OBJECTS). */
export function assertObjectSchema(schema: JsonSchema, toolName: string): void {
  const t = schema.type ?? "object";
  if (t !== "object") {
    throw new Error(`tool '${toolName}': input schema must have type "object" (got "${String(t)}")`);
  }
}

function propToZod(prop: unknown, depth: number): z.ZodType {
  if (!prop || typeof prop !== "object" || depth > 2) return z.unknown();
  const p = prop as JsonSchema;
  const describe = <T extends z.ZodType>(s: T): z.ZodType =>
    typeof p.description === "string" && p.description ? s.describe(p.description) : s;

  if (Array.isArray(p.enum) && p.enum.every((v) => typeof v === "string") && p.enum.length > 0) {
    return describe(z.enum(p.enum as [string, ...string[]]));
  }
  switch (p.type) {
    case "string":
      return describe(z.string());
    case "number":
      return describe(z.number());
    case "integer":
      return describe(z.number().int());
    case "boolean":
      return describe(z.boolean());
    case "array":
      return describe(z.array(propToZod(p.items, depth + 1)));
    case "object":
      return describe(objectToZod(p, depth + 1));
    default:
      return z.unknown();
  }
}

function objectToZod(schema: JsonSchema, depth: number): z.ZodType {
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const shape: Record<string, z.ZodType> = {};
  for (const [key, prop] of Object.entries(props)) {
    const base = propToZod(prop, depth);
    shape[key] = required.has(key) ? base : base.optional();
  }
  // looseObject: extra keys pass through (additionalProperties is not enforced).
  return z.looseObject(shape);
}

/** JSON Schema (object) → zod. Non-object / malformed schemas degrade to a loose object. */
export function jsonSchemaToZod(schema: JsonSchema): z.ZodType {
  try {
    if ((schema.type ?? "object") !== "object") return z.looseObject({});
    return objectToZod(schema, 0);
  } catch {
    return z.looseObject({});
  }
}
