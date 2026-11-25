// Re-anchoring a note's threads when its PDF changed (SPEC §5.3). Pure TypeScript.
//
// Called when the PDF's fingerprint differs from the one in the note. For each text thread the
// quote is looked for in the new page texts (quote.ts); when found, its segments, rectangles
// (from the text items' geometry) and context are recomputed and `detached` cleared; when not,
// the old anchor is kept and the thread marked `detached`. Area threads keep their rectangles
// and get `pdfChanged: true` on their anchor, so the UI can say the area may have moved.

import { contextOf, rectsFromItems, roundRect, segmentsText, type Anchor, type Segment, type TextItemGeom } from './anchor';
import type { PageText } from './pageText';
import { reanchorText } from './quote';
import { threadAnchor, type PdfThread, type PdfThreads } from './sidecar';

export interface PageData {
	text: PageText;
	items: readonly TextItemGeom[];
}

export interface ReanchorResult {
	threads: PdfThreads;
	/** Threads whose anchor moved (re-found at other offsets or pages). */
	moved: string[];
	/** Threads not found in the new PDF. */
	detached: string[];
}

/** `pages[0]` is page 1. Threads without a valid anchor are left as they are. */
export function reanchorThreads(threads: PdfThreads, pages: readonly PageData[]): ReanchorResult {
	const texts = pages.map((p) => p.text.text);
	const pageText = (page: number) => texts[page - 1];
	const out: PdfThreads = {};
	const moved: string[] = [];
	const detached: string[] = [];
	for (const [id, t] of Object.entries(threads)) {
		const a = threadAnchor(t);
		if (!a) {
			out[id] = t;
			continue;
		}
		if (a.area) {
			out[id] = { ...t, anchor: { ...a, pdfChanged: true } };
			continue;
		}
		const found = reanchorText(a, t.quote, texts);
		if (!found) {
			out[id] = { ...t, detached: true };
			detached.push(id);
			continue;
		}
		const segments: Segment[] = found.map((f) => ({
			page: f.page,
			start: f.start,
			end: f.end,
			rects: rectsFromItems(pages[f.page - 1]!.items, pages[f.page - 1]!.text, f.start, f.end).map((r) => roundRect(r)),
		}));
		const anchor: Anchor = { ...a, segments, ...contextOf(segments, pageText) };
		const next: PdfThread = { ...t, anchor, quote: segmentsText(segments, pageText) ?? t.quote };
		delete next.detached;
		const same = a.segments.length === segments.length && a.segments.every((s, i) => s.page === segments[i]!.page && s.start === segments[i]!.start && s.end === segments[i]!.end);
		if (!same) moved.push(id);
		out[id] = next;
	}
	return { threads: out, moved, detached };
}
