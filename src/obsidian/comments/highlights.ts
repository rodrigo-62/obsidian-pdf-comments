// Highlights of commented passages (SPEC §4): one overlay layer per rendered page, below the
// text layer so selecting text still works. Rectangles are placed in percent of the page, so a
// zoom needs no recalculation. Clicks and hovers are matched against the rectangles in code
// (the layer itself ignores the pointer).

import { applyInverseTransform, pdfRectToCss, type Rect, type Transform } from '../../core/anchor';
import type { PageViewLike } from './selection';

export interface HighlightItem {
	id: string;
	page: number;
	rects: Rect[];
	area: boolean;
	resolved: boolean;
}

export interface HighlightState {
	activeId: string | null;
	hoverId: string | null;
	draftId: string | null;
}

export const DRAFT_ID = '__pdfc_draft__';

export class Highlights {
	private byPage = new Map<number, HighlightItem[]>();
	private state: HighlightState = { activeId: null, hoverId: null, draftId: null };

	constructor(private pageView: (page: number) => PageViewLike | undefined) {}

	setItems(items: HighlightItem[]): void {
		this.byPage.clear();
		for (const it of items) {
			if (!this.byPage.has(it.page)) this.byPage.set(it.page, []);
			this.byPage.get(it.page)!.push(it);
		}
	}

	setState(state: HighlightState): void {
		this.state = state;
	}

	pagesWithItems(): number[] {
		return [...this.byPage.keys()];
	}

	/** (Re)draws a page's layer (after PDF.js rendered it, or when comments changed). */
	renderPage(page: number): void {
		const pv = this.pageView(page);
		if (!pv?.div.isConnected) return;
		let layer = pv.div.querySelector<HTMLElement>(':scope > .pdfc-hl-layer');
		const items = this.byPage.get(page) ?? [];
		if (!items.length) {
			layer?.remove();
			return;
		}
		if (!layer) {
			layer = createDiv({ cls: 'pdfc-hl-layer' });
			// Just above the canvas, below the text layer.
			const text = pv.div.querySelector(':scope > .textLayer');
			if (text) pv.div.insertBefore(layer, text);
			else pv.div.appendChild(layer);
		}
		layer.empty();
		const t = pv.viewport.transform as Transform;
		const w = pv.viewport.width;
		const h = pv.viewport.height;
		const { activeId, hoverId } = this.state;
		for (const it of items) {
			for (const r of it.rects) {
				const css = pdfRectToCss(r, t);
				const el = layer.createDiv({ cls: it.area ? 'pdfc-hl pdfc-hl-area' : 'pdfc-hl', attr: { 'data-id': it.id } });
				el.toggleClass('is-active', it.id === activeId);
				el.toggleClass('is-hover', it.id === hoverId && it.id !== activeId);
				el.toggleClass('is-resolved', it.resolved);
				el.toggleClass('is-draft', it.id === DRAFT_ID);
				el.setCssProps({
					left: `${(css.left / w) * 100}%`,
					top: `${(css.top / h) * 100}%`,
					width: `${(css.width / w) * 100}%`,
					height: `${(css.height / h) * 100}%`,
				});
			}
		}
	}

	/** Updates active/hover classes without rebuilding. */
	restyle(root: HTMLElement): void {
		const { activeId, hoverId } = this.state;
		for (const el of Array.from(root.querySelectorAll<HTMLElement>('.pdfc-hl'))) {
			const id = el.dataset.id;
			el.toggleClass('is-active', id === activeId);
			el.toggleClass('is-hover', id === hoverId && id !== activeId);
		}
	}

	/** Threads whose rectangles contain the point (client coordinates), smallest first. */
	hitTest(pageEl: HTMLElement, clientX: number, clientY: number): string[] {
		const page = Number(pageEl.dataset.pageNumber);
		const pv = this.pageView(page);
		const items = this.byPage.get(page);
		if (!pv || !items?.length) return [];
		const box = pv.div.getBoundingClientRect();
		const [x, y] = applyInverseTransform(pv.viewport.transform as Transform, clientX - box.left - pv.div.clientLeft, clientY - box.top - pv.div.clientTop);
		const hits: { id: string; size: number }[] = [];
		const pad = 1; // PDF units of tolerance
		for (const it of items) {
			if (it.id === DRAFT_ID) continue;
			for (const r of it.rects) {
				if (x >= r[0] - pad && x <= r[2] + pad && y >= r[1] - pad && y <= r[3] + pad) {
					hits.push({ id: it.id, size: (r[2] - r[0]) * (r[3] - r[1]) });
					break;
				}
			}
		}
		return hits.sort((a, b) => a.size - b.size).map((h) => h.id);
	}
}
