// Copy for LLM (SPEC §6): a PDF's text and comments as text an AI agent can fully understand,
// with nothing left implicit. Same notation as the Docs plugin (⟦cN⟧…⟦/cN⟧ milestones,
// <comments> with reply-to, dates, status, priority), adapted to PDFs: text comes in <page>
// blocks or, by default, only the commented passages with some context. Pure TypeScript.

import { compareAnchors, type Anchor } from './anchor';
import { commentsInTimeOrder, threadPriority } from './shared/model';
import { threadAnchor, type PdfThread, type PdfThreads } from './sidecar';
import { formatDate } from './digest';

export type ExportScope = 'context' | 'commented-pages' | 'range' | 'all';
export type ExportMode = 'full' | 'comments' | 'text';

export interface PdfExportOptions {
	title: string;
	/** Vault path of the PDF. */
	source: string;
	totalPages: number;
	scope: ExportScope;
	/** For scope 'range': first and last page (1-based, inclusive). */
	range?: [number, number];
	includeResolved?: boolean;
	mode?: ExportMode;
	/** Characters of context around a commented passage (scope 'context'); default 400. */
	contextChars?: number;
	/** Page-text offset where an area comment's marker goes, per thread id (default: page start). */
	areaOffsets?: Record<string, number>;
	formatDate?: (iso: string) => string;
}

export interface ExportStats {
	threads: number;
	resolvedOmitted: number;
	pages: number[];
	words: number;
}

export interface PdfExportResult {
	text: string;
	stats: ExportStats;
}

interface Numbered {
	n: number;
	id: string;
	thread: PdfThread;
	anchor: Anchor | null;
}

/** A marker at a page-text offset. Closings sort before openings at the same place. */
interface Mark {
	page: number;
	offset: number;
	text: string;
	close: boolean;
}

export function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeBody(s: string): string {
	return s.replace(/<\/(comment|thread|comments|anchor|page|passage|document)/gi, '<\\/$1');
}

/** PDF line breaks are layout: words split at a line end are joined, lines become one text. */
export function unwrap(s: string): string {
	return s
		.replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
		.replace(/[ \t]*\n[ \t]*/g, ' ')
		.replace(/ {2,}/g, ' ')
		.trim();
}

/** Threads to export, numbered c1, c2… in reading order (anchored first, then detached). */
function numberThreads(threads: PdfThreads, includeResolved: boolean): { list: Numbered[]; resolvedOmitted: number } {
	const anchored: Numbered[] = [];
	const detached: Numbered[] = [];
	let resolvedOmitted = 0;
	for (const [id, t] of Object.entries(threads)) {
		if (t.resolved && !includeResolved) {
			resolvedOmitted++;
			continue;
		}
		const a = threadAnchor(t);
		if (a && !t.detached) anchored.push({ n: 0, id, thread: t, anchor: a });
		else detached.push({ n: 0, id, thread: t, anchor: null });
	}
	anchored.sort((x, y) => compareAnchors(x.anchor!, y.anchor!));
	detached.sort((x, y) => x.thread.created.localeCompare(y.thread.created));
	const list = [...anchored, ...detached];
	list.forEach((x, i) => (x.n = i + 1));
	return { list, resolvedOmitted };
}

function marksOf(list: Numbered[], areaOffsets: Record<string, number>): Mark[] {
	const out: Mark[] = [];
	for (const x of list) {
		const a = x.anchor;
		if (!a) continue;
		const first = a.segments[0]!;
		const last = a.segments[a.segments.length - 1]!;
		if (a.area) {
			out.push({ page: first.page, offset: areaOffsets[x.id] ?? 0, text: `⟦c${x.n}: area on page ${first.page}⟧`, close: false });
			continue;
		}
		out.push({ page: first.page, offset: first.start ?? 0, text: `⟦c${x.n}⟧`, close: false });
		out.push({ page: last.page, offset: last.end ?? 0, text: `⟦/c${x.n}⟧`, close: true });
	}
	return out;
}

/** Pages whose text an export with these options needs (so the caller loads only those). */
export function pagesNeeded(threads: PdfThreads, o: Pick<PdfExportOptions, 'scope' | 'range' | 'totalPages' | 'includeResolved' | 'mode'>): number[] {
	if (o.mode === 'comments') return [];
	if (o.scope === 'all') return Array.from({ length: o.totalPages }, (_, i) => i + 1);
	if (o.scope === 'range') {
		const [a, b] = clampRange(o.range, o.totalPages);
		return Array.from({ length: b - a + 1 }, (_, i) => a + i);
	}
	const pages = new Set<number>();
	for (const x of numberThreads(threads, o.includeResolved === true).list) for (const s of x.anchor?.segments ?? []) pages.add(s.page);
	return [...pages].sort((a, b) => a - b);
}

function clampRange(range: [number, number] | undefined, total: number): [number, number] {
	const a = Math.min(Math.max(1, Math.round(range?.[0] ?? 1)), total);
	const b = Math.min(Math.max(a, Math.round(range?.[1] ?? total)), total);
	return [a, b];
}

/** Text of [from, to) of a page with the markers inside that range inserted. */
function withMarks(text: string, from: number, to: number, marks: Mark[]): string {
	const inside = marks.filter((m) => m.offset >= from && m.offset <= to).sort((a, b) => a.offset - b.offset || Number(b.close) - Number(a.close));
	let out = '';
	let pos = from;
	for (const m of inside) {
		out += text.slice(pos, m.offset) + m.text;
		pos = m.offset;
	}
	return out + text.slice(pos, to);
}

const SENTENCE_END = /[.!?…]["'’”)\]]?\s/g;

/** A window of context around [start, end): about `chars` on each side, cut at sentence ends where possible. */
function contextWindow(text: string, start: number, end: number, chars: number): [number, number] {
	let a = Math.max(0, start - chars);
	if (a > 0) {
		SENTENCE_END.lastIndex = a;
		const m = SENTENCE_END.exec(text);
		if (m && m.index + m[0].length <= start) a = m.index + m[0].length;
	}
	let b = Math.min(text.length, end + chars);
	if (b < text.length) {
		let lastEnd = -1;
		SENTENCE_END.lastIndex = end;
		for (let m = SENTENCE_END.exec(text); m && m.index < b; m = SENTENCE_END.exec(text)) lastEnd = m.index + m[0].length - 1;
		if (lastEnd > end) b = lastEnd;
	}
	return [a, b];
}

export function exportPdfForLLM(threads: PdfThreads, pageText: (page: number) => string | undefined, o: PdfExportOptions): PdfExportResult {
	const mode = o.mode ?? 'full';
	const fmt = o.formatDate ?? formatDate;
	const { list, resolvedOmitted } = numberThreads(threads, o.includeResolved === true);
	const marks = mode === 'text' ? [] : marksOf(list, o.areaOffsets ?? {});
	const pages = pagesNeeded(threads, o);
	const textBlocks: string[] = [];

	if (mode !== 'comments') {
		for (const p of pages) {
			const text = pageText(p);
			if (text === undefined) continue;
			const pageMarks = marks.filter((m) => m.page === p);
			if (o.scope !== 'context') {
				textBlocks.push(`<page n="${p}">\n${escapeBody(unwrap(withMarks(text, 0, text.length, pageMarks)))}\n</page>`);
				continue;
			}
			// Commented passages with context: one window per segment on this page, overlaps merged.
			const windows: [number, number][] = [];
			for (const x of list) {
				for (const s of x.anchor?.segments ?? []) {
					if (s.page !== p) continue;
					const [from, to] = x.anchor!.area ? [o.areaOffsets?.[x.id] ?? 0, o.areaOffsets?.[x.id] ?? 0] : [s.start ?? 0, s.end ?? 0];
					windows.push(contextWindow(text, from, to, o.contextChars ?? 400));
				}
			}
			windows.sort((a, b) => a[0] - b[0]);
			const merged: [number, number][] = [];
			for (const w of windows) {
				const last = merged[merged.length - 1];
				if (last && w[0] <= last[1] + 1) last[1] = Math.max(last[1], w[1]);
				else merged.push([...w]);
			}
			for (const [a, b] of merged) {
				const body = unwrap(withMarks(text, a, b, pageMarks));
				textBlocks.push(`<passage page="${p}">\n${a > 0 ? '… ' : ''}${escapeBody(body)}${b < text.length ? ' …' : ''}\n</passage>`);
			}
		}
	}

	// Threads.
	const commentLines: string[] = [];
	let hasPriority = false;
	let detachedCount = 0;
	if (mode !== 'text') {
		for (const x of list) {
			const t = x.thread;
			const attrs = [`id="c${x.n}"`, `status="${t.resolved ? 'resolved' : 'open'}"`];
			const prio = threadPriority(t);
			if (prio !== 'normal') {
				attrs.push(`priority="${prio}"`);
				hasPriority = true;
			}
			const a = x.anchor ?? threadAnchor(t);
			if (a) {
				const first = a.segments[0]!.page;
				const last = a.segments[a.segments.length - 1]!.page;
				attrs.push(first === last ? `page="${first}"` : `pages="${first}-${last}"`);
			}
			if (!x.anchor) {
				attrs.push('detached="true"');
				detachedCount++;
			}
			const quote = a?.area ? `[area on page ${a.segments[0]!.page}]` : unwrap(t.quote);
			const multiline = quote.length > 200;
			if (!multiline) attrs.push(`anchor="${escapeAttr(quote)}"`);
			commentLines.push(`<thread ${attrs.join(' ')}>`);
			if (multiline) commentLines.push(`  <anchor>${escapeBody(quote)}</anchor>`);
			const ordered = commentsInTimeOrder(t);
			const index = new Map(ordered.map((c, i) => [c.id, i + 1]));
			ordered.forEach((c, i) => {
				const cattrs = [`id="c${x.n}.${i + 1}"`];
				const prev = i > 0 ? ordered[i - 1] : undefined;
				if (c.parent !== null && index.has(c.parent) && (!prev || prev.id !== c.parent)) cattrs.push(`reply-to="c${x.n}.${index.get(c.parent)}"`);
				if (c.created) cattrs.push(`date="${escapeAttr(fmt(c.created))}"`);
				if (c.edited) cattrs.push(`edited="${escapeAttr(fmt(c.edited))}"`);
				commentLines.push(`  <comment ${cattrs.join(' ')}>${escapeBody(c.body)}</comment>`);
			});
			commentLines.push('</thread>');
		}
	}

	// Notation.
	const notation: string[] = [];
	const scopeText = describeScope(o, pages);
	if (mode !== 'comments') {
		notation.push(`The text was extracted from a PDF (${o.totalPages} pages): line breaks were joined, and headers, footnotes, columns and hyphenation may not come out perfectly.`);
		if (o.scope === 'context') notation.push('Only the commented passages are included, each with some text around it: <passage page="N"> is an excerpt of page N; "…" marks where the excerpt was cut.');
		else notation.push('<page n="N"> holds the text of page N. ' + (o.scope === 'all' ? 'All pages are included.' : 'Only some pages are included (see scope).'));
	}
	if (mode === 'full' && list.length) {
		notation.push('⟦cN⟧…⟦/cN⟧ marks the exact text that comment thread cN refers to. Ranges may overlap, nest, or continue on the next page.');
		if (marks.some((m) => m.text.includes(': area'))) notation.push('⟦cN: area on page P⟧ marks a comment on a region of the page (a figure, a formula), placed at about the height of that region.');
	}
	if (mode !== 'text' && list.length) {
		notation.push(
			mode === 'comments'
				? 'Each thread quotes the text it refers to in its anchor, and gives its page. Inside a thread, comments are in time order; reply-to names the earlier comment being answered when it is not the one directly above.'
				: 'Threads follow the document. Inside a thread, comments are in time order; reply-to names the earlier comment being answered when it is not the one directly above.',
		);
		notation.push('status is open or resolved.' + (detachedCount ? ' detached="true" means the commented passage was not found in the current version of the PDF; the anchor is the last known quote.' : ''));
		if (hasPriority) notation.push('priority is how important the author rated a thread: low, high or critical. Threads without it are of normal priority.');
	}
	const notationBlock = notation.length ? `<notation>\n${notation.join('\n')}\n</notation>\n` : '';
	const head = `title="${escapeAttr(o.title)}" source="${escapeAttr(o.source)}" pages="${o.totalPages}"`;

	const parts: string[] = [];
	if (mode === 'comments') parts.push(`${notationBlock}<comments document="${escapeAttr(o.title)}" source="${escapeAttr(o.source)}">\n${commentLines.join('\n')}\n</comments>`);
	else {
		parts.push(`<document ${head} scope="${escapeAttr(scopeText)}">\n${notationBlock}\n${textBlocks.join('\n\n')}\n</document>`);
		if (commentLines.length) parts.push(`<comments>\n${commentLines.join('\n')}\n</comments>`);
	}
	const text = parts.join('\n\n') + '\n';
	const words = textBlocks.join(' ').replace(/<[^>]+>|⟦[^⟧]*⟧/g, ' ').split(/\s+/).filter(Boolean).length;
	return { text, stats: { threads: list.length, resolvedOmitted, pages: mode === 'comments' ? [] : pages, words } };
}

function describeScope(o: PdfExportOptions, pages: number[]): string {
	switch (o.scope) {
		case 'all':
			return 'whole document';
		case 'range': {
			const [a, b] = clampRange(o.range, o.totalPages);
			return a === b ? `page ${a}` : `pages ${a}–${b}`;
		}
		case 'commented-pages':
			return pages.length ? `pages with comments: ${pages.join(', ')}` : 'pages with comments (none)';
		default:
			return 'commented passages with context';
	}
}

export function exportSummary(s: ExportStats, mode: ExportMode): string {
	const parts: string[] = [];
	if (mode !== 'text') parts.push(`${s.threads} thread${s.threads === 1 ? '' : 's'}`);
	if (mode !== 'comments') parts.push(`${s.pages.length} page${s.pages.length === 1 ? '' : 's'}`, `${s.words.toLocaleString('en')} words`);
	let out = `Copied: ${parts.join(', ')}`;
	if (s.resolvedOmitted && mode !== 'text') out += ` (${s.resolvedOmitted} resolved omitted)`;
	return out;
}

/** Where an area comment's marker goes in the page text: before the first line below the area's top. */
export function areaTextOffset(items: readonly { str: string; transform: number[] }[], starts: readonly number[], top: number): number {
	for (let i = 0; i < items.length; i++) {
		const it = items[i]!;
		if (it.str.trim() && (it.transform[5] ?? Infinity) < top) return starts[i] ?? 0;
	}
	return starts.length ? (starts[starts.length - 1] ?? 0) : 0;
}
