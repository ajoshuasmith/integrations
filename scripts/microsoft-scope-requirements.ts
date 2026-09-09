/** Normalize our generated Microsoft mirrors, retaining every distinct scope.
 * Scope requirements are sets. The upstream preset includes User.Read both as
 * a base scope and in profile presets; no permission should be added or lost.
 */
export function normalizeMicrosoftScopeRequirements(text: string): {
  text: string;
  scopes: string[];
  bytes: number;
} {
  const spec = JSON.parse(text);
  const requirements = spec.security;
  if (!Array.isArray(requirements) || requirements.length !== 1 ||
      Object.keys(requirements[0]).join() !== "microsoftOAuth2" ||
      !Array.isArray(requirements[0].microsoftOAuth2) ||
      !requirements[0].microsoftOAuth2.every((scope: unknown) => typeof scope === "string")) {
    throw new Error("Unexpected Microsoft mirror security requirements");
  }
  const scopes = [...new Set<string>(requirements[0].microsoftOAuth2)];
  const declared = spec.components?.securitySchemes?.microsoftOAuth2?.flows?.authorizationCode?.scopes;
  if (!declared || scopes.some((scope) => !Object.hasOwn(declared, scope))) {
    throw new Error("Microsoft mirror requires an undeclared scope");
  }
  if (scopes.length === requirements[0].microsoftOAuth2.length) return { text, scopes, bytes: Buffer.byteLength(text, "utf8") };
  spec.security = [{ microsoftOAuth2: scopes }];
  const normalized = JSON.stringify(spec);
  return { text: normalized, scopes, bytes: Buffer.byteLength(normalized, "utf8") };
}
