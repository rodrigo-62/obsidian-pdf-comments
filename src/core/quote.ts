// Finding a quote again in a PDF whose text changed (re-anchoring, SPEC §5.3). Pure TypeScript.
//
// Text is compared in a normalised form that ignores what layout changes: whitespace and line
// breaks are left out altogether (PDF text often splits a hyphenated word as "improve\nment"
// with no hyphen at all, and spacing differs between versions), a hyphen at a line end between
// letters is dropped, soft hyphens are dropped, ligatures and other compatibility characters
// are unfolded (NFKC), and typographic quotes and dashes count as plain ones. Every normalised
// character remembers where it came from, so a match maps back to exact page-text offsets.
// Repeated passages are told apart by the text before and after the quote (prefix, suffix).

export interface NormText {
	norm: string;
	/** For each normalised character: the [start, end) of the original text it came from. */
	from: number[];
	to: number[];
}

const FOLD: Record<string, string> = {
	'‘': "'",
	'’': "'",
	'‚': "'",
	'‛': "'",
	'′': "'",
	'“': '"',
	'”': '"',
	'„': '"',
	'‟': '"',
	'″': '"',
	'‐': '-',
	'‑': '-',
	'‒': '-',
	'–': '-',
	'—': '-',
	'−': '-',
};

const isSpace = (ch: string) => /\s/.test(ch);
const isLetter = (ch: string | undefined) => !!ch && /\p{L}/u.test(ch);

export function normalizeForSearch(s: string, caseInsensitive = false): NormText {
	const norm: string[] = [];
	const from: number[] = [];
	const to: number[] = [];
	const push = (text: string, a: number, b: number) => {
		for (const ch of text) {
			norm.push(ch);
			from.push(a);
			to.push(b);
		}
	};
	let i = 0;
	while (i < s.length) {
		const cp = s.codePointAt(i)!;
		const ch = String.fromCodePoint(cp);
		const w = ch.length;
		if (ch === '­') {
			i += w;
			continue;
		}
		if (isSpace(ch)) {
			i += w;
			continue;
		}
		// A hyphen at a line end between letters: drop it and the line break ("in-\ncididunt").
		if ((ch === '-' || ch === '‐') && s[i + 1] === '\n' && isLetter(norm[norm.length - 1]) && isLetter(s[i + 2])) {
			i += 2;
			continue;
		}
		let out = FOLD[ch] ?? ch.normalize('NFKC');
		if (caseInsensitive) out = out.toLowerCase();
		push(out, i, i + w);
		i += w;
	}
	return { norm: norm.join(''), from, to };
}

export interface QuoteSelector {
	quote: string;
	prefix?: string;
	suffix?: string;
}

export interface FoundSegment {
	page: number;
	start: number;
	end: number;
}

/** Most occurrences looked at before giving up on finding the best one. */
const MAX_CANDIDATES = 2000;

/** All pages as one normalised string, with each character's page and source range. */
class SearchIndex {
	readonly all: string;
	private page: number[] = [];
	private src: [number, number][] = [];

	constructor(
		pages: readonly string[],
		readonly caseInsensitive: boolean,
	) {
		let all = '';
		pages.forEach((text, p) => {
			const n = normalizeForSearch(text, caseInsensitive);
			all += n.norm;
			for (let k = 0; k < n.norm.length; k++) {
				this.page.push(p + 1);
				this.src.push([n.from[k]!, n.to[k]!]);
			}
		});
		this.all = all;
	}

	private norm(s: string | undefined): string {
		return normalizeForSearch(s ?? '', this.caseInsensitive).norm;
	}

	/**
	 * The best occurrence of `quote` at or after `minAt`: most matching context, then nearest to
	 * `hintPage`, then first. Positions are in the normalised string.
	 */
	find(quote: string, prefix: string | undefined, suffix: string | undefined, hintPage: number, minAt = 0): { at: number; end: number } | null {
		const q = this.norm(quote);
		if (!q) return null;
		const pre = this.norm(prefix);
		const suf = this.norm(suffix);
		let best: { at: number; score: number; dist: number } | null = null;
		let count = 0;
		for (let at = this.all.indexOf(q, minAt); at !== -1 && count < MAX_CANDIDATES; at = this.all.indexOf(q, at + 1), count++) {
			const score = matchBackward(this.all, at, pre) + matchForward(this.all, at + q.length, suf);
			const dist = Math.abs(this.page[at]! - hintPage);
			if (!best || score > best.score || (score === best.score && dist < best.dist)) best = { at, score, dist };
		}
		return best ? { at: best.at, end: best.at + q.length } : null;
	}

	/** Page-text ranges of normalised positions [start, end), one per page. */
	segments(start: number, end: number): FoundSegment[] {
		const out: FoundSegment[] = [];
		for (let k = start; k < end; k++) {
			const p = this.page[k]!;
			const [a, b] = this.src[k]!;
			const last = out[out.length - 1];
			if (last && last.page === p) {
				last.start = Math.min(last.start, a);
				last.end = Math.max(last.end, b);
			} else out.push({ page: p, start: a, end: b });
		}
		return out;
	}
}

/**
 * Where `sel.quote` is in the pages (pages[0] is page 1), as one segment per page it covers.
 * When it occurs several times, the one whose surroundings best match `prefix` and `suffix`
 * wins, then the one nearest to `hintPage`. Exact (normalised) matches are preferred; if
 * there are none, case is ignored. Null if the quote is not found.
 */
export function findQuote(pages: readonly string[], sel: QuoteSelector, hintPage = 1): FoundSegment[] | null {
	for (const ci of [false, true]) {
		const idx = new SearchIndex(pages, ci);
		const r = idx.find(sel.quote, sel.prefix, sel.suffix, hintPage);
		if (r) return idx.segments(r.at, r.end);
	}
	return null;
}

/** What re-anchoring needs from a stored text anchor. */
export interface StoredTextAnchor {
	segments: readonly { page: number; start?: number; end?: number }[];
	prefix?: string;
	suffix?: string;
}

/**
 * Finds a text anchor's quote in (new) page texts. First the whole quote; if that fails and the
 * anchor spans pages, each page's part in order (the stored offsets give the parts' lengths), so
 * a footnote or page number that came between the parts doesn't matter. Null if not found.
 */
export function reanchorText(anchor: StoredTextAnchor, quote: string, pages: readonly string[]): FoundSegment[] | null {
	const hint = anchor.segments[0]?.page ?? 1;
	const whole = findQuote(pages, { quote, prefix: anchor.prefix, suffix: anchor.suffix }, hint);
	if (whole) return whole;
	const parts = splitQuote(anchor, quote);
	if (!parts || parts.length < 2) return null;
	for (const ci of [false, true]) {
		const idx = new SearchIndex(pages, ci);
		const found: FoundSegment[] = [];
		let minAt = 0;
		let ok = true;
		for (let i = 0; i < parts.length; i++) {
			const r = idx.find(parts[i]!, i === 0 ? anchor.prefix : undefined, i === parts.length - 1 ? anchor.suffix : undefined, i === 0 ? hint : (found[found.length - 1]?.page ?? hint), minAt);
			if (!r) {
				ok = false;
				break;
			}
			for (const seg of idx.segments(r.at, r.end)) {
				const last = found[found.length - 1];
				if (last && last.page === seg.page) {
					last.start = Math.min(last.start, seg.start);
					last.end = Math.max(last.end, seg.end);
				} else found.push(seg);
			}
			minAt = r.end;
		}
		if (ok) return found;
	}
	return null;
}

/** The quote cut into the segments' texts (quote = parts joined by "\n", as segmentsText builds it). */
function splitQuote(anchor: StoredTextAnchor, quote: string): string[] | null {
	const lens = anchor.segments.map((s) => (s.start !== undefined && s.end !== undefined ? s.end - s.start : -1));
	if (lens.some((l) => l < 0) || lens.reduce((a, b) => a + b, 0) + lens.length - 1 !== quote.length) return null;
	const parts: string[] = [];
	let pos = 0;
	for (const l of lens) {
		parts.push(quote.slice(pos, pos + l));
		pos += l + 1;
	}
	return parts;
}

/** How many characters just before `at` match the end of `prefix`. */
function matchBackward(all: string, at: number, prefix: string): number {
	let n = 0;
	while (n < prefix.length && at - 1 - n >= 0 && all[at - 1 - n] === prefix[prefix.length - 1 - n]) n++;
	return n;
}

/** How many characters from `at` on match the start of `suffix`. */
function matchForward(all: string, at: number, suffix: string): number {
	let n = 0;
	while (n < suffix.length && at + n < all.length && all[at + n] === suffix[n]) n++;
	return n;
}

/** True if the text at the stored offsets is still the quote (whitespace and layout differences ignored). */
export function quoteStillMatches(quote: string, actual: string | null): boolean {
	if (actual === null) return false;
	return normalizeForSearch(quote).norm === normalizeForSearch(actual).norm;
}
