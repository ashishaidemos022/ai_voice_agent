// lib/mcp-normalizer.ts

/**
 * Types for MCP-style tool schemas.
 * We support both `inputSchema` and `input_schema`.
 */

export type JSONSchema = {
  type?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  enum?: any[];
  required?: string[];
  [key: string]: any;
};

export type MCPToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: JSONSchema;
  input_schema?: JSONSchema;
};

export type NormalizationLog = {
  targetKey: string;
  fromKey?: string;
  reason: string;
};

type InternalNormalizationResult = {
  normalized: Record<string, any>;
  logs: NormalizationLog[];
  missingRequired: string[];
};

const EMPTY_SCHEMA: JSONSchema = { type: "object", properties: {} };

export class MissingRequiredFieldsError extends Error {
  missingFields: string[];

  constructor(toolName: string, missingFields: string[]) {
    super(`[${toolName}] Missing required field(s): ${missingFields.join(", ")}`);
    this.name = "MissingRequiredFieldsError";
    this.missingFields = missingFields;
  }
}

export function resolveSchemaDefinition(schema: any): JSONSchema {
  if (schema === undefined || schema === null) {
    return { ...EMPTY_SCHEMA };
  }

  let resolved = schema;
  if (typeof resolved === "string") {
    try {
      resolved = JSON.parse(resolved);
    } catch {
      return { ...EMPTY_SCHEMA };
    }
  }

  if (typeof resolved !== "object") {
    return { ...EMPTY_SCHEMA };
  }

  if (resolved.inputSchema || resolved.input_schema) {
    return resolveSchemaDefinition(resolved.inputSchema || resolved.input_schema);
  }

  if (resolved.parameters) {
    return resolveSchemaDefinition(resolved.parameters);
  }

  if (resolved.schema) {
    return resolveSchemaDefinition(resolved.schema);
  }

  if (!resolved.type && resolved.properties) {
    return { type: "object", ...resolved };
  }

  if (resolved.type === "object" && !resolved.properties) {
    return { ...resolved, properties: resolved.properties ?? {} };
  }

  return resolved as JSONSchema;
}

/**
 * Utility: normalize a field name for comparison.
 * Lowercase, remove non-alphanumerics.
 */
function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Utility: split camelCase / snake_case / kebab-case into tokens.
 */
function tokenize(name: string): string[] {
  const cleaned = name.replace(/[-_.]/g, " ");
  return cleaned
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Very light fuzzy similarity: Jaccard over token sets.
 */
function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (!tokensA.size || !tokensB.size) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return intersection / union;
}

/**
 * Global semantic synonym hints.
 * We don't bind to a specific tool – we bind to concepts.
 */
const globalConceptSynonyms: Record<string, string[]> = {
  recipient_email: ["to", "email", "recipient", "recipient_email", "mail_to", "send_to", "address"],
  cc: ["cc", "carbon_copy", "copy"],
  bcc: ["bcc", "blind_copy"],
  subject: ["subject", "title", "topic", "headline"],
  body: ["body", "message", "msg", "content", "text"],
  query: ["q", "query", "search", "keyword", "term"],
  url: ["url", "link", "href", "address", "endpoint"],
  amount: ["amount", "value", "total", "price"],
  date: ["date", "when", "day"],
  phone: ["phone", "phone_number", "mobile", "cell"],
};

/**
 * Given a schema key, infer which global concept bucket it might belong to.
 * Very heuristic, but good enough for auto-mapping.
 */
function guessConceptForSchemaKey(schemaKey: string): string | undefined {
  const key = schemaKey.toLowerCase();
  if (key.includes("bcc")) return "bcc";
  if (key.includes("cc")) return "cc";
  if (key.includes("email")) return "recipient_email";
  if (key === "to" || key.includes("recipient")) return "recipient_email";
  if (key.includes("subject") || key.includes("title")) return "subject";
  if (key.includes("body") || key.includes("message") || key.includes("content")) return "body";
  if (key.includes("query") || key.includes("search")) return "query";
  if (key.includes("url") || key.includes("link")) return "url";
  if (key.includes("amount") || key.includes("total") || key.includes("price")) return "amount";
  if (key.includes("date") || key.includes("day")) return "date";
  if (key.includes("phone") || key.includes("mobile")) return "phone";
  return undefined;
}

/**
 * Detect whether a schema key corresponds to an email recipient-style field.
 */
function isRecipientField(schemaKey: string): boolean {
  const normalized = normalizeFieldName(schemaKey);
  return ["recipient", "recipientemail", "email", "to", "bcc", "cc"].some(token => normalized.includes(token));
}

/**
 * Sanitizes undefined/null/empty string values.
 */
function isEmptyValue(value: any): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmptyValue);
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * Coerce values based on JSON Schema type.
 * Light-touch: don't be too strict, just helpful.
 */
function coerceValue(value: any, schema?: JSONSchema): any {
  if (!schema || value === null || value === undefined) return value;

  const type = schema.type;

  if (!type) return value;

  try {
    switch (type) {
      case "string":
        if (typeof value === "string") return value;
        return String(value);

      case "number":
      case "integer": {
        if (typeof value === "number") return value;
        const n = Number(value);
        return Number.isNaN(n) ? value : n;
      }

      case "boolean": {
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
          const v = value.toLowerCase();
          if (["true", "yes", "1"].includes(v)) return true;
          if (["false", "no", "0"].includes(v)) return false;
        }
        return value;
      }

      case "array": {
        if (Array.isArray(value)) return value;
        if (typeof value === "string") {
          return value
            .split(/[,;]/)
            .map(s => s.trim())
            .filter(Boolean);
        }
        return [value];
      }

      case "object": {
        if (typeof value === "object" && !Array.isArray(value)) return value;
        if (typeof value === "string") {
          try {
            const parsed = JSON.parse(value);
            if (typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
          } catch {
            /* ignore */
          }
        }
        return value;
      }

      default:
        return value;
    }
  } catch {
    return value;
  }
}

/**
 * Ensure arguments are expressible as an object.
 */
function coerceArgsObject(rawArgs: any, schema?: JSONSchema): Record<string, any> {
  if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    return { ...rawArgs };
  }

  if (rawArgs === undefined || rawArgs === null || rawArgs === "") {
    return {};
  }

  const properties = schema?.properties ? Object.keys(schema.properties) : [];
  if (properties.length === 0) {
    return { value: rawArgs };
  }

  const defaultKey =
    properties.length === 1
      ? properties[0]
      : properties.find(key => /text|body|message|query|input/i.test(key)) || properties[0];

  return { [defaultKey]: rawArgs };
}

type ArgCandidate = {
  normalizedKey: string;
  rawKey: string;
  value: any;
};

function buildCandidateMap(args: Record<string, any>): Map<string, ArgCandidate[]> {
  const map = new Map<string, ArgCandidate[]>();

  const visit = (path: string, value: any) => {
    const normalizedKey = normalizeFieldName(path);
    const candidate: ArgCandidate = { normalizedKey, rawKey: path, value };
    const existing = map.get(normalizedKey);
    if (existing) {
      existing.push(candidate);
    } else {
      map.set(normalizedKey, [candidate]);
    }

    const segments = path.split(/[.\s]/);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && lastSegment !== path) {
      const lastKey = normalizeFieldName(lastSegment);
      const lastCandidate: ArgCandidate = { normalizedKey: lastKey, rawKey: path, value };
      const bucket = map.get(lastKey);
      if (bucket) {
        bucket.push(lastCandidate);
      } else {
        map.set(lastKey, [lastCandidate]);
      }
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        const childPath = path ? `${path}.${childKey}` : childKey;
        visit(childPath, childValue);
      }
    }
  };

  for (const [key, value] of Object.entries(args)) {
    visit(key, value);
  }

  return map;
}

function normalizeRecipientValue(value: any, schema?: JSONSchema): any {
  const toArray = (): string[] => {
    if (Array.isArray(value)) {
      return value.map(v => String(v || "").trim().toLowerCase()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(/[,;]/)
        .map(v => v.trim().toLowerCase())
        .filter(Boolean);
    }
    return [String(value || "").trim().toLowerCase()].filter(Boolean);
  };

  const entries = toArray();
  if ((schema?.type === "array" || schema?.items) && !!entries.length) {
    return entries;
  }

  return entries.join(", ");
}

function alignValueWithSchema(value: any, schemaKey: string, schema?: JSONSchema): any {
  let coerced = coerceValue(value, schema);

  if (isRecipientField(schemaKey)) {
    coerced = normalizeRecipientValue(coerced, schema);
  } else if (schema?.type === "array" && !Array.isArray(coerced)) {
    coerced = coerceValue([coerced], schema);
  } else if (schema?.type === "string" && Array.isArray(coerced)) {
    coerced = coerced.join(", ");
  }

  if (schema?.enum && !schema.enum.includes(coerced)) {
    const match = schema.enum.find(option => normalizeFieldName(String(option)) === normalizeFieldName(String(coerced)));
    if (match !== undefined) {
      coerced = match;
    }
  }

  return coerced;
}

function sanitizeOptionalFields(
  normalized: Record<string, any>,
  required: string[]
): { sanitized: Record<string, any>; missingRequired: string[] } {
  const sanitized: Record<string, any> = {};
  const missing: string[] = [];

  for (const [key, value] of Object.entries(normalized)) {
    if (isEmptyValue(value)) {
      if (required.includes(key)) {
        missing.push(key);
      }
      continue;
    }
    sanitized[key] = value;
  }

  for (const req of required) {
    if (!(req in sanitized)) {
      missing.push(req);
    }
  }

  return { sanitized, missingRequired: Array.from(new Set(missing)) };
}

function performNormalization(schema: JSONSchema | undefined, rawArgs: any): InternalNormalizationResult {
  const logs: NormalizationLog[] = [];
  const resolvedSchema = resolveSchemaDefinition(schema || EMPTY_SCHEMA);

  const preparedArgs = coerceArgsObject(rawArgs, resolvedSchema);
  const propertyEntries =
    resolvedSchema.properties && typeof resolvedSchema.properties === "object"
      ? Object.entries(resolvedSchema.properties)
      : [];
  const schemaKeySet = new Set(propertyEntries.map(([key]) => key));

  if (!propertyEntries.length) {
    const cleaned = Object.fromEntries(
      Object.entries(preparedArgs).filter(([, value]) => !isEmptyValue(value))
    );
    return {
      normalized: cleaned,
      logs: [{ targetKey: "*", reason: "No schema provided; cleaned raw arguments" }],
      missingRequired: [],
    };
  }

  const required = resolvedSchema.required ?? [];
  const candidateMap = buildCandidateMap(preparedArgs);

  const normalized: Record<string, any> = {};

  const searchCandidate = (normalizedKey: string): ArgCandidate | undefined => {
    const bucket = candidateMap.get(normalizedKey);
    return bucket ? bucket[0] : undefined;
  };

  const allCandidates = Array.from(candidateMap.values()).flat();

  for (const [schemaKey, propSchema] of propertyEntries) {
    const targetNorm = normalizeFieldName(schemaKey);
    const concept = guessConceptForSchemaKey(schemaKey);

    const direct = searchCandidate(targetNorm);
    if (direct) {
      normalized[schemaKey] = alignValueWithSchema(direct.value, schemaKey, propSchema);
      logs.push({
        targetKey: schemaKey,
        fromKey: direct.rawKey,
        reason: "Direct key match (normalized)",
      });
      continue;
    }

    if (concept && globalConceptSynonyms[concept]) {
      let found: ArgCandidate | undefined;
      for (const synonym of globalConceptSynonyms[concept]) {
        const candidate = searchCandidate(normalizeFieldName(synonym));
        if (candidate) {
          found = candidate;
          break;
        }
      }
      if (found) {
        normalized[schemaKey] = alignValueWithSchema(found.value, schemaKey, propSchema);
        logs.push({
          targetKey: schemaKey,
          fromKey: found.rawKey,
          reason: `Concept-based synonym match (${concept})`,
        });
        continue;
      }
    }

    let best: { candidate: ArgCandidate; score: number } | undefined;
    for (const candidate of allCandidates) {
      const score = tokenSimilarity(schemaKey, candidate.normalizedKey);
      if (score >= 0.6 && (!best || score > best.score)) {
        best = { candidate, score };
      }
    }

    if (best) {
      normalized[schemaKey] = alignValueWithSchema(best.candidate.value, schemaKey, propSchema);
      logs.push({
        targetKey: schemaKey,
        fromKey: best.candidate.rawKey,
        reason: `Fuzzy token similarity match (score=${best.score.toFixed(2)})`,
      });
      continue;
    }

    logs.push({
      targetKey: schemaKey,
      reason: "No matching argument found",
    });
  }

  const { sanitized, missingRequired } = sanitizeOptionalFields(normalized, required);
  const passthrough: Record<string, any> = {};

  if (preparedArgs && typeof preparedArgs === "object") {
    for (const [key, value] of Object.entries(preparedArgs)) {
      if (!schemaKeySet.has(key) && !isEmptyValue(value)) {
        passthrough[key] = value;
      }
    }
  }

  const merged = { ...passthrough, ...sanitized };

  return { normalized: merged, logs, missingRequired };
}

function resolveInputs(
  arg1: string | MCPToolDefinition,
  arg2?: JSONSchema | Record<string, any> | null,
  arg3?: Record<string, any> | null
): { toolName: string; schema?: JSONSchema; rawArgs: any } {
  if (typeof arg1 === "string") {
    return {
      toolName: arg1,
      schema: (arg2 as JSONSchema) || undefined,
      rawArgs: arg3,
    };
  }

  return {
    toolName: arg1.name,
    schema: arg1.inputSchema || arg1.input_schema,
    rawArgs: arg2,
  };
}

/**
 * Normalize arguments based on tool schema and enforce validation.
 */
export function normalizeMCPArguments(
  tool: MCPToolDefinition,
  rawArgs: Record<string, any> | null | undefined
): InternalNormalizationResult["normalized"];
export function normalizeMCPArguments(
  toolName: string,
  inputSchema: JSONSchema | undefined,
  rawArgs: Record<string, any> | null | undefined
): InternalNormalizationResult["normalized"];
export function normalizeMCPArguments(
  arg1: string | MCPToolDefinition,
  arg2?: JSONSchema | Record<string, any> | null,
  arg3?: Record<string, any> | null
): InternalNormalizationResult["normalized"] {
  const { toolName, schema, rawArgs } = resolveInputs(arg1, arg2, arg3);
  console.log('[MCPNormalizer] Incoming args', {
    toolName,
    schemaKeys: schema?.properties ? Object.keys(schema.properties) : [],
    rawArgs
  });
  const result = performNormalization(schema, rawArgs);

  if (result.missingRequired.length > 0) {
    throw new MissingRequiredFieldsError(toolName, result.missingRequired);
  }

  console.log('[MCPNormalizer] Normalized args result', {
    toolName,
    normalized: result.normalized,
    missingRequired: result.missingRequired
  });

  return result.normalized;
}
