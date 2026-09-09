import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { normalizeMicrosoftScopeRequirements } from "./microsoft-scope-requirements.ts";
import { reconcileRegistryCatalog } from "./registry-catalog.ts";

const projectRoot = process.cwd();
const sourceRoot = join(projectRoot, "dist");
const targetRoot = join(projectRoot, "dist-registry");
const requiredArtifacts = ["api.json", "disc", "specs"] as const;
const canonicalSpecPrefix = "https://integrations.sh/specs/";
const mirroredSpecPrefix = "https://registry.stackyapper.dev/specs/";

for (const artifact of requiredArtifacts) {
  if (!existsSync(join(sourceRoot, artifact))) {
    throw new Error(`Missing registry build artifact: dist/${artifact}`);
  }
}

rmSync(targetRoot, { recursive: true, force: true });
mkdirSync(targetRoot, { recursive: true });
for (const artifact of requiredArtifacts) {
  const source = join(sourceRoot, artifact);
  const target = join(targetRoot, artifact);
  cpSync(source, target, { recursive: statSync(source).isDirectory() });
}

function registryTextFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    registryTextFiles(join(path, entry.name)),
  );
}

let rewrittenUrlCount = 0;
for (const artifact of requiredArtifacts) {
  for (const path of registryTextFiles(join(targetRoot, artifact))) {
    const original = readFileSync(path, "utf8");
    const rewritten = original.replaceAll(canonicalSpecPrefix, mirroredSpecPrefix);
    if (rewritten === original) continue;
    rewrittenUrlCount += original.split(canonicalSpecPrefix).length - 1;
    writeFileSync(path, rewritten);
  }
}

for (const artifact of requiredArtifacts) {
  for (const path of registryTextFiles(join(targetRoot, artifact))) {
    if (readFileSync(path, "utf8").includes(canonicalSpecPrefix)) {
      throw new Error(`Registry asset still depends on the public spec origin: ${path}`);
    }
  }
}

// Repair generated scope sets at publication, without rewriting the large
// upstream mirrors or relaxing importer validation of customer documents.
const microsoftRoot = join(targetRoot, "specs", "microsoft-graph");
const microsoftManifestPath = join(microsoftRoot, "manifest.json");
const microsoftManifest = JSON.parse(readFileSync(microsoftManifestPath, "utf8"));
for (const id of Object.keys(microsoftManifest.specs)) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid Microsoft mirror id");
  const path = join(microsoftRoot, `${id}.json`);
  const normalized = normalizeMicrosoftScopeRequirements(readFileSync(path, "utf8"));
  writeFileSync(path, normalized.text);
  microsoftManifest.specs[id].scopes = normalized.scopes;
  microsoftManifest.specs[id].bytes = normalized.bytes;
}
writeFileSync(microsoftManifestPath, JSON.stringify(microsoftManifest, null, 2) + "\n");

const documents = new Map<string, Record<string, unknown>>();
for (const name of readdirSync(join(targetRoot, "disc"))) {
	if (!name.endsWith(".json") || name === "meta.json") continue;
	const document = JSON.parse(
		readFileSync(join(targetRoot, "disc", name), "utf8"),
	);
	documents.set(name.slice(0, -5), document);
}
const originalDocumentDomains = [...documents.keys()];
const reconciled = reconcileRegistryCatalog(
	JSON.parse(readFileSync(join(targetRoot, "api.json"), "utf8")),
	documents,
);
writeFileSync(
	join(targetRoot, "api.json"),
	JSON.stringify(reconciled.envelope),
);
// Reconciliation moves alias evidence into its canonical document. Remove the
// copied alias artifact so direct surface requests cannot observe stale evidence.
for (const domain of originalDocumentDomains) {
	if (!documents.has(domain)) rmSync(join(targetRoot, "disc", `${domain}.json`));
}
for (const [domain, document] of documents) {
	writeFileSync(
		join(targetRoot, "disc", `${domain}.json`),
		JSON.stringify(document),
	);
}
console.log(
	`Reconciled registry catalog: ${reconciled.added} missing surfaces added; ${reconciled.omitted} unusable or duplicate listings omitted`,
);


console.log(
  `Prepared read-only StackYapper registry assets in dist-registry/ (${rewrittenUrlCount} owned URLs rewritten)`,
);
