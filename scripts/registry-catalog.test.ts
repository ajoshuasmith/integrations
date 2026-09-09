import { expect, test } from "bun:test";
import { reconcileRegistryCatalog } from "./registry-catalog.ts";

test("every published OpenAPI listing has a unique revision-resolvable surface", () => {
	const documents = new Map<string, Record<string, unknown>>();
	const row = {
		kind: "openapi",
		domain: "example.com",
		name: "Example",
		slug: "example",
		connectUrl: "https://spec.example.com/api.json",
	};
	const result = reconcileRegistryCatalog(
		{ version: 1, data: [row, row, { ...row, domain: "localhost" }] },
		documents,
	);
	expect(result.envelope.data).toHaveLength(1);
	expect(result.added).toBe(1);
	expect(result.omitted).toBe(2);
	expect(documents.get("example.com")?.surfaces).toEqual([
		{
			type: "http",
			name: "Example",
			slug: "example",
			spec: row.connectUrl,
			basis: { via: "discovered", signal: "registry-catalog" },
			auth: { status: "unknown" },
		},
	]);
	expect(reconcileRegistryCatalog(result.envelope, documents).added).toBe(0);
});

test("preserves existing reviewed provenance and refuses ambiguous source selection", () => {
	const surface = {
		type: "http",
		slug: "existing",
		spec: "https://spec.example.com/api.json",
		basis: { via: "declared" },
	};
	const documents = new Map([
		["example.com", { version: 3, domain: "example.com", surfaces: [surface] }],
	]);
	const catalog = {
		version: 1,
		data: [
			{ kind: "openapi", domain: "example.com", connectUrl: surface.spec },
		],
	};
	expect(reconcileRegistryCatalog(catalog, documents).added).toBe(0);
	expect(documents.get("example.com")?.surfaces[0]).toBe(surface);
	documents
		.get("example.com")!
		.surfaces.push({ ...surface, slug: "duplicate" });
	expect(() => reconcileRegistryCatalog(catalog, documents)).toThrow(
		"Ambiguous",
	);
});

test("omits source locators rejected by the importer without publishing credentials", () => {
	for (const connectUrl of [
		"https://127.0.0.1/schema.json", "https://[::1]/schema.json",
		"https://localhost/schema.json", "https://localhost./schema.json",
		"https://service.internal./schema.json", "https://foo.localhost/schema.json",
		"https://api.example.com/schema.json?X-Amz-Credential=fixture",
		"https://api.example.com/schema.json?X-Amz-Signature=fixture",
		"https://api.example.com/schema.json?sig=fixture",
		"https://api.example.com/schema.json#access_token=fixture", "https://service.internal/schema.json",
		"https://service.local/schema.json", "https://single/schema.json",
		"https://api.example.com/schema.json?api_key=fixture",
		"https://api.example.com/schema.json?access_token=fixture",
		"https://api.example.com/schema.json?sessionId=fixture",
	]) {
		const documents = new Map<string, Record<string, unknown>>();
		const result = reconcileRegistryCatalog({ version: 1, data: [
			{ kind: "openapi", domain: "example.com", connectUrl },
		] }, documents);
		expect(result.envelope.data).toHaveLength(0);
		expect(documents.size).toBe(0);
	}
	const result = reconcileRegistryCatalog({ version: 1, data: [
		{ kind: "openapi", domain: "example.com", connectUrl: "https://api.example.com/schema.json?version=2" },
	] }, new Map());
	expect(result.envelope.data).toHaveLength(1);
});

test("preserves alias discovery evidence and refuses conflicting canonical buckets", () => {
	const surface = { type: "http", slug: "reviewed-api", spec: "https://api.notion.com/schema.json", basis: { via: "declared" }, auth: { status: "required" } };
	const original = { version: 3, domain: "notion.so", credentials: { apiKey: { description: "Reviewed credential" } }, surfaces: [surface] };
	const documents = new Map<string, Record<string, unknown>>([["notion.so", original]]);
	const catalog = { version: 1, data: [{ kind: "openapi", domain: "notion.so", connectUrl: surface.spec }] };
	const result = reconcileRegistryCatalog(catalog, documents);
	expect(result.added).toBe(0);
	expect(documents.get("notion.com")).toEqual({ ...original, domain: "notion.com" });
	expect(documents.has("notion.so")).toBe(false);
	const conflicting = new Map<string, Record<string, unknown>>([
		["notion.so", original], ["notion.com", { ...original, domain: "notion.com" }],
	]);
	expect(() => reconcileRegistryCatalog(catalog, conflicting)).toThrow("Conflicting alias");
	expect(conflicting.get("notion.so")).toBe(original);
});


test("non-OpenAPI rows retain a resolvable canonical discovery domain", () => {
  const document = { version: 3, domain: "notion.so", surfaces: [{ type: "mcp", slug: "mcp", url: "https://mcp.notion.com/mcp" }] };
  const documents = new Map<string, Record<string, unknown>>([["notion.so", document]]);
  const result = reconcileRegistryCatalog({ version: 1, data: [{ kind: "mcp", domain: "notion.so", connectUrl: "https://mcp.notion.com/mcp" }] }, documents);
  expect(result.envelope.data[0].domain).toBe("notion.com");
  expect(documents.get(String(result.envelope.data[0].domain))?.surfaces).toEqual(document.surfaces);
});


test("allows public boolean download selectors but rejects opaque download credentials", () => {
  for (const value of ["", "0", "1", "false", "true", "opaque-credential"]) {
    const result = reconcileRegistryCatalog({ version: 1, data: [{ kind: "openapi", domain: "example.com", connectUrl: `https://spec.example.com/openapi.json?download=${value}` }] }, new Map());
    expect(result.envelope.data).toHaveLength(value === "opaque-credential" ? 0 : 1);
  }
});
