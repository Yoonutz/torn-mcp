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

type Tool = { name: string; description?: string; inputSchema: any };

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
    expect(torn).toMatch(/torn_list_endpoints/);
  });
});

describe("describeTag", () => {
  it("flags endpoints whose id variant means something else, with a legend", () => {
    const desc = describeTag("faction");
    expect(desc).toMatch(/^- basic: Get your faction's basic details \[\+id\]/m);
    expect(desc).toMatch(/^- crimes: /m);
    expect(desc).not.toMatch(/^- crimes: [^\n]*\[\+id\]/m); // no id variant at all
    expect(desc).toMatch(/\[\+id\] = pass 'id' to target a specific faction entity/);
  });
});
