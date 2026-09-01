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

console.log(
  `Prepared read-only StackYapper registry assets in dist-registry/ (${rewrittenUrlCount} owned URLs rewritten)`,
);
