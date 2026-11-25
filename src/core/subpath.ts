// PDF link subpaths (SPEC §3.2, DECISIONS D0.5). Pure TypeScript.
//
// Obsidian's own format: `#page=N` and `#page=N&selection=a,b,c,d`, where the
// selection is (start text-item index, offset in it, end text-item index,
// offset in it). Ours adds `&comment=ID`. Unknown parameters are ignored.

export interface TextSelectionRef {
	beginIndex: number;
	beginOffset: number;
	endIndex: number;
	endOffset: number;
}

export interface PdfSubpath {
	/** 1-based page number. */
	page?: number;
	selection?: TextSelectionRef;
	comment?: string;
}

const isNat = (n: number) => Number.isInteger(n) && n >= 0;

export function parsePdfSubpath(subpath: string | null | undefined): PdfSubpath {
	if (!subpath) return {};
	const params = new URLSearchParams(subpath.replace(/^#/, ''));
	const out: PdfSubpath = {};
	const page = Number(params.get('page'));
	if (params.has('page') && Number.isInteger(page) && page >= 1) out.page = page;
	const sel = params.get('selection');
	if (sel !== null && out.page !== undefined) {
		const parts = sel.split(',').map((s) => (s.trim() === '' ? NaN : Number(s.trim())));
		if (parts.length === 4 && parts.every(isNat)) {
			const [beginIndex, beginOffset, endIndex, endOffset] = parts as [number, number, number, number];
			out.selection = { beginIndex, beginOffset, endIndex, endOffset };
		}
	}
	const comment = params.get('comment');
	if (comment && /^[a-z0-9]+$/i.test(comment)) out.comment = comment;
	return out;
}

/** `#page=3&selection=1,2,3,4&comment=k3f9` (parts that are absent are left out; '' if nothing). */
export function formatPdfSubpath(s: PdfSubpath): string {
	const parts: string[] = [];
	if (s.page !== undefined) parts.push(`page=${s.page}`);
	if (s.page !== undefined && s.selection) {
		const { beginIndex, beginOffset, endIndex, endOffset } = s.selection;
		parts.push(`selection=${beginIndex},${beginOffset},${endIndex},${endOffset}`);
	}
	if (s.comment) parts.push(`comment=${s.comment}`);
	return parts.length ? '#' + parts.join('&') : '';
}
