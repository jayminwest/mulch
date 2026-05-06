// Repo-relative POSIX paths. Strip trailing slashes and a leading "./", coerce
// repo-root markers ("." / "" / "./") to "" so they're filtered out of stored
// anchors (meaningless to anchor at the repo root). Tolerant of legacy values
// on disk: never throws — see assertWritableDirAnchor for write-time validation
// (which rejects absolute paths and parent-traversal segments).
export function normalizeDirAnchor(input: string): string {
	let v = input.trim();
	if (v === "" || v === ".") return "";
	v = v.replace(/\\+/g, "/");
	v = v.replace(/\/+$/, "");
	if (v.startsWith("./")) v = v.slice(2);
	v = v.replace(/\/+$/, "");
	if (v === "" || v === ".") return "";
	return v;
}

// Throws if the input is unsafe to store as a project-root-relative anchor:
// absolute paths (`/etc/passwd`, `C:\…`) and parent-traversal segments (`..`)
// would silently break ml prime/--files matching, doctor's existsSync probe,
// and anchor-validity decay. Called at write time (ml record / ml edit) so
// invalid input surfaces as a formatted error before it lands on disk.
export function assertWritableDirAnchor(raw: string): void {
	const v = raw.trim();
	if (v.length === 0) return;
	if (/^[a-zA-Z]:[\\/]/.test(v) || v.startsWith("/") || v.startsWith("\\")) {
		throw new Error(
			`dir-anchor "${raw}" is an absolute path. Use a project-root-relative path like "src/utils".`,
		);
	}
	const segments = v.replace(/\\+/g, "/").split("/");
	if (segments.includes("..")) {
		throw new Error(
			`dir-anchor "${raw}" contains ".." (parent traversal). Anchors must stay inside the project root.`,
		);
	}
}

export function fileLivesUnderDir(file: string, dir: string): boolean {
	const f = file.replace(/\\+/g, "/");
	const d = normalizeDirAnchor(dir);
	if (d === "") return true;
	return f === d || f.startsWith(`${d}/`);
}

// Heuristic: any directory that is the parent of >= threshold changed files
// becomes a dir anchor. Returns the deepest such directories, deduped and sorted.
// Threshold default of 3 keeps single-file edits and pair-edits from generating
// noisy anchors.
export function inferDirAnchors(files: string[], threshold = 3): string[] {
	const counts = new Map<string, number>();
	for (const raw of files) {
		const f = raw.replace(/\\+/g, "/");
		const i = f.lastIndexOf("/");
		if (i <= 0) continue;
		const dir = f.substring(0, i);
		counts.set(dir, (counts.get(dir) ?? 0) + 1);
	}
	return [...counts.entries()]
		.filter(([, c]) => c >= threshold)
		.map(([d]) => d)
		.sort();
}
