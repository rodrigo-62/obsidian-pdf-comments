import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPageText, itemsInRange, itemToOffset, offsetToItem, type PageText } from '../src/core/pageText';
import {
	anchorStart,
	applyInverseTransform,
	applyTransform,
	compareAnchors,
	contextOf,
	cssRectToPdf,
	mergeLineRects,
	pdfRectToCss,
	rectsFromItems,
	segmentsText,
	validAnchor,
	type Anchor,
	type Rect,
	type TextItemGeom,
	type Transform,
} from '../src/core/anchor';
import { findQuote, normalizeForSearch, quoteStillMatches, reanchorText } from '../src/core/quote';
import { buildSidecar, findThreadBlock, parsePdfLink, parseSidecar, serializeThreadJson, sidecarBody, threadAnchor, type PdfThreads } from '../src/core/sidecar';
import { renderDigest } from '../src/core/digest';
import { normalizeFolder, sidecarPathFor } from '../src/core/sidecarName';
import { reanchorThreads, type PageData } from '../src/core/reanchor';

// ---- Fixtures: real PDF.js text items of the test PDFs (scripts/extract-text-fixture.mjs) ----

interface Fixture {
	fingerprint: string;
	pages: { view: number[]; items: TextItemGeom[] }[];
}
const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Fixture;
const v1 = load('lighthouses-v1');
const v2 = load('lighthouses-v2');
const twoCol = load('two-column');
const pageTexts = (f: Fixture): PageText[] => f.pages.map((p) => buildPageText(p.items));
const pt1 = pageTexts(v1);
const pt2 = pageTexts(v2);
const texts1 = pt1.map((p) => p.text);
const texts2 = pt2.map((p) => p.text);
const textOf = (texts: string[]) => (page: number) => texts[page - 1];

/** A text anchor for the first occurrence of `quote` on `page` (as the UI would create it). */
function anchorFor(texts: string[], page: number, quote: string): { anchor: Anchor; quote: string } {
	const start = texts[page - 1]!.indexOf(quote);
	if (start < 0) throw new Error(`not on page ${page}: ${quote}`);
	const segments = [{ page, start, end: start + quote.length, rects: [] as Rect[] }];
	return { anchor: { segments, ...contextOf(segments, textOf(texts)) }, quote };
}

// ---- pageText ---------------------------------------------------------------

describe('pageText', () => {
	const items = [{ str: 'Hello ', hasEOL: false }, { str: 'world', hasEOL: true }, { str: '', hasEOL: true }, { str: 'Next line' }];
	const pt = buildPageText(items);

	it('joins items with a line break after hasEOL items', () => {
		expect(pt.text).toBe('Hello world\n\nNext line');
		expect(pt.starts).toEqual([0, 6, 12, 13]);
	});
	it('maps item positions to offsets (clamped) and back', () => {
		expect(itemToOffset(pt, 1, 2)).toBe(8);
		expect(itemToOffset(pt, 1, 99)).toBe(11);
		expect(itemToOffset(pt, 9, 0)).toBeNull();
		expect(offsetToItem(pt, 8, 'start')).toEqual({ index: 1, offset: 2 });
		expect(offsetToItem(pt, 8, 'end')).toEqual({ index: 1, offset: 2 });
	});
	it('moves offsets between items to a neighbouring item with text', () => {
		// 11 = the line break after "world"; 12 = the empty item's line break.
		expect(offsetToItem(pt, 11, 'start')).toEqual({ index: 3, offset: 0 });
		expect(offsetToItem(pt, 12, 'start')).toEqual({ index: 3, offset: 0 });
		expect(offsetToItem(pt, 11, 'end')).toEqual({ index: 1, offset: 5 });
		expect(offsetToItem(pt, 13, 'end')).toEqual({ index: 1, offset: 5 });
		expect(offsetToItem(pt, 6, 'end')).toEqual({ index: 0, offset: 6 });
		expect(offsetToItem(pt, 22, 'start')).toBeNull();
		expect(offsetToItem(pt, 0, 'end')).toBeNull();
	});
	it('lists the items in a range', () => {
		expect(itemsInRange(pt, 3, 15)).toEqual([
			{ index: 0, from: 3, to: 6 },
			{ index: 1, from: 0, to: 5 },
			{ index: 3, from: 0, to: 2 },
		]);
	});
	it("matches Obsidian's selection= indices on a real page (selection=5,2,11,5 on page 2)", () => {
		const p = pt1[1]!;
		expect(v1.pages[1]!.items[5]!.str).toBe('A light that cannot be told apart from the others is almost worse');
		const start = itemToOffset(p, 5, 2)!;
		const end = itemToOffset(p, 11, 5)!;
		// What Obsidian's own viewer selected for that link (checked in the harness, RESEARCH §2).
		expect(p.text.slice(start, end)).toBe('light that cannot be told apart from the others is almost worse\nthan no light.\n— an old harbour saying\nThe s');
		expect(offsetToItem(p, start, 'start')).toEqual({ index: 5, offset: 2 });
		expect(offsetToItem(p, end, 'end')).toEqual({ index: 11, offset: 5 });
	});
});

// ---- anchor geometry ----------------------------------------------------------

describe('anchor', () => {
	it('validates stored anchors', () => {
		expect(validAnchor({ segments: [{ page: 2, start: 1, end: 5, rects: [[1, 2, 3, 4]] }] })).not.toBeNull();
		expect(validAnchor({ segments: [{ page: 2, rects: [[1, 2, 3, 4]] }], area: true })).not.toBeNull();
		expect(validAnchor({ segments: [{ page: 2, rects: [] }], area: true })).toBeNull();
		expect(validAnchor({ segments: [{ page: 2, rects: [[1, 2, 3, 4]] }] })).toBeNull(); // text segment without offsets
		expect(validAnchor({ segments: [{ page: 0, start: 1, end: 2, rects: [] }] })).toBeNull();
		expect(validAnchor({ segments: [{ page: 1, start: 5, end: 2, rects: [] }] })).toBeNull();
		expect(validAnchor({ segments: [] })).toBeNull();
		expect(validAnchor('x')).toBeNull();
	});

	it('merges rectangles per line, keeping reading order', () => {
		const rects: Rect[] = [
			[10, 100, 50, 110],
			[52, 100, 90, 110], // same line, small gap
			[200, 100, 240, 110], // same line, big gap: separate
			[10, 85, 60, 95], // next line
			[60, 85, 60.2, 95], // empty: dropped
		];
		expect(mergeLineRects(rects)).toEqual([
			[10, 100, 90, 110],
			[200, 100, 240, 110],
			[10, 85, 60, 95],
		]);
	});

	it('converts between page CSS pixels and PDF units (also rotated)', () => {
		// PDF.js viewport transforms for a 595×842 page at 150 %: unrotated, and rotated 90°.
		const s = 1.5;
		const straight: Transform = [s, 0, 0, -s, 0, 842 * s];
		const rotated: Transform = [0, s, s, 0, 0, 0];
		for (const t of [straight, rotated]) {
			const r: Rect = [72, 500, 300, 520];
			const css = pdfRectToCss(r, t);
			const back = cssRectToPdf(css.left, css.top, css.left + css.width, css.top + css.height, t);
			back.forEach((v, i) => expect(v).toBeCloseTo(r[i]!));
			const [x, y] = applyTransform(t, 10, 20);
			const [bx, by] = applyInverseTransform(t, x, y);
			expect(bx).toBeCloseTo(10);
			expect(by).toBeCloseTo(20);
		}
		expect(pdfRectToCss([72, 500, 300, 520], straight)).toEqual({ left: 108, top: (842 - 520) * s, width: 342, height: 30 });
	});

	it('computes highlight rectangles from text items', () => {
		const p = 2;
		const { anchor } = anchorFor(texts1, p, 'A light that cannot be told apart from the others is almost worse\nthan no light.');
		const seg = anchor.segments[0]!;
		const rects = rectsFromItems(v1.pages[p - 1]!.items, pt1[p - 1]!, seg.start!, seg.end!);
		expect(rects).toHaveLength(2); // two lines
		const [w, h] = [v1.pages[p - 1]!.view[2]!, v1.pages[p - 1]!.view[3]!];
		for (const r of rects) {
			expect(r[0]).toBeGreaterThanOrEqual(0);
			expect(r[2]).toBeLessThanOrEqual(w);
			expect(r[3]).toBeLessThanOrEqual(h);
			expect(r[3] - r[1]).toBeGreaterThan(5);
			expect(r[3] - r[1]).toBeLessThan(20);
		}
		expect(rects[0]![1]).toBeGreaterThan(rects[1]![3] - 1); // the first line is above the second
		// Part of an item: about half as wide.
		const item = v1.pages[p - 1]!.items[5]!;
		const half = rectsFromItems(v1.pages[p - 1]!.items, pt1[p - 1]!, pt1[p - 1]!.starts[5]!, pt1[p - 1]!.starts[5]! + Math.round(item.str.length / 2));
		expect(half[0]![2] - half[0]![0]).toBeCloseTo(item.width / 2, -1);
	});

	it('orders text anchors by page and text order, areas top to bottom then left to right', () => {
		const text = (page: number, top: number, left: number, start: number): Anchor => ({ segments: [{ page, start, end: start + 1, rects: [[left, top - 10, left + 5, top]] }] });
		const area = (page: number, top: number, left: number): Anchor => ({ segments: [{ page, rects: [[left, top - 10, left + 5, top]] }], area: true });
		// Two-column page: the right column's top (start 900) comes after the left column's bottom (start 400).
		const sorted = [text(2, 500, 10, 0), text(1, 700, 300, 900), text(1, 200, 40, 400), text(1, 700, 40, 50)].sort(compareAnchors);
		expect(sorted.map((x) => [anchorStart(x).page, x.segments[0]!.start])).toEqual([
			[1, 50],
			[1, 400],
			[1, 900],
			[2, 0],
		]);
		const areas = [area(1, 300, 10), area(1, 700, 300), area(1, 700, 40)].sort(compareAnchors);
		expect(areas.map((x) => [anchorStart(x).top, anchorStart(x).left])).toEqual([
			[700, 40],
			[700, 300],
			[300, 10],
		]);
	});

	it('gives the text and context of segments, across a page break', () => {
		const end1 = texts1[0]!.lastIndexOf('The improve') + 'The improve'.length;
		const segs = [
			{ page: 1, start: texts1[0]!.lastIndexOf('The improve'), end: end1, rects: [] },
			{ page: 2, start: 0, end: 'ment was real but small'.length, rects: [] },
		];
		expect(segmentsText(segs, textOf(texts1))).toBe('The improve\nment was real but small');
		const ctx = contextOf(segs, textOf(texts1), 20);
		expect(ctx.prefix).toBe('rror than the last. ');
		expect(ctx.suffix).toBe(', because a mirror c');
		expect(segmentsText([{ page: 9, start: 0, end: 1, rects: [] }], textOf(texts1))).toBeNull();
	});
});

// ---- quotes and re-anchoring --------------------------------------------------

describe('normalizeForSearch', () => {
	it('drops whitespace, line-end hyphens and soft hyphens; folds ligatures and typography', () => {
		const n = normalizeForSearch('The  ﬁrst\nlight’s in-\ncididunt co­operate – done');
		expect(n.norm).toBe("Thefirstlight'sincididuntcooperate-done");
		// Every character knows where it came from: the ligature's two letters both come from index 5.
		const fi = n.norm.indexOf('fi');
		expect([n.from[fi], n.to[fi], n.from[fi + 1], n.to[fi + 1]]).toEqual([5, 6, 5, 6]);
	});
	it('keeps a hyphen that is not at a line end between letters', () => {
		expect(normalizeForSearch('well-known 1-\n2').norm).toBe('well-known1-2');
	});
	it('can ignore case', () => {
		expect(normalizeForSearch('Light', true).norm).toBe('light');
	});
});

describe('findQuote', () => {
	it('finds a quote where it was', () => {
		const { anchor, quote } = anchorFor(texts1, 2, 'A light that cannot be told apart');
		expect(findQuote(texts1, { quote, prefix: anchor.prefix, suffix: anchor.suffix }, 2)).toEqual([{ page: 2, start: anchor.segments[0]!.start, end: anchor.segments[0]!.end }]);
	});

	it('re-finds quotes in the revised PDF, where the text moved to other pages and lines', () => {
		const cases: [number, string][] = [
			[1, 'a fire on a hill'],
			[2, 'A light that cannot be told apart from the others is almost worse\nthan no light.'],
			[3, 'The real change came with the stepped lens'],
			[4, 'The second was identity'],
			[5, 'here is the land, here is the danger'],
		];
		for (const [page, text] of cases) {
			const { anchor, quote } = anchorFor(texts1, page, text);
			const found = findQuote(texts2, { quote, prefix: anchor.prefix, suffix: anchor.suffix }, page);
			expect(found, text).not.toBeNull();
			const again = segmentsText(found!.map((f) => ({ ...f, rects: [] })), textOf(texts2))!;
			expect(quoteStillMatches(quote, again), `${text} → ${again}`).toBe(true);
		}
	});

	it('finds a quote that crosses a page break, as one segment per page', () => {
		// As a DOM selection from "The improve" to "ment was real but small" gives it: the rest of
		// page 1 (with its footnote and page number) and the start of page 2.
		const start = texts1[0]!.lastIndexOf('The improve');
		const segments = [
			{ page: 1, start, end: texts1[0]!.length, rects: [] },
			{ page: 2, start: 0, end: 'ment was real but small'.length, rects: [] },
		];
		const quote = segmentsText(segments, textOf(texts1))!;
		expect(quote).toContain('1Coastal fires');
		const found = findQuote(texts1, { quote, ...contextOf(segments, textOf(texts1)) }, 1);
		expect(found).toEqual([
			{ page: 1, start, end: texts1[0]!.length },
			{ page: 2, start: 0, end: 'ment was real but small'.length },
		]);
	});

	it('re-anchors a cross-page quote part by part when something came between the parts', () => {
		// The paragraph only: "The improve" (end of the text on page 1) + "ment was real but small" (page 2).
		const start = texts1[0]!.lastIndexOf('The improve');
		const segments = [
			{ page: 1, start, end: start + 'The improve'.length, rects: [] },
			{ page: 2, start: 0, end: 'ment was real but small'.length, rects: [] },
		];
		const quote = segmentsText(segments, textOf(texts1))!;
		const anchor = { segments, ...contextOf(segments, textOf(texts1)) };
		expect(findQuote(texts1, { quote }, 1)).toBeNull(); // the footnote is in between
		expect(reanchorText(anchor, quote, texts1)).toEqual([
			{ page: 1, start, end: start + 'The improve'.length },
			{ page: 2, start: 0, end: 'ment was real but small'.length },
		]);
		// In the revised PDF the paragraph is on one page: one segment.
		const moved = reanchorText(anchor, quote, texts2)!;
		expect(moved).toHaveLength(1);
		expect(quoteStillMatches(quote, segmentsText(moved.map((f) => ({ ...f, rects: [] })), textOf(texts2)))).toBe(true);
		// A quote that doesn't add up to its segments isn't split.
		expect(reanchorText(anchor, quote + 'x', texts1)).toBeNull();
	});

	it('tells repeated passages apart by their context, then by the nearest page', () => {
		const quote = 'Lorem ipsum dolor sit amet';
		const pages = texts1.map((t, i) => [i + 1, t] as const).filter(([, t]) => t.includes(quote));
		expect(pages.length).toBeGreaterThan(0);
		const all = texts1.flatMap((t, i) => [...t.matchAll(new RegExp(quote, 'g'))].map((m) => ({ page: i + 1, start: m.index })));
		expect(all.length).toBe(2);
		for (const occ of all) {
			const segs = [{ page: occ.page, start: occ.start, end: occ.start + quote.length, rects: [] }];
			const found = findQuote(texts1, { quote, ...contextOf(segs, textOf(texts1)) }, 1);
			expect(found).toEqual([{ page: occ.page, start: occ.start, end: occ.start + quote.length }]);
		}
		// Without context, the occurrence nearest to the hint page.
		const last = all[all.length - 1]!;
		expect(findQuote(texts1, { quote }, last.page)![0]!.page).toBe(last.page);
	});

	it('ignores case only when there is no exact match, and gives up when the quote is gone', () => {
		expect(findQuote(texts1, { quote: 'A LIGHT THAT CANNOT' }, 1)![0]!.page).toBe(2);
		expect(findQuote(texts1, { quote: 'this sentence is in neither version' }, 1)).toBeNull();
		expect(findQuote(texts1, { quote: '  \n ' }, 1)).toBeNull();
	});

	it('works on a two-column page', () => {
		const t = pageTexts(twoCol).map((p) => p.text);
		const q = t[0]!.slice(t[0]!.indexOf('Abstract'), t[0]!.indexOf('Abstract') + 60);
		expect(findQuote(t, { quote: q }, 1)).toEqual([{ page: 1, start: t[0]!.indexOf('Abstract'), end: t[0]!.indexOf('Abstract') + 60 }]);
	});
});

// ---- the comment note ----------------------------------------------------------

const ANCHOR: Anchor = {
	segments: [{ page: 2, start: 120, end: 160, rects: [[72.1, 540.2, 523.8, 552], [72.1, 526, 310.4, 537.8]] }],
	prefix: 'before ',
	suffix: ' after',
};
const THREADS: PdfThreads = {
	k3f9: {
		anchor: ANCHOR,
		quote: 'A light that cannot be told apart',
		created: '2026-11-25T15:41:00Z',
		resolved: false,
		priority: 'high',
		comments: [
			{ id: 'a1', parent: null, created: '2026-11-25T15:41:00Z', body: 'Is this --> the key idea?\n---\nSecond thought' },
			{ id: 'a2', parent: 'a1', created: '2026-11-25T16:02:00Z', body: 'Yes.', mood: 'sure' },
			{ id: 'a3', parent: null, created: '2026-11-25T16:30:00Z', edited: '2026-11-25T16:31:00Z', body: 'A later note' },
		],
	},
	p2xm: {
		anchor: { segments: [{ page: 4, rects: [[100, 300, 480, 620]] }], area: true, colour: 'blue' },
		quote: '',
		created: '2026-11-24T10:00:00Z',
		resolved: true,
		resolvedAt: '2026-11-25T09:00:00Z',
		comments: [{ id: 'a1', parent: null, created: '2026-11-24T10:00:00Z', body: 'The figure' }],
	},
	zz01: {
		anchor: { segments: 'broken' },
		quote: 'An old <!-- passage --> [[not a link]]',
		created: '2026-11-20T08:00:00Z',
		resolved: false,
		detached: true,
		comments: [{ id: 'a1', parent: null, created: '2026-11-20T08:00:00Z', body: 'Lost' }],
	},
};

describe('sidecar', () => {
	const digest = renderDigest('Papers/Smith 2021.pdf', THREADS);
	const md = buildSidecar(null, { pdfPath: 'Papers/Smith 2021.pdf', fingerprint: 'abc123', threads: THREADS, digest });

	it('round-trips threads, unknown fields and the properties', () => {
		const r = parseSidecar(md);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.data.pdfLink).toBe('Papers/Smith 2021.pdf');
		expect(r.data.fingerprint).toBe('abc123');
		expect(r.data.threads).toEqual(THREADS);
		expect(threadAnchor(r.data.threads.k3f9!)).toEqual(ANCHOR);
		expect(threadAnchor(r.data.threads.zz01!)).toBeNull(); // kept, but not shown
	});

	it('never lets a comment end the block early', () => {
		const block = findThreadBlock(md)!;
		expect(block.json).not.toContain('-->');
		expect(md.indexOf('-->', block.from)).toBe(block.to - 3);
		expect(md.trimEnd().endsWith('-->')).toBe(true);
	});

	it('writes readable JSON: one comment and one anchor segment per line', () => {
		expect(serializeThreadJson({ k3f9: THREADS.k3f9! })).toBe(
			[
				'{',
				'  "k3f9": {',
				'    "anchor": {',
				'      "segments": [',
				'        { "page": 2, "start": 120, "end": 160, "rects": [[72.1,540.2,523.8,552],[72.1,526,310.4,537.8]] }',
				'      ],',
				'      "prefix": "before ",',
				'      "suffix": " after"',
				'    },',
				'    "quote": "A light that cannot be told apart",',
				'    "created": "2026-11-25T15:41:00Z",',
				'    "resolved": false,',
				'    "comments": [',
				'      { "id": "a1", "parent": null, "created": "2026-11-25T15:41:00Z", "body": "Is this --\\u003e the key idea?\\n---\\nSecond thought" },',
				'      { "id": "a2", "parent": "a1", "created": "2026-11-25T16:02:00Z", "body": "Yes.", "mood": "sure" },',
				'      { "id": "a3", "parent": null, "created": "2026-11-25T16:30:00Z", "edited": "2026-11-25T16:31:00Z", "body": "A later note" }',
				'    ],',
				'    "priority": "high"',
				'  }',
				'}',
			].join('\n'),
		);
		expect(serializeThreadJson({})).toBe('{}');
	});

	it('keeps other properties and replaces its own, body regenerated', () => {
		const existing = ['---', 'tags: [reading]', 'commented-pdf: "[[Old/Name.pdf]]"', 'aliases:', '  - Smith', 'commented-pdf-fingerprint: "old"', '---', 'my edits', '', '<!--pdf-comments:threads', '{}', '-->', ''].join('\n');
		const out = buildSidecar(existing, { pdfPath: 'New/Name.pdf', fingerprint: null, threads: {}, digest: 'DIGEST' });
		expect(out).toBe(['---', 'commented-pdf: "[[New/Name.pdf]]"', 'tags: [reading]', 'aliases:', '  - Smith', '---', 'DIGEST', '', '<!--pdf-comments:threads', '{}', '-->', ''].join('\n'));
		expect(sidecarBody(out)).toBe('DIGEST');
		const r = parseSidecar(out);
		expect(r.ok && r.data.fingerprint).toBe(null);
	});

	it('refuses malformed data instead of losing it', () => {
		expect(parseSidecar('---\npdf: x\n---\n<!--pdf-comments:threads\n{ nope\n-->\n')).toMatchObject({ ok: false });
		expect(parseSidecar('<!--pdf-comments:threads\n[1, 2]\n-->')).toMatchObject({ ok: false });
		const none = parseSidecar('just text');
		expect(none.ok && none.data).toEqual({ pdfLink: null, fingerprint: null, threads: {} });
	});

	it('reads the pdf property in every common link form', () => {
		expect(parsePdfLink('[[Papers/A.pdf]]')).toBe('Papers/A.pdf');
		expect(parsePdfLink('![[A.pdf|Alias]]')).toBe('A.pdf');
		expect(parsePdfLink('[[A.pdf#page=3]]')).toBe('A.pdf');
		expect(parsePdfLink('Papers/A.pdf')).toBe('Papers/A.pdf');
		expect(parsePdfLink('')).toBeNull();
		expect(parsePdfLink(null)).toBeNull();
		const r = parseSidecar("---\ncommented-pdf: '[[It''s.pdf]]'\n---\n");
		expect(r.ok && r.data.pdfLink).toBe("It's.pdf");
	});

	it('reads notes written with the pre-0.2 names and writes the new ones', () => {
		const old = '---\npdf: "[[A.pdf]]"\npdf-fingerprint: "f1"\ntags: [x]\n---\nbody\n\n<!--pdf-comments:threads\n{}\n-->\n';
		const r = parseSidecar(old);
		expect(r.ok && r.data).toMatchObject({ pdfLink: 'A.pdf', fingerprint: 'f1' });
		expect(buildSidecar(old, { pdfPath: 'A.pdf', fingerprint: 'f1', threads: {}, digest: 'D' }).split('\n').slice(0, 5)).toEqual(['---', 'commented-pdf: "[[A.pdf]]"', 'commented-pdf-fingerprint: "f1"', 'tags: [x]', '---']);
	});
});

describe('digest', () => {
	it('groups threads by page, resolved last, detached at the end, nothing that breaks the note', () => {
		expect(renderDigest('Papers/Smith 2021.pdf', THREADS)).toBe(
			[
				'> Generated from the comments on [[Papers/Smith 2021.pdf]]. Edits here are overwritten: comment in the PDF view.',
				'',
				'## Page 2',
				'',
				'> A light that cannot be told apart',
				'',
				'[[Papers/Smith 2021.pdf#page=2&comment=k3f9|Open]] · High priority',
				'',
				'- 2026-11-25 15:41 · Is this --&gt; the key idea?',
				'  ---',
				'  Second thought',
				'  - 2026-11-25 16:02 · Yes.',
				'- 2026-11-25 16:30 (edited) · A later note',
				'',
				'## Page 4',
				'',
				'> *[area]*',
				'',
				'[[Papers/Smith 2021.pdf#page=4&comment=p2xm|Open]] · Resolved',
				'',
				'- 2026-11-24 10:00 · The figure',
				'',
				'## Detached',
				'',
				'*The passages of these comments were not found in the current version of the PDF.*',
				'',
				'> An old &lt;!-- passage --&gt; \\[\\[not a link\\]\\]',
				'',
				'[[Papers/Smith 2021.pdf#comment=zz01|Open]]',
				'',
				'- 2026-11-20 08:00 · Lost',
			].join('\n'),
		);
	});

	it('is only a header without threads', () => {
		expect(renderDigest('A.pdf', {})).toBe('> Generated from the comments on [[A.pdf]]. Edits here are overwritten: comment in the PDF view.');
	});
});

describe('sidecarName', () => {
	it('names the note after the PDF, in the folder', () => {
		expect(sidecarPathFor('Papers/Smith 2021.pdf', 'PDF comments', () => false)).toBe('PDF comments/Smith 2021.md');
		expect(sidecarPathFor('Smith.PDF', '/', () => false)).toBe('Smith.md');
	});
	it('adds the folder, then a number, when the name is taken', () => {
		const taken = new Set(['PDF comments/Smith 2021.md', 'PDF comments/Smith 2021 (Papers-old).md']);
		expect(sidecarPathFor('Papers/Smith 2021.pdf', 'PDF comments', (p) => p === 'PDF comments/Smith 2021.md')).toBe('PDF comments/Smith 2021 (Papers).md');
		expect(sidecarPathFor('Papers/old/Smith 2021.pdf', 'PDF comments', (p) => taken.has(p))).toBe('PDF comments/Smith 2021 (Papers-old) (2).md');
		expect(sidecarPathFor('Smith 2021.pdf', 'PDF comments', (p) => p === 'PDF comments/Smith 2021.md')).toBe('PDF comments/Smith 2021 (vault).md');
	});
	it('removes characters that break links', () => {
		expect(sidecarPathFor('a/Notes #1 [draft] ^x.pdf', 'C', () => false)).toBe('C/Notes 1 draft x.md');
		expect(normalizeFolder(' /PDF comments//sub/ ')).toBe('PDF comments/sub');
	});
});

// ---- re-anchoring a whole note ----------------------------------------------------


describe('reanchorThreads (Lighthouses → revised)', () => {
	const data = (f: Fixture, pts: PageText[]): PageData[] => f.pages.map((p, i) => ({ text: pts[i]!, items: p.items }));
	const thread = (page: number, text: string): PdfThreads[string] => {
		const { anchor, quote } = anchorFor(texts1, page, text);
		const seg = anchor.segments[0]!;
		seg.rects = rectsFromItems(v1.pages[page - 1]!.items, pt1[page - 1]!, seg.start!, seg.end!);
		return { anchor, quote, created: '2026-11-25T10:00:00Z', resolved: false, comments: [{ id: 'a1', parent: null, created: '2026-11-25T10:00:00Z', body: text }] };
	};
	const threads: PdfThreads = {
		lens: thread(3, 'The real change came with the stepped lens'),
		quot: thread(2, 'A light that cannot be told apart'),
		gone: { ...thread(1, 'a fire on a hill'), quote: 'a passage that the revision deleted' },
		area: { anchor: { segments: [{ page: 4, rects: [[100, 300, 400, 500]] }], area: true }, quote: '', created: '2026-11-25T10:00:00Z', resolved: false, comments: [] },
		bad: { anchor: { nope: true }, quote: 'x', created: '', resolved: false, comments: [] },
	};

	it('moves found threads, detaches lost ones, flags areas, leaves malformed ones alone', () => {
		const r = reanchorThreads(threads, data(v2, pt2));
		expect(r.detached).toEqual(['gone']);
		expect(r.moved).toContain('lens'); // page 3 → page 4 in the revision
		const lens = threadAnchor(r.threads.lens!)!;
		expect(lens.segments.map((s) => s.page)).toEqual([4]);
		expect(segmentsText(lens.segments, textOf(texts2))).toBe('The real change came with the stepped lens');
		expect(lens.segments[0]!.rects.length).toBeGreaterThan(0);
		expect(lens.prefix?.length).toBeGreaterThan(0);
		expect(r.threads.gone!.detached).toBe(true);
		expect(threadAnchor(r.threads.gone!)).toEqual(threadAnchor(threads.gone!)); // old anchor kept
		expect(threadAnchor(r.threads.area!)).toMatchObject({ area: true, pdfChanged: true });
		expect(r.threads.bad).toBe(threads.bad);
		// Comments are untouched.
		expect(r.threads.quot!.comments).toEqual(threads.quot!.comments);
	});

	it('re-found threads lose their detached mark; the same PDF moves nothing', () => {
		const back = reanchorThreads({ lens: { ...threads.lens!, detached: true } }, data(v1, pt1));
		expect(back.threads.lens!.detached).toBeUndefined();
		expect(back.moved).toEqual([]);
		expect(back.detached).toEqual([]);
	});
});
