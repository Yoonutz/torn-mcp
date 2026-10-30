// @license MIT
// Registers the real tool set on a real McpServer and reads it back through a
// real MCP client, so what is asserted is the serialized tool list a client
// receives — not the source strings.
import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools, describeTag, MAX_DESCRIPTION_CHARS } from "./tools.js";
import { textResult } from "./mcpResult.js";
import { ENDPOINTS, TAGS } from "./generated/endpoints.js";

type Tool = { name: string; title?: string; description?: string; inputSchema: any; annotations?: any };

let tools: Tool[] = [];

beforeAll(async () => {
  const server = new McpServer({ name: "test", version: "0" });
  registerAllTools(server, {
    callTorn: async () => textResult("{}"),
    makeCall: () => async () => ({}),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-client", version: "0" });
  await client.connect(clientSide);
  tools = (await client.listTools()).tools as Tool[];
});

describe("registered tool set (as seen by a client)", () => {
  it("registers 9 grouped tools, 12 intelligence tools and the discovery tool", () => {
    const names = tools.map((t) => t.name).sort();
    for (const tag of TAGS) expect(names).toContain(`torn_${tag}`);
    expect(names).toContain("torn_list_endpoints");
    expect(names).toContain("analyze_player");
    expect(names).toContain("find_profitable_items");
    expect(tools).toHaveLength(22);
  });

  it("declares a title and read-only annotations on every tool", () => {
    for (const t of tools) {
      expect(t.title, `${t.name} has no title`).toBeTruthy();
      expect(t.annotations, `${t.name} has no annotations`).toMatchObject({
        title: t.title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
      // Only the catalog tool stays inside the server; the rest call the Torn API.
      expect(t.annotations.openWorldHint).toBe(t.name !== "torn_list_endpoints");
    }
  });

  it("never names another tool in a description (directory policy)", () => {
    const names = tools.map((t) => t.name);
    for (const t of tools) {
      for (const other of names) {
        if (other === t.name) continue;
        expect(t.description ?? "", `${t.name} mentions ${other}`).not.toContain(other);
      }
    }
  });

  it("keeps every serialized description within the client budget", () => {
    for (const t of tools) {
      expect(
        (t.description ?? "").length,
        `${t.name} description is ${(t.description ?? "").length} chars`,
      ).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    }
  });

  it("exposes the property endpoint on torn_property", () => {
    const prop = tools.find((t) => t.name === "torn_property")!;
    expect(prop.inputSchema.properties.endpoint.enum).toContain("property");
    expect(prop.description).toMatch(/property \(requires id\)/);
  });

  it("still names every endpoint of a tag in its description", () => {
    for (const tag of TAGS) {
      const desc = tools.find((t) => t.name === `torn_${tag}`)!.description ?? "";
      for (const name of Object.keys(ENDPOINTS[tag])) {
        expect(desc, `${tag}/${name} missing from torn_${tag} description`).toMatch(
          new RegExp(`^- ${name}\\b`, "m"),
        );
      }
    }
  });

  it("marks required params and points to discovery for long enums", () => {
    const torn = tools.find((t) => t.name === "torn_torn")!.description ?? "";
    expect(torn).toMatch(/hof: .*requires cat=level\|busts\|rank\|/);
    expect(torn).toMatch(/\+\d+ more/); // hof has 14 values; the tail is elided
    expect(torn).toMatch(/\(\+N more\) = further accepted values/);
  });
});

describe("describeTag", () => {
  it("flags endpoints whose id variant means something else, with a legend", () => {
    const desc = describeTag("faction");
    expect(desc).toMatch(/^- basic: Faction's basic details \[\+id\]/m);
    expect(desc).toMatch(/^- crimes: /m);
    expect(desc).not.toMatch(/^- crimes: [^\n]*\[\+id\]/m); // no id variant at all
    expect(desc).toMatch(/\[\+id\] = pass 'id' to target a specific faction entity/);
  });

  it("names common enums once in the legend instead of on every line", () => {
    const desc = describeTag("faction");
    expect(desc).toMatch(/^- chains: [^\n]*· filter sort(?!=)/m);
    expect(desc).not.toMatch(/^- [^\n]*sort=DESC\|ASC/m);
    expect(desc).toMatch(/query options \([^)]*sort=DESC\|ASC/);
    expect(desc).toMatch(/^- attacks: [^\n]*\[limited\]$/m);
    expect(desc).toMatch(/\[minimal\]\/\[limited\]\/\[full\] = API key access level/);
  });
});
