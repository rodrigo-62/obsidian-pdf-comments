// Where a PDF's comment note lives (SPEC §5.1). Pure TypeScript.
//
// One note per PDF in one folder (default "PDF comments"), named after the PDF:
// "Papers/Smith 2021.pdf" → "PDF comments/Smith 2021.md". If that name is taken by another
// PDF's note, the PDF's folder is added ("Smith 2021 (Papers-old).md"), then a number.
// The note is tied to its PDF by its `pdf` property, never by its name.

export const DEFAULT_FOLDER = 'PDF comments';

/** "Papers//old/" → "Papers/old"; "/" or "" → "" (the vault root). */
export function normalizeFolder(folder: string): string {
	return folder
		.split('/')
		.map((p) => p.trim())
		.filter((p) => p && p !== '.' && p !== '..')
		.join('/');
}

/** Characters that break wikilinks or file names on some systems become spaces. */
function cleanName(s: string): string {
	return s
		.replace(/[\\/:*?"<>|#^[\]]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function join(folder: string, name: string): string {
	return folder ? `${folder}/${name}` : name;
}

/**
 * The note path for a PDF. `isTaken(path)` must say whether a file exists at `path` that is
 * not already this PDF's note.
 */
export function sidecarPathFor(pdfPath: string, folder: string, isTaken: (path: string) => boolean): string {
	const dir = normalizeFolder(folder);
	const parts = pdfPath.split('/');
	const file = parts.pop() ?? pdfPath;
	const base = cleanName(file.replace(/\.pdf$/i, '')) || 'PDF';
	const where = cleanName(parts.join('-')) || 'vault';
	const first = join(dir, `${base}.md`);
	if (!isTaken(first)) return first;
	const second = join(dir, `${base} (${where}).md`);
	if (!isTaken(second)) return second;
	for (let n = 2; ; n++) {
		const p = join(dir, `${base} (${where}) (${n}).md`);
		if (!isTaken(p)) return p;
	}
}
