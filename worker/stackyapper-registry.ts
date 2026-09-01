import { canonicalDomain } from "../src/lib/domain-aliases.ts";

interface AssetFetcher {
  fetch(input: Request | string): Promise<Response>;
}

export interface StackYapperRegistryEnv {
  ASSETS: AssetFetcher;
  REGISTRY_SOURCE_REPOSITORY?: string;
  REGISTRY_UPSTREAM_COMMIT?: string;
}

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const ALLOWED_METHODS = "GET, HEAD, OPTIONS";
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function commonHeaders(cacheControl = "no-store"): Headers {
  return new Headers({
    "access-control-allow-origin": "*",
    "cache-control": cacheControl,
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
}

function json(body: unknown, status = 200, cacheControl = "no-store"): Response {
  const headers = commonHeaders(cacheControl);
  headers.set("content-type", JSON_CONTENT_TYPE);
  return new Response(JSON.stringify(body), { status, headers });
}

function copyAssetResponse(response: Response, method: string, cacheControl: string): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of commonHeaders(cacheControl)) headers.set(key, value);
  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function canonicalCatalogDomain(encodedDomain: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encodedDomain).trim().toLowerCase();
  } catch {
    return null;
  }
  if (!DOMAIN_PATTERN.test(decoded)) return null;
  return canonicalDomain(decoded);
}

async function asset(env: StackYapperRegistryEnv, requestUrl: URL, path: string): Promise<Response> {
  const assetUrl = new URL(path, requestUrl.origin);
  return env.ASSETS.fetch(assetUrl.href);
}

async function surfaceResponse(
  request: Request,
  env: StackYapperRegistryEnv,
  requestUrl: URL,
  encodedDomain: string,
): Promise<Response> {
  const domain = canonicalCatalogDomain(encodedDomain);
  if (!domain) return json({ error: "invalid domain" }, 400);
  const response = await asset(env, requestUrl, `/disc/${encodeURIComponent(domain)}.json`);
  if (!response.ok) {
    await response.body?.cancel();
    return json({ error: "surface not found" }, 404, "public, max-age=60");
  }
  return copyAssetResponse(response, request.method, "public, max-age=300");
}

async function handle(request: Request, env: StackYapperRegistryEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    const headers = commonHeaders("public, max-age=86400");
    headers.set("access-control-allow-methods", ALLOWED_METHODS);
    headers.set("access-control-allow-headers", "accept, content-type");
    headers.set("access-control-max-age", "86400");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = json({ error: "method not allowed" }, 405);
    response.headers.set("allow", ALLOWED_METHODS);
    return response;
  }

  const upstreamCommit = env.REGISTRY_UPSTREAM_COMMIT;
  if (!upstreamCommit || !/^[a-f0-9]{40}$/.test(upstreamCommit)) {
    return json(
      {
        ok: false,
        error: "registry upstream commit is not configured",
      },
      503,
    );
  }

  if (url.pathname === "/health") {
    return json({
      ok: true,
      service: "stackyapper-integrations-registry",
      sourceRepository: env.REGISTRY_SOURCE_REPOSITORY ?? "https://github.com/ajoshuasmith/integrations",
      upstreamCommit,
    });
  }

  if (url.pathname === "/api.json") {
    const response = await asset(env, url, "/api.json");
    return copyAssetResponse(response, request.method, "public, max-age=3600");
  }

  const surface = /^\/api\/([^/]+)\/surface\/?$/.exec(url.pathname);
  if (surface) return surfaceResponse(request, env, url, surface[1]!);

  if (url.pathname.startsWith("/specs/")) {
    const response = await asset(env, url, url.pathname);
    return copyAssetResponse(response, request.method, "public, max-age=300");
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request: Request, env: StackYapperRegistryEnv): Promise<Response> {
    const response = await handle(request, env);
    if (request.method !== "HEAD") return response;
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
};
