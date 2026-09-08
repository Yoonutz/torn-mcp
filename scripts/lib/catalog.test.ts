// @license MIT
import { describe, it, expect } from "vitest";
import { buildCatalog } from "./catalog.mjs";

const KEY = { $ref: "#/components/parameters/ApiKeyPublic" };
const TIMESTAMP = { $ref: "#/components/parameters/ApiTimestamp" };

/** Minimal spec with a root selection path and an id-only path sharing the tag's name. */
function propertySpec() {
  return {
    info: { version: "t.1" },
    components: {
      parameters: {
        ApiKeyPublic: { name: "key", in: "query", required: false, schema: { type: "string" } },
        ApiTimestamp: { name: "timestamp", in: "query", required: false, schema: { type: "integer" } },
      },
      schemas: {},
    },
    paths: {
      "/property": {
        get: { tags: ["Property"], summary: "Get any property selection", parameters: [KEY] },
      },
      "/property/{id}/property": {
        get: {
          tags: ["Property"],
          summary: "Get a specific property",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
            TIMESTAMP,
            KEY,
          ],
        },
      },
      "/property/timestamp": {
        get: { tags: ["Property"], summary: "Get current server time", parameters: [KEY] },
      },
    },
  };
}

/** Plain + id variants of one endpoint whose query contracts differ. */
function variantSpec() {
  const LIMIT = { name: "limit", in: "query", required: false, schema: { type: "integer" } };
  return {
    info: { version: "t.2" },
    components: { parameters: propertySpec().components.parameters, schemas: {} },
    paths: {
      "/torn/honors": {
        get: { tags: ["Torn"], summary: "Get all honors", parameters: [LIMIT, TIMESTAMP, KEY] },
      },
      "/torn/{ids}/honors": {
        get: {
          tags: ["Torn"],
          summary: "Get specific honors",
          parameters: [
            { name: "ids", in: "path", required: true, schema: { type: "array", items: { type: "integer" } } },
            TIMESTAMP,
            KEY,
          ],
        },
      },
      "/torn/timestamp": {
        get: { tags: ["Torn"], summary: "Get current server time", parameters: [TIMESTAMP, KEY] },
      },
      "/torn/{id}/timestamp": {
        get: {
          tags: ["Torn"],
          summary: "Get current server time",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }, TIMESTAMP, KEY],
        },
      },
    },
  };
}

describe("buildCatalog: id/no-id variants keep their own contracts", () => {
  it("records the id variant's query list and summary when they differ", () => {
    const honors = buildCatalog(variantSpec()).tags.torn.honors;
    expect(honors.query.map((q: { name: string }) => q.name)).toEqual(["limit", "timestamp"]);
    expect(honors.idQuery.map((q: { name: string }) => q.name)).toEqual(["timestamp"]);
    expect(honors.summary).toBe("Get all honors");
    expect(honors.idSummary).toBe("Get specific honors");
  });

  it("is independent of path order in the spec", () => {
    const spec = variantSpec();
    const reversed = { ...spec, paths: Object.fromEntries(Object.entries(spec.paths).reverse()) };
    const honors = buildCatalog(reversed).tags.torn.honors;
    expect(honors.query.map((q: { name: string }) => q.name)).toEqual(["limit", "timestamp"]);
    expect(honors.idQuery.map((q: { name: string }) => q.name)).toEqual(["timestamp"]);
    expect(honors.summary).toBe("Get all honors");
  });

  it("omits idQuery/idSummary when the variants agree", () => {
    const ts = buildCatalog(variantSpec()).tags.torn.timestamp;
    expect(ts.idQuery).toBeUndefined();
    expect(ts.idSummary).toBeUndefined();
    expect(ts.idPath).toBe("/torn/{id}/timestamp");
  });

  it("omits idQuery/idSummary on id-only endpoints", () => {
    const prop = buildCatalog(propertySpec()).tags.property.property;
    expect(prop.idQuery).toBeUndefined();
    expect(prop.idSummary).toBeUndefined();
  });
});

describe("buildCatalog: response content type", () => {
  const csvSpec = () => ({
    info: { version: "t.3" },
    components: { parameters: propertySpec().components.parameters, schemas: {} },
    paths: {
      "/user/snapshot": {
        get: {
          tags: ["User"],
          summary: "Get your snapshot",
          parameters: [KEY],
          responses: { 200: { content: { "text/csv": { schema: { type: "string" } } } } },
        },
      },
      "/user/bars": {
        get: {
          tags: ["User"],
          summary: "Get your bars",
          parameters: [KEY],
          responses: { 200: { content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    },
  });

  it("marks text/csv endpoints so the server does not try to parse them as JSON", () => {
    const cat = buildCatalog(csvSpec());
    expect(cat.tags.user.snapshot.responseType).toBe("csv");
    expect(cat.tags.user.bars.responseType).toBeUndefined();
  });
});

describe("buildCatalog: paths whose last literal segment equals the tag", () => {
  it("keeps the parameterized path as an id-only endpoint", () => {
    const cat = buildCatalog(propertySpec());
    const prop = cat.tags.property.property;
    expect(prop).toBeDefined();
    expect(prop.requiresId).toBe(true);
    expect(prop.idPath).toBe("/property/{id}/property");
    expect(prop.path).toBeUndefined();
    expect(prop.idParam).toEqual({ name: "id", type: "integer", description: undefined });
  });

  it("still drops the bare root selection path", () => {
    const cat = buildCatalog(propertySpec());
    expect(Object.keys(cat.tags.property).sort()).toEqual(["property", "timestamp"]);
    expect(cat.endpoints).toBe(2);
    expect(cat.rawOps).toBe(3);
  });

  it("derives the query list from the spec minus the key param", () => {
    const cat = buildCatalog(propertySpec());
    expect(cat.tags.property.property.query.map((q: { name: string }) => q.name)).toEqual(["timestamp"]);
  });
});
