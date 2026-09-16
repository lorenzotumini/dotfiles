/**
 * `.memory/` substrate (Phase B). The filesystem IS the long-term recall interface: the master
 * reads topic files with ordinary `ls`/`read`/`grep`. Topic files are NOT rolled back by `/tree`
 * (they track the repo, not the session branch).
 *
 * Layout under <project>/.memory/:
 *   INDEX.md            — orchestrator-owned; (re)rendered from topic front-matter
 *   <topic>.md          — consolidator-authored; YAML front-matter + current-state prose
 *   .runs/<id>.json     — transient worker IPC (not GC'd in v1)
 *
 * All writes are atomic (temp + rename) so a reader never sees a half-written file.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const MAX_MEMORY_FILE_BYTES = 64 * 1024;
export function readMemoryText(root: string, requested: string): string {
	const path = resolveWithinMemory(root, requested);
	if (!path) throw new Error("path escapes memory or contains a symlink");
	const stat = statSync(path);
	if (!stat.isFile() || stat.size > MAX_MEMORY_FILE_BYTES) throw new Error("memory file is not regular or exceeds 64 KiB");
	return readFileSync(path, "utf8");
}

export const INDEX_FILENAME = "INDEX.md";
/**
 * The running, whole-project descriptive history. Consolidator-authored prose (no front-matter),
 * pushed into every compaction block for orientation. Like INDEX.md it is a special file, NOT a
 * topic file: it is excluded from `listTopics`/the memory map and read verbatim at compaction.
 */
export const JOURNEY_FILENAME = "JOURNEY.md";

/** The project-level `.memory/` base. Per-session roots live one level below it. */
export function memoryBaseDir(cwd: string): string {
	return join(cwd, ".memory");
}

/**
 * The per-session memory root: `.memory/<sessionId>/`. All durable long-term memory (INDEX,
 * topic files, JOURNEY) and transient `.runs/` IPC are scoped under here so two sessions in the
 * same project never share consolidator output. Keyed by the immutable session header id
 * (survives /name, /resume, /tree) — NOT the session filename or display name.
 */
export function sessionMemoryRoot(cwd: string, sessionId: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId)) throw new Error("invalid memory session ID");
	const root = join(memoryBaseDir(cwd), sessionId);
	if (!resolveWithinMemory(root, ".")) throw new Error("memory root contains a symlink");
	return root;
}

export function indexPath(root: string): string {
	return join(root, INDEX_FILENAME);
}

export function journeyPath(root: string): string {
	return join(root, JOURNEY_FILENAME);
}

/** Read `.memory/JOURNEY.md` body, trimmed. Returns undefined when missing or effectively empty. */
export function readJourney(root: string): string | undefined {
	const path = journeyPath(root);
	if (!existsSync(path)) return undefined;
	try {
		const body = readMemoryText(root, path).trim();
		return body.length > 0 ? body : undefined;
	} catch {
		return undefined;
	}
}

/** Atomic write (temp + rename). Creates parent dirs as needed. */
export function atomicWrite(path: string, content: string): void {
	if (!resolveWithinMemory(dirname(path), path)) throw new Error("memory write path contains a symlink");
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = `${path}.tmp-${randomUUID()}`;
	writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
	renameSync(tmp, path);
}

/**
 * Resolve a (possibly relative) path and confirm it stays inside `.memory/`. Returns the
 * absolute path, or undefined if it escapes the sandbox. The consolidator's scoped tools use
 * this to reject any path outside `.memory/` (design risk 6).
 */
export function resolveWithinMemory(root: string, requestedPath: string): string | undefined {
	if (requestedPath.includes("\0")) return undefined;
	const base = resolve(root);
	const abs = resolve(base, requestedPath);
	const rel = relative(base, abs);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
	// Check every existing ancestor, including .memory itself and dangling links.
	// This deliberately refuses symlink-backed roots as well as symlink children.
	for (let current = abs; ; current = dirname(current)) {
		try { if (lstatSync(current).isSymbolicLink()) return undefined; }
		catch (error: any) { if (error.code !== "ENOENT") return undefined; }
		if (dirname(current) === current) break;
	}
	return abs;
}

export type TopicFrontMatter = {
	id?: string;
	title?: string;
	summary?: string;
	updated?: string;
};

export type Topic = TopicFrontMatter & {
	/** Path relative to the project root, e.g. ".memory/auth.md". */
	path: string;
	/** Bare filename, e.g. "auth.md". */
	filename: string;
};

const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/**
 * Parse leading YAML-ish front-matter. Intentionally tiny (no YAML dep): supports the flat
 * `key: value` fields the consolidator authors (id, title, summary, updated). Returns the
 * parsed fields plus the body after the front-matter block.
 */
export function parseFrontMatter(content: string): { front: TopicFrontMatter; body: string } {
	const match = FRONT_MATTER_RE.exec(content);
	if (!match) return { front: {}, body: content };
	const front: TopicFrontMatter = {};
	for (const line of match[1].split("\n")) {
		const idx = line.indexOf(":");
		if (idx < 0) continue;
		const key = line.slice(0, idx).trim();
		let value = line.slice(idx + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (key === "id" || key === "title" || key === "summary" || key === "updated") {
			front[key] = value;
		}
	}
	return { front, body: content.slice(match[0].length) };
}

/**
 * List parsed topic files (every `*.md` except INDEX.md/JOURNEY.md) under a session memory
 * root, sorted by filename. Each topic's `path` is rendered relative to the project cwd (e.g.
 * `.memory/<sessionId>/auth.md`) so the master can `read`/`grep` it directly from the map.
 */
export function listTopics(root: string): Topic[] {
	if (!existsSync(root)) return [];
	const cwd = resolve(root, "..", "..");
	const topics: Topic[] = [];
	for (const filename of readdirSync(root)) {
		if (!filename.endsWith(".md") || filename === INDEX_FILENAME || filename === JOURNEY_FILENAME) continue;
		let content: string;
		try {
			content = readMemoryText(root, filename);
		} catch {
			continue;
		}
		const { front } = parseFrontMatter(content);
		topics.push({ ...front, path: relative(cwd, join(root, filename)), filename });
	}
	topics.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
	return topics;
}
