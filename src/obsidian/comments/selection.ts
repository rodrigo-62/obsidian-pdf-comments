// From a DOM selection in the text layer to an anchor (SPEC §4, §5.3; DECISIONS D0.2, D2.4).
//
// The text layer's spans carry `data-idx` (the item index in getTextContent()), so a DOM
// position becomes (item, offset), then a page-text offset. A selection may span pages: pages in
// between are taken whole. Rectangles come from the selected text nodes' client rects (exact),
// or from the items' geometry on pages whose text layer isn't rendered.

import { contextOf, cssRectToPdf, mergeLineRects, rectsFromItems, roundRect, segmentsText, type Anchor, type Rect, type Segment, type Transform } from '../../core/anchor';
import { itemToOffset, offsetToItem, type ItemPos } from '../../core/pageText';
import type { PageData } from '../../core/reanchor';
import type { TextSelectionRef } from '../../core/subpath';

export interface PageViewLike {
	div: HTMLElement;
	viewport: { transform: number[]; width: number; height: number };
}

export interface SelectionHost {
	pagesEl: HTMLElement;
	pageView(page: number): PageViewLike | undefined;
	pageData(page: number): Promise<PageData>;
}

/** What is read from the DOM synchronously (the selection may change while texts load). */
interface Captured {
	firstPage: number;
	lastPage: number;
	/** Item position of the start (on firstPage) and end (on lastPage); null = page start / end. */
	start: ItemPos | null;
	end: ItemPos | null;
	/** Client rects per page, already in PDF units. */
	rects: Map<number, Rect[]>;
}

export interface SelectionAnchor {
	anchor: Anchor;
	quote: string;
}

const pageOf = (el: Element | null): HTMLElement | null => el?.closest<HTMLElement>('.page[data-page-number]') ?? null;
const pageNumber = (el: HTMLElement) => Number(el.dataset.pageNumber);

function elementOf(node: Node): Element | null {
	return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** The current selection inside the pages, if it has any text. */
export function pdfSelectionRange(host: SelectionHost): Range | null {
	const sel = host.pagesEl.win.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	if (!host.pagesEl.contains(range.commonAncestorContainer)) return null;
	if (!range.toString().trim()) return null;
	return range;
}

/** Text length from the start of `span` to (node, offset). */
function offsetInSpan(span: Element, node: Node, offset: number): number {
	const r = span.ownerDocument.createRange();
	r.setStart(span, 0);
	r.setEnd(node, offset);
	return r.toString().length;
}

/** Item position of a DOM boundary point inside a text layer (or the nearest span on the given side). */
function itemPos(layer: Element, node: Node, offset: number, side: 'start' | 'end'): ItemPos | null {
	const span = elementOf(node)?.closest('[data-idx]');
	if (span && layer.contains(span)) return { index: Number((span as HTMLElement).dataset.idx), offset: offsetInSpan(span, node, offset) };
	const point = layer.ownerDocument.createRange();
	point.setStart(node, offset);
	const spans = [...layer.querySelectorAll<HTMLElement>('[data-idx]')];
	if (side === 'start') {
		const s = spans.find((x) => point.comparePoint(x, 0) >= 0);
		return s ? { index: Number(s.dataset.idx), offset: 0 } : null;
	}
	for (let i = spans.length - 1; i >= 0; i--) {
		const s = spans[i]!;
		if (point.comparePoint(s, s.childNodes.length) <= 0) return { index: Number(s.dataset.idx), offset: s.textContent?.length ?? 0 };
	}
	return null;
}

function capture(host: SelectionHost, range: Range): Captured | null {
	const doc = host.pagesEl.doc;
	let startPage = pageOf(elementOf(range.startContainer));
	let endPage = pageOf(elementOf(range.endContainer));
	const pages = [...host.pagesEl.querySelectorAll<HTMLElement>('.page[data-page-number]')];
	// A boundary between pages (in the viewer element itself): the next / previous page.
	if (!startPage) startPage = pages.find((p) => range.comparePoint(p, 0) >= 0 || range.intersectsNode(p)) ?? null;
	if (!endPage) endPage = [...pages].reverse().find((p) => range.intersectsNode(p)) ?? null;
	if (!startPage || !endPage) return null;
	const firstPage = pageNumber(startPage);
	const lastPage = pageNumber(endPage);
	if (!(firstPage <= lastPage)) return null;

	const startLayer = startPage.querySelector('.textLayer');
	const endLayer = endPage.querySelector('.textLayer');
	const start = startLayer && startPage.contains(range.startContainer) ? itemPos(startLayer, range.startContainer, range.startOffset, 'start') : null;
	const end = endLayer && endPage.contains(range.endContainer) ? itemPos(endLayer, range.endContainer, range.endOffset, 'end') : null;

	// Rectangles of the selected text nodes, per page, in PDF units.
	const rects = new Map<number, Rect[]>();
	for (let p = firstPage; p <= lastPage; p++) {
		const pv = host.pageView(p);
		const layer = pv?.div.querySelector('.textLayer');
		if (!pv || !layer) continue;
		const box = pv.div.getBoundingClientRect();
		const ox = box.left + pv.div.clientLeft;
		const oy = box.top + pv.div.clientTop;
		const t = pv.viewport.transform as Transform;
		const out: Rect[] = [];
		const walker = doc.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			if (!range.intersectsNode(n) || !n.parentElement?.closest('[data-idx]')) continue;
			const len = n.textContent?.length ?? 0;
			const r = doc.createRange();
			r.setStart(n, n === range.startContainer ? range.startOffset : 0);
			r.setEnd(n, n === range.endContainer ? range.endOffset : len);
			if (r.collapsed) continue;
			for (const c of Array.from(r.getClientRects())) {
				if (c.width < 0.5 || c.height < 0.5) continue;
				out.push(cssRectToPdf(c.left - ox, c.top - oy, c.right - ox, c.bottom - oy, t));
			}
		}
		rects.set(p, out);
	}
	return { firstPage, lastPage, start, end, rects };
}

/** Builds an anchor (and its quote) from the current selection. Null if there is no usable selection. */
export async function anchorFromSelection(host: SelectionHost): Promise<SelectionAnchor | null> {
	const range = pdfSelectionRange(host);
	if (!range) return null;
	const c = capture(host, range);
	if (!c) return null;
	const segments: Segment[] = [];
	const texts = new Map<number, string>();
	for (let p = c.firstPage; p <= c.lastPage; p++) {
		const data = await host.pageData(p);
		texts.set(p, data.text.text);
		let s = 0;
		let e = data.text.text.length;
		if (p === c.firstPage && c.start) s = itemToOffset(data.text, c.start.index, c.start.offset) ?? 0;
		if (p === c.lastPage && c.end) e = itemToOffset(data.text, c.end.index, c.end.offset) ?? e;
		// Leave out whitespace at the edges of each page's part.
		const t = data.text.text;
		while (s < e && /\s/.test(t[s]!)) s++;
		while (e > s && /\s/.test(t[e - 1]!)) e--;
		if (e <= s) continue;
		const dom = c.rects.get(p);
		const rects = (dom && dom.length ? mergeLineRects(dom) : rectsFromItems(data.items, data.text, s, e)).map((r) => roundRect(r));
		segments.push({ page: p, start: s, end: e, rects });
	}
	if (!segments.length) return null;
	const pageText = (page: number) => texts.get(page);
	const quote = segmentsText(segments, pageText) ?? '';
	if (!quote.trim()) return null;
	return { anchor: { segments, ...contextOf(segments, pageText) }, quote };
}

/** Obsidian's `selection=` reference for the selection's first page (its viewer links one page at a time). */
export async function selectionRef(host: SelectionHost): Promise<{ page: number; ref: TextSelectionRef } | null> {
	const a = await anchorFromSelection(host);
	const seg = a?.anchor.segments[0];
	if (!seg || seg.start === undefined || seg.end === undefined) return null;
	const pt = (await host.pageData(seg.page)).text;
	const b = offsetToItem(pt, seg.start, 'start');
	const e = offsetToItem(pt, seg.end, 'end');
	if (!b || !e) return null;
	return { page: seg.page, ref: { beginIndex: b.index, beginOffset: b.offset, endIndex: e.index, endOffset: e.offset } };
}
