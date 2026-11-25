// The comment margin (SPEC §4): a layer inside the PDF's scroll container, right of the pages,
// with a card per thread level with its passage (Docs' layoutCards: the active card gets its
// ideal place, the others move up and down). If the pane is too narrow for pages and margin,
// the margin hides and a "💬 N" button opens the comments sidebar instead.

import type { App } from 'obsidian';
import { anchorStart, pdfRectToCss, type Anchor, type Transform } from '../../core/anchor';
import { layoutCards, type CardBox } from '../../core/shared/layout';
import { threadAnchor, type PdfThreads } from '../../core/sidecar';
import { ThreadCard, type CardHost } from './card';
import { createComposer, type Composer } from './composer';
import { isMenuOpen } from './menus';
import type { PageViewLike } from './selection';
import type { Priority } from '../../core/shared/model';

export interface MarginHost {
	app: App;
	scrollEl: HTMLElement;
	mainEl: HTMLElement;
	marginWidth(): number;
	pageView(page: number): PageViewLike | undefined;
	pagesCount(): number;
	currentPage(): number;
	cardHost: CardHost;
	openSidebar(): void;
	submitDraft(text: string, priority: Priority): void;
	cancelDraft(): void;
	/** The margin started or stopped taking room beside the pages. */
	marginShown(shown: boolean): void;
}

export interface MarginData {
	threads: PdfThreads;
	/** Visible threads in reading order, and the detached ones. */
	anchored: string[];
	detached: string[];
	activeId: string | null;
	draft: Anchor | null;
}

export const GAP = 10;
/** Narrowest page column (px) for which the margin is shown beside the pages. */
const MIN_PAGES_WIDTH = 440;
const DETACHED = '__pdfc_detached__';
const DRAFT = '__pdfc_draft__';

export class Margin {
	readonly layer: HTMLElement;
	private cards = new Map<string, ThreadCard>();
	private detachedEl: HTMLElement;
	private narrowBtn: HTMLElement;
	private draftEl: HTMLElement | null = null;
	private draftComposer: Composer | null = null;
	private resize: ResizeObserver;
	private data: MarginData | null = null;
	private frame = 0;
	private wide = true;
	private shown = false;
	private destroyed = false;

	constructor(private host: MarginHost) {
		this.layer = host.scrollEl.createDiv({ cls: 'pdfc-margin' });
		this.layer.hide();
		this.detachedEl = this.layer.createDiv({ cls: 'pdfc-detached-header', text: 'Detached comments' });
		this.detachedEl.hide();
		this.narrowBtn = host.mainEl.createDiv({ cls: 'pdfc-narrow-btn', attr: { 'aria-label': 'Open the comments in the sidebar' } });
		this.narrowBtn.hide();
		this.narrowBtn.addEventListener('click', () => host.openSidebar());
		// Clicks and keys in cards are not clicks on the pages.
		for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'keydown', 'wheel']) {
			this.layer.addEventListener(type, (e) => {
				if (type !== 'wheel' || !(e as WheelEvent).ctrlKey) e.stopPropagation();
			});
		}
		this.resize = new ResizeObserver(() => this.schedule());
		this.resize.observe(host.scrollEl);
	}

	get isWide(): boolean {
		return this.wide;
	}

	destroy(): void {
		this.destroyed = true;
		window.cancelAnimationFrame(this.frame);
		this.resize.disconnect();
		for (const c of this.cards.values()) c.destroy();
		this.cards.clear();
		this.layer.remove();
		this.narrowBtn.remove();
	}

	/** Creates, updates and removes cards to match `data`, then lays them out. */
	sync(data: MarginData): void {
		this.data = data;
		const active = data.anchored.length + data.detached.length > 0 || !!data.draft;
		this.wide = this.computeWide();
		this.setShown(active && this.wide);
		this.narrowBtn.toggle(active && !this.wide);
		this.narrowBtn.setText(`💬 ${data.anchored.length + data.detached.length}`);
		if (!active) {
			for (const c of this.cards.values()) c.destroy();
			this.cards.clear();
			this.removeDraft();
			this.detachedEl.hide();
			return;
		}
		const wanted = new Set([...data.anchored, ...data.detached]);
		for (const [id, card] of this.cards) {
			if (!wanted.has(id)) {
				card.destroy();
				this.cards.delete(id);
			}
		}
		for (const id of [...data.anchored, ...data.detached]) {
			let card = this.cards.get(id);
			if (!card) {
				card = new ThreadCard(this.host.cardHost, id, 'margin');
				this.cards.set(id, card);
				this.layer.appendChild(card.el);
				this.resize.observe(card.el);
			}
			const t = data.threads[id]!;
			card.render(t, { active: data.activeId === id, detached: data.detached.includes(id), showQuote: false, quote: t.quote });
		}
		this.detachedEl.toggle(data.detached.length > 0);
		if (data.detached.length) this.detachedEl.setText(`Detached comments (${data.detached.length})`);
		this.syncDraft(data);
		this.schedule();
	}

	private setShown(shown: boolean): void {
		this.layer.toggle(shown);
		if (shown === this.shown) return;
		this.shown = shown;
		this.host.marginShown(shown);
	}

	card(id: string): ThreadCard | undefined {
		return this.cards.get(id);
	}

	private syncDraft(data: MarginData): void {
		if (!data.draft || !this.wide) {
			this.removeDraft();
			return;
		}
		if (this.draftEl) return;
		const el = this.layer.createDiv({ cls: 'pdfc-card pdfc-card-margin pdfc-draft is-active' });
		el.createDiv({ cls: 'pdfc-card-header' }).createSpan({ cls: 'pdfc-card-meta', text: 'New comment' });
		const comp = createComposer(el, {
			placeholder: 'Comment…',
			submitLabel: 'Comment',
			autofocus: true,
			app: this.host.app,
			priority: 'normal',
			onSubmit: (text, { priority }) => this.host.submitDraft(text, priority),
			onCancel: () => this.host.cancelDraft(),
		});
		// An empty draft disappears when focus leaves it (as in Google Docs).
		comp.textarea.addEventListener('blur', () => {
			window.setTimeout(() => {
				if (this.draftEl && !isMenuOpen() && !this.draftEl.contains(activeDocument.activeElement) && comp.textarea.value.trim() === '') this.host.cancelDraft();
			}, 150);
		});
		this.draftEl = el;
		this.draftComposer = comp;
		this.resize.observe(el);
	}

	private removeDraft(): void {
		this.draftEl?.remove();
		this.draftEl = null;
		this.draftComposer = null;
	}

	focusDraft(): void {
		this.draftComposer?.focus();
	}

	/** Lays the cards out on the next frame (after PDF.js has positioned the pages). */
	schedule(): void {
		if (this.destroyed) return;
		window.cancelAnimationFrame(this.frame);
		this.frame = window.requestAnimationFrame(() => this.layout());
	}

	private computeWide(): boolean {
		const avail = this.host.scrollEl.clientWidth - this.host.marginWidth();
		// a little hysteresis so the margin doesn't flap at the threshold
		return this.wide ? avail >= MIN_PAGES_WIDTH - 20 : avail >= MIN_PAGES_WIDTH;
	}

	/** Top of an anchor's first rectangle, in the layer's coordinates (null if its page isn't known). */
	private topOf(a: Anchor, origin: number): number | null {
		const s = anchorStart(a);
		const pv = this.host.pageView(s.page);
		const r = a.segments[0]?.rects[0];
		if (!pv) return null;
		const box = pv.div.getBoundingClientRect();
		const inPage = r ? pdfRectToCss(r, pv.viewport.transform as Transform).top : 0;
		return box.top + pv.div.clientTop + inPage - origin;
	}

	private layout(): void {
		const data = this.data;
		if (!data || this.destroyed) return;
		const wide = this.computeWide();
		if (wide !== this.wide) {
			this.sync(data); // shows or hides the margin, then lays out again
			return;
		}
		if (!this.shown) return;
		const origin = this.layer.getBoundingClientRect().top;
		const boxes: CardBox[] = [];
		let order = 0;
		for (const id of data.anchored) {
			const card = this.cards.get(id);
			const a = threadAnchor(data.threads[id]!);
			const top = a ? this.topOf(a, origin) : null;
			if (card && top !== null) boxes.push({ id, ideal: top, height: card.el.offsetHeight, order: order++ });
		}
		if (this.draftEl && data.draft) {
			const top = this.topOf(data.draft, origin);
			if (top !== null) boxes.push({ id: DRAFT, ideal: top, height: this.draftEl.offsetHeight, order: order++ });
		}
		if (data.detached.length) {
			const last = this.host.pageView(this.host.pagesCount());
			const bottom = last ? last.div.getBoundingClientRect().bottom - origin + 2 * GAP : 0;
			boxes.push({ id: DETACHED, ideal: bottom, height: this.detachedEl.offsetHeight, order: order++ });
			for (const id of data.detached) {
				const card = this.cards.get(id);
				if (card) boxes.push({ id, ideal: bottom, height: card.el.offsetHeight, order: order++ });
			}
		}
		const activeId = this.draftEl ? DRAFT : data.activeId;
		const tops = layoutCards(boxes, { gap: GAP, activeId, minTop: GAP });
		// Horizontally: right of the current page. When the page is zoomed wider than the pane,
		// the cards stay beside it and the view scrolls sideways (as in Google Docs), rather
		// than covering the text.
		const pv = this.host.pageView(this.host.currentPage()) ?? this.host.pageView(1);
		const width = this.host.marginWidth() - 2 * GAP;
		const layerLeft = this.layer.getBoundingClientRect().left - parseFloat(this.layer.style.left || '0');
		const left = pv ? pv.div.getBoundingClientRect().right - layerLeft + 2 * GAP : GAP;
		this.layer.style.left = `${Math.round(left)}px`;
		this.layer.style.width = `${width}px`;
		for (const [id, top] of tops) {
			const el = id === DRAFT ? this.draftEl : id === DETACHED ? this.detachedEl : this.cards.get(id)?.el;
			// `top`, not a transform: transformed layers render text slightly blurry
			if (el) el.style.top = `${Math.round(top)}px`;
		}
	}
}
