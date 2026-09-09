import { expect, test } from "bun:test";
import { recordToSurface } from "./catalog-to-discovery.ts";

test("OpenAPI documentation links do not become API server constraints", () => {
	const surface = recordToSurface({
		id: "openapi/example",
		kind: "openapi",
		slug: "example",
		name: "Example",
		description: "",
		url: "https://docs.example.com/api",
		categories: [],
		feeds: ["apis-guru"],
		raw: {},
		openapi: {
			provider: "example.com",
			version: "1",
			openapiVer: "3.0.3",
			specUrl: "https://schemas.example.com/openapi.json",
			docsUrl: "https://docs.example.com/api",
		},
	});
	expect(surface?.docs).toBe("https://docs.example.com/api");
	expect(surface?.type).toBe("http");
	expect(surface).not.toHaveProperty("url");
});
