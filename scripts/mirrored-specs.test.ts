import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeMicrosoftScopeRequirements } from "./microsoft-scope-requirements.ts";

test("normalized Microsoft mirrors preserve scope sets and all other source fields", () => {
  const root = join(import.meta.dir, "../public/specs/microsoft-graph");
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  for (const [id, entry] of Object.entries(manifest.specs) as [string, { bytes: number; scopes: string[] }][]) {
    const original = readFileSync(join(root, `${id}.json`), "utf8");
    const { text } = normalizeMicrosoftScopeRequirements(original);
    const spec = JSON.parse(text);
    const scopes = spec.security[0].microsoftOAuth2;
    expect(scopes, id).toEqual([...new Set(scopes)]);
    expect(scopes, id).toEqual([...new Set(entry.scopes)]);
    const expected = JSON.parse(original);
    expected.security[0].microsoftOAuth2 = [...new Set(expected.security[0].microsoftOAuth2)];
    expect(spec, id).toEqual(expected);
    expect(normalizeMicrosoftScopeRequirements(text).text, id).toBe(text);
    expect(Object.keys(spec.components.securitySchemes.microsoftOAuth2.flows.authorizationCode.scopes), id).toEqual(scopes);
  }
});


test("mirror normalization refuses unexpected or undeclared authentication", () => {
  for (const document of [{}, { security: [{ microsoftOAuth2: ["missing"] }] }, { security: [{ other: [] }] }]) {
    expect(() => normalizeMicrosoftScopeRequirements(JSON.stringify(document))).toThrow();
  }
});


test("publication counts UTF-8 bytes for non-ASCII mirrored schemas", () => {
  const document = {
    info: { title: "Météo 🛰" }, security: [{ microsoftOAuth2: ["User.Read", "User.Read"] }],
    components: { securitySchemes: { microsoftOAuth2: { flows: {
      authorizationCode: { scopes: { "User.Read": "Profile" } },
    } } } },
  };
  const normalized = normalizeMicrosoftScopeRequirements(JSON.stringify(document));
  expect(normalized.bytes).toBe(Buffer.from(normalized.text, "utf8").length);
  expect(normalized.bytes).toBeGreaterThan(normalized.text.length);
  const unchanged = normalizeMicrosoftScopeRequirements(normalized.text);
  expect(unchanged.bytes).toBe(normalized.bytes);
});
