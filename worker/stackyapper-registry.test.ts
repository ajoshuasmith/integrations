import { describe, expect, test } from "bun:test";
import registry, { type StackYapperRegistryEnv } from "./stackyapper-registry.ts";

function environment(files: Record<string, { body: string; contentType?: string }>): StackYapperRegistryEnv {
  return {
    ASSETS: {
      async fetch(input) {
        const path = new URL(typeof input === "string" ? input : input.url).pathname;
        const file = files[path];
        if (!file) return new Response("missing", { status: 404 });
        return new Response(file.body, {
          headers: { "content-type": file.contentType ?? "application/json" },
        });
      },
    },
    REGISTRY_UPSTREAM_COMMIT: "5606ced463b7bd3a93fa55b90a35f6e5eba93ccb",
  };
}

describe("StackYapper catalog-only registry", () => {
  test("serves health and records the pinned upstream commit", async () => {
    const response = await registry.fetch(new Request("https://registry.stackyapper.dev/health"), environment({}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "stackyapper-integrations-registry",
      sourceRepository: "https://github.com/ajoshuasmith/integrations",
      upstreamCommit: "5606ced463b7bd3a93fa55b90a35f6e5eba93ccb",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("serves only the catalog artifact and adds CORS", async () => {
    const env = environment({
      "/api.json": {
        body: JSON.stringify({
          version: 1,
          data: [{ connectUrl: "https://registry.stackyapper.dev/specs/google/calendar.json" }],
        }),
      },
    });
    const response = await registry.fetch(new Request("https://registry.stackyapper.dev/api.json"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: 1,
      data: [{ connectUrl: "https://registry.stackyapper.dev/specs/google/calendar.json" }],
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  test("keeps mutable mirrored specs on the catalog revalidation window", async () => {
    const env = environment({
      "/specs/example/openapi.json": { body: '{"openapi":"3.1.0"}' },
    });
    const response = await registry.fetch(
      new Request("https://registry.stackyapper.dev/specs/example/openapi.json"),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("cache-control")).not.toContain("immutable");
  });

  test("canonicalizes aliases and rewrites registry-owned specifications", async () => {
    const env = environment({
      "/disc/zoom.com.json": {
        body: JSON.stringify({
          version: 3,
          domain: "zoom.com",
          surfaces: [{ type: "http", spec: "https://registry.stackyapper.dev/specs/zoom/openapi.json" }],
        }),
      },
    });
    const response = await registry.fetch(
      new Request("https://registry.stackyapper.dev/api/zoom.us/surface"),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: 3,
      domain: "zoom.com",
      surfaces: [{ type: "http", spec: "https://registry.stackyapper.dev/specs/zoom/openapi.json" }],
    });
  });

  test("rejects invalid domains and all mutating routes", async () => {
    const env = environment({});
    const invalid = await registry.fetch(
      new Request("https://registry.stackyapper.dev/api/%2e%2e%2fsecret/surface"),
      env,
    );
    expect(invalid.status).toBe(400);

    const discovery = await registry.fetch(
      new Request("https://registry.stackyapper.dev/api/stripe.com/discover"),
      env,
    );
    expect(discovery.status).toBe(404);

    const post = await registry.fetch(
      new Request("https://registry.stackyapper.dev/api.json", { method: "POST" }),
      env,
    );
    expect(post.status).toBe(405);
  });

  test("fails closed when the deployed catalog has no exact upstream pin", async () => {
    const env = environment({ "/api.json": { body: '{"version":1,"data":[]}' } });
    delete env.REGISTRY_UPSTREAM_COMMIT;
    const response = await registry.fetch(new Request("https://registry.stackyapper.dev/api.json"), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: "registry upstream commit is not configured",
    });
  });

  test("returns no body for successful and failing HEAD requests", async () => {
    const env = environment({});
    const health = await registry.fetch(
      new Request("https://registry.stackyapper.dev/health", { method: "HEAD" }),
      env,
    );
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("");

    const missing = await registry.fetch(
      new Request("https://registry.stackyapper.dev/missing", { method: "HEAD" }),
      env,
    );
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("");
  });
});
