// @license MIT
// MCP tool annotations shared by every registered tool.
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * Annotations for a read-only tool. Every tool here only GETs from the Torn API
 * (or reads the bundled catalog), so none can change game or account state.
 * `openWorld` is false only for tools that never leave the server.
 */
export function readOnly(title: string, openWorld = true): ToolAnnotations {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: openWorld,
  };
}
