// @license MIT
// Shared MCP tool-result shape used by generated and custom tools.

export type ToolResult = {
  content: { type: "text"; text: string }[];
  /** Canonical, schema-true data (machine channel). Presentation lives in text. */
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function jsonResult(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

/**
 * Two-channel result: canonical data in `structuredContent` (close to the
 * validated schema), the human/enriched rendering as text `content` (what the
 * model reads). Separates contract from presentation.
 */
export function dualResult(structured: unknown, text: string): ToolResult {
  // Torn responses and service results are objects; the MCP structuredContent
  // channel requires an object. Non-objects (rare) fall back to a wrapper.
  const obj =
    structured && typeof structured === "object" && !Array.isArray(structured)
      ? (structured as Record<string, unknown>)
      : { data: structured };
  return { content: [{ type: "text", text }], structuredContent: obj };
}
