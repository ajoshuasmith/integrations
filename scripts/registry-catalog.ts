import { canonicalDomain } from "../src/lib/domain-aliases.ts";
import { isJunkDomain } from "../src/lib/favicon.ts";

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row =>
	!!value && typeof value === "object" && !Array.isArray(value);
function safeSpecUrl(value: string): string {
	const url = new URL(value);
	const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
	if (url.protocol !== "https:" || url.username || url.password || url.hash ||
		!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
		hostname.endsWith(".internal") || hostname.includes(":") ||
		/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || !hostname.includes(".")) {
		throw new Error("Unsafe spec URL");
	}
	for (const [key, value] of url.searchParams) {
		if (!["v", "version", "format"].includes(key) &&
			!(key === "download" && ["", "0", "1", "false", "true"].includes(value))) {
			throw new Error("Credential-bearing spec URL");
		}
	}
	return url.href;
}

const domainPattern =
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Publish discovery evidence consistently; this never approves an operation or credentials. */
export function reconcileRegistryCatalog(
	envelope: Row,
	documents: Map<string, Row>,
) {
	if (envelope.version !== 1 || !Array.isArray(envelope.data))
		throw new Error("Invalid registry catalog");
	// Alias evidence cannot be replaced with a synthetic unknown-auth surface.
	// An overlapping canonical bucket requires explicit evidence reconciliation.
	for (const [domain, document] of [...documents]) {
		const canonical = canonicalDomain(domain);
		if (canonical === domain) continue;
		if (documents.has(canonical))
			throw new Error(`Conflicting alias registry documents for ${canonical}`);
		if (document.domain !== domain || document.version !== 3 || !Array.isArray(document.surfaces))
			throw new Error(`Invalid registry surface ${domain}`);
		documents.set(canonical, { ...document, domain: canonical });
		documents.delete(domain);
	}
	let added = 0;
	let omitted = 0;
	const seen = new Set<string>();
	const data = envelope.data.filter(record).flatMap((row) => {
		if (row.kind !== "openapi") return [typeof row.domain === "string"
			? { ...row, domain: canonicalDomain(row.domain) } : row];
		const domain =
			typeof row.domain === "string" ? canonicalDomain(row.domain) : "";
		if (
			!domainPattern.test(domain) ||
			isJunkDomain(domain) ||
			typeof row.connectUrl !== "string"
		) {
			omitted++;
			return [];
		}
		let spec: string;
		try {
			spec = safeSpecUrl(row.connectUrl);
		} catch {
			omitted++;
			return [];
		}
		const key = `${domain}\n${spec}`;
		if (seen.has(key)) {
			omitted++;
			return [];
		}
		seen.add(key);
		let doc = documents.get(domain);
		if (!doc) {
			doc = { version: 3, domain, summary: "", credentials: {}, surfaces: [] };
			documents.set(domain, doc);
		}
		if (
			doc.version !== 3 ||
			doc.domain !== domain ||
			!Array.isArray(doc.surfaces)
		)
			throw new Error(`Invalid registry surface ${domain}`);
		const matches = doc.surfaces.filter((surface: unknown) => {
			if (
				!record(surface) ||
				surface.type !== "http" ||
				typeof surface.spec !== "string"
			)
				return false;
			try {
				return new URL(surface.spec).href === spec;
			} catch {
				return false;
			}
		});
		if (matches.length > 1)
			throw new Error(`Ambiguous registry specification for ${domain}`);
		if (matches.length === 0) {
			const used = new Set(
				doc.surfaces.filter(record).map((surface) => surface.slug),
			);
			const base =
				String(row.slug ?? row.name ?? "openapi")
					.toLowerCase()
					.replace(/[^a-z0-9._-]+/g, "-")
					.replace(/^[^a-z0-9]+/, "")
					.slice(0, 140) || "openapi";
			let slug = base;
			for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
			doc.surfaces.push({
				type: "http",
				name: row.name ?? domain,
				slug,
				spec,
				basis: { via: "discovered", signal: "registry-catalog" },
				auth: { status: "unknown" },
			});
			added++;
		}
		return [{ ...row, domain, connectUrl: spec }];
	});
	return { envelope: { ...envelope, data }, added, omitted };
}
