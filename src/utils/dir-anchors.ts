// Repo-relative POSIX paths. Strip trailing slashes, normalize "." → "" (root),
// keep "" out of stored anchors (meaningless to anchor at the repo root).
export function normalizeDirAnchor(input: string): string {
	let v = input.trim();
	if (v === "" || v === ".") return "";
	v = v.replace(/\\+/g, "/");
	v = v.replace(/\/+$/, "");
	if (v === ".") return "";
	return v;
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
