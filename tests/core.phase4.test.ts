import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPageText } from '../src/core/pageText';
import { contextOf, type Anchor, type Rect, type TextItemGeom } from '../src/core/anchor';
import { exportPdfForLLM, exportSummary, pagesNeeded, unwrap, type PdfExportOptions } from '../src/core/llmExport';
import type { PdfThread, PdfThreads } from '../src/core/sidecar';

const fx = JSON.parse(readFileSync(new URL('./fixtures/lighthouses-v1.json', import.meta.url), 'utf8')) as { pages: { items: TextItemGeom[] }[] };
const texts = fx.pages.map((p) => buildPageText(p.items).text);
const pageText = (p: number) => texts[p - 1];

function textThread(page: number, quote: string, comments: PdfThread['comments'], extra: Partial<PdfThread> = {}): PdfThread {
	const start = texts[page - 1]!.indexOf(quote);
	if (start < 0) throw new Error(quote);
	const segments = [{ page, start, end: start + quote.length, rects: [[0, 0, 1, 1]] as Rect[] }];
	const anchor: Anchor = { segments, ...contextOf(segments, pageText) };
	return { anchor, quote, created: comments[0]!.created, resolved: false, comments, ...extra };
}
const c = (id: string, parent: string | null, body: string, created = '2026-11-25T10:00:00Z') => ({ id, parent, created, body });

const crossStart = texts[0]!.lastIndexOf('The improve');
const THREADS: PdfThreads = {
	lens: textThread(3, 'The real change came with the stepped lens', [c('a1', null, 'Key sentence.'), c('a2', null, 'Second thought.', '2026-11-25T11:00:00Z'), c('a3', 'a1', 'Agreed with the first.', '2026-11-25T12:00:00Z')], { priority: 'high' }),
	quot: textThread(2, 'A light that cannot be told apart from the others is almost worse\nthan no light.', [c('a1', null, 'The saying </comment> is good.')]),
	done: textThread(4, 'The second was identity', [c('a1', null, 'Resolved one.')], { resolved: true }),
	cross: {
		anchor: {
			segments: [
				{ page: 1, start: crossStart, end: crossStart + 'The improve'.length, rects: [] },
				{ page: 2, start: 0, end: 'ment was real but small'.length, rects: [] },
			],
		},
		quote: 'The improve\nment was real but small',
		created: '2026-11-24T09:00:00Z',
		resolved: false,
		comments: [c('a1', null, 'Across pages.', '2026-11-24T09:00:00Z')],
	},
	area: { anchor: { segments: [{ page: 4, rects: [[100, 300, 400, 500]] }], area: true }, quote: '', created: '2026-11-23T09:00:00Z', resolved: false, comments: [c('a1', null, 'The figure.', '2026-11-23T09:00:00Z')] },
	lost: { anchor: { segments: [{ page: 2, start: 0, end: 4, rects: [] }] }, detached: true, quote: 'a deleted passage', created: '2026-11-20T09:00:00Z', resolved: false, comments: [c('a1', null, 'Gone.', '2026-11-20T09:00:00Z')] },
};
const base: PdfExportOptions = { title: 'Lighthouses', source: 'PDFs/Lighthouses.pdf', totalPages: 5, scope: 'context', areaOffsets: { area: 10 } };

describe('unwrap', () => {
	it('joins lines and words split at a line end', () => {
		expect(unwrap('a long para-\ngraph and\nmore  text\n')).toBe('a long paragraph and more text');
		expect(unwrap('well-known\nthing')).toBe('well-known thing');
	});
});

describe('exportPdfForLLM', () => {
	it('numbers threads in reading order and marks the passages with context (default)', () => {
		const { text, stats } = exportPdfForLLM(THREADS, pageText, base);
		expect(stats).toMatchObject({ threads: 5, resolvedOmitted: 1, pages: [1, 2, 3, 4] });
		// reading order: page 1 (cross), page 2 (quot), page 3 (lens), page 4 (area); detached last
		expect(text).toContain('<thread id="c1" status="open" pages="1-2" anchor="The improve ment was real but small">');
		expect(text).toContain('⟦c2⟧A light that cannot be told apart from the others is almost worse than no light.⟦/c2⟧');
		expect(text).toContain('⟦c3⟧The real change came with the stepped lens⟦/c3⟧');
		expect(text).toContain('⟦c4: area on page 4⟧');
		expect(text).toContain('<thread id="c5" status="open" page="2" detached="true" anchor="a deleted passage">');
		// the cross-page thread opens on page 1 and closes on page 2
		const p1 = text.slice(text.indexOf('<passage page="1">'), text.indexOf('</passage>', text.indexOf('<passage page="1">')));
		expect(p1).toContain('⟦c1⟧The improve');
		expect(p1).not.toContain('⟦/c1⟧');
		expect(text).toMatch(/<passage page="2">\n⟦\/c1⟧ment was real but small|<passage page="2">\nment was real but small⟦\/c1⟧/);
		expect(text).toContain('<document title="Lighthouses" source="PDFs/Lighthouses.pdf" pages="5" scope="commented passages with context">');
		expect(text).not.toContain('Resolved one.');
	});

	it('puts the context around a passage, cut at sentence ends', () => {
		const { text } = exportPdfForLLM({ lens: THREADS.lens! }, pageText, { ...base, contextChars: 120 });
		const passage = text.slice(text.indexOf('<passage page="3">') + '<passage page="3">\n'.length, text.indexOf('\n</passage>'));
		expect(passage.startsWith('… ')).toBe(true);
		expect(passage).toMatch(/[.!?] …$|[.!?]$/);
		expect(passage.length).toBeLessThan(500);
	});

	it('writes replies with reply-to, dates, priority, and escapes bodies', () => {
		const { text } = exportPdfForLLM(THREADS, pageText, base);
		expect(text).toContain('<thread id="c3" status="open" priority="high" page="3" anchor="The real change came with the stepped lens">');
		expect(text).toContain('<comment id="c3.3" reply-to="c3.1" date="2026-11-25 12:00">Agreed with the first.</comment>');
		expect(text).toContain('<comment id="c3.2" date="2026-11-25 11:00">Second thought.</comment>');
		expect(text).toContain('The saying <\\/comment> is good.');
		expect(text).toContain('priority is how important');
		expect(text).toContain('detached="true" means');
		expect(text).toContain('⟦cN: area on page P⟧');
	});

	it('includes whole pages for the other scopes', () => {
		const commented = exportPdfForLLM(THREADS, pageText, { ...base, scope: 'commented-pages' });
		expect(commented.text).toContain('scope="pages with comments: 1, 2, 3, 4"');
		expect(commented.text).toContain('<page n="3">');
		expect(commented.text).not.toContain('<passage');
		const range = exportPdfForLLM(THREADS, pageText, { ...base, scope: 'range', range: [2, 3] });
		expect(range.stats.pages).toEqual([2, 3]);
		expect(range.text).toContain('scope="pages 2–3"');
		expect(range.text).not.toContain('⟦c1⟧'); // opens on page 1, not included
		expect(range.text).toContain('⟦/c1⟧');
		const all = exportPdfForLLM(THREADS, pageText, { ...base, scope: 'all' });
		expect(all.stats.pages).toEqual([1, 2, 3, 4, 5]);
		expect(all.text).toContain('All pages are included.');
	});

	it('can include resolved threads, leave the text out, or leave the comments out', () => {
		expect(exportPdfForLLM(THREADS, pageText, { ...base, includeResolved: true }).text).toContain('status="resolved"');
		const comments = exportPdfForLLM(THREADS, pageText, { ...base, mode: 'comments' });
		expect(comments.text).not.toContain('<document');
		expect(comments.text).toContain('<comments document="Lighthouses" source="PDFs/Lighthouses.pdf">');
		expect(comments.stats.pages).toEqual([]);
		const textOnly = exportPdfForLLM(THREADS, pageText, { ...base, mode: 'text', scope: 'range', range: [1, 1] });
		expect(textOnly.text).not.toContain('⟦');
		expect(textOnly.text).not.toContain('<comments');
		expect(exportSummary(textOnly.stats, 'text')).toMatch(/^Copied: 1 page, [\d,]+ words$/);
		expect(exportSummary(comments.stats, 'comments')).toBe('Copied: 5 threads (1 resolved omitted)');
	});

	it('knows which pages it needs', () => {
		expect(pagesNeeded(THREADS, { ...base })).toEqual([1, 2, 3, 4]);
		expect(pagesNeeded(THREADS, { ...base, includeResolved: true })).toEqual([1, 2, 3, 4]);
		expect(pagesNeeded(THREADS, { ...base, scope: 'range', range: [4, 99] })).toEqual([4, 5]);
		expect(pagesNeeded(THREADS, { ...base, mode: 'comments' })).toEqual([]);
	});
});
