// Comments in one PDF view (SPEC §4): UI state, highlights, margin, selection actions.
// The data lives in a CommentDoc shared by all views of the same PDF.

import { Menu, Notice, type App } from 'obsidian';
import { anchorStart, compareAnchors, cssRectToPdf, pdfRectToCss, roundRect, type Anchor, type Transform } from '../../core/anchor';
import { offsetToItem } from '../../core/pageText';
import { generateId } from '../../core/ids';
import { addReply, createThread, deleteComment, editComment, setPriority, setResolved, type Priority } from '../../core/shared/model';
import { threadAnchor, type PdfThread, type PdfThreads } from '../../core/sidecar';
import { formatPdfSubpath } from '../../core/subpath';
import { areaTextOffset, exportPdfForLLM, exportSummary, pagesNeeded, type PdfExportOptions } from '../../core/llmExport';
import { CopyForLlmModal, type LlmChoice } from './llmModal';
import type { CardHost } from './card';
import type { CommentDoc } from './commentDoc';
import { ComposerModal } from './composer';
import { DRAFT_ID, Highlights, type HighlightItem } from './highlights';
import { Margin } from './margin';
import { showMenu } from './menus';
import { PageTexts } from './pageTexts';
import { anchorFromSelection, pdfSelectionRange, selectionRef, type PageViewLike, type SelectionHost } from './selection';
import type { PDFDocumentProxy } from '../pdfjs';

export interface ControllerHost {
	app: App;
	scrollEl: HTMLElement;
	pagesEl: HTMLElement;
	mainEl: HTMLElement;
	marginWidth(): number;
	pageView(page: number): PageViewLike | undefined;
	pagesCount(): number;
	currentPage(): number;
	setMarginVisible(visible: boolean): void;
	commentDoc(pdfPath: string): CommentDoc;
	/** Last choices in the Copy for LLM dialog (remembered in the settings). */
	llmChoice(): LlmChoice;
	setLlmChoice(choice: LlmChoice): void;
	openSidebar(): void;
	/** Comments or UI state changed (the sidebar listens). */
	changed(): void;
}

interface Draft {
	anchor: Anchor;
	quote: string;
}

export class CommentsController {
	doc: CommentDoc | null = null;
	pdfPath: string | null = null;
	activeId: string | null = null;
	hoverId: string | null = null;
	showResolved = false;
	private draft: Draft | null = null;
	private texts: PageTexts | null = null;
	private unsubscribe: (() => void) | null = null;
	private highlights: Highlights;
	readonly margin: Margin;
	readonly cardHost: CardHost;
	private tree = new Set<string>();
	private hoverFrame = 0;
	private selHost: SelectionHost;
	/** "Comment on an area" mode (SPEC §4): the next drag on a page draws a rectangle. */
	areaMode = false;
	private drag: { page: HTMLElement; x0: number; y0: number; box: HTMLElement } | null = null;

	constructor(private host: ControllerHost) {
		this.highlights = new Highlights((p) => host.pageView(p));
		this.cardHost = this.makeCardHost();
		this.margin = new Margin({
			app: host.app,
			scrollEl: host.scrollEl,
			mainEl: host.mainEl,
			marginWidth: () => host.marginWidth(),
			pageView: (p) => host.pageView(p),
			pagesCount: () => host.pagesCount(),
			currentPage: () => host.currentPage(),
			cardHost: this.cardHost,
			openSidebar: () => host.openSidebar(),
			submitDraft: (text, priority) => void this.createFromDraft(text, priority),
			cancelDraft: () => this.cancelDraft(),
			marginShown: (shown) => host.setMarginVisible(shown),
		});
		this.selHost = {
			pagesEl: host.pagesEl,
			pageView: (p) => host.pageView(p),
			pageData: (p) => {
				if (!this.texts) return Promise.reject(new Error('no document'));
				return this.texts.get(p);
			},
		};
		host.pagesEl.addEventListener('click', (e) => this.onPagesClick(e));
		host.pagesEl.addEventListener('mousemove', (e) => this.onPagesMove(e));
		host.pagesEl.addEventListener('mouseleave', () => this.setHover(null));
		host.pagesEl.addEventListener('contextmenu', (e) => this.onContextMenu(e));
		// Area comments: in area mode, or with Alt held, a drag on a page draws a rectangle.
		host.pagesEl.addEventListener('mousedown', (e) => this.onAreaDown(e), true);
		host.pagesEl.win.addEventListener('mousemove', this.onAreaMove);
		host.pagesEl.win.addEventListener('mouseup', this.onAreaUp);
		host.scrollEl.addEventListener('mousedown', (e) => {
			// Outside the pages and the margin: deactivate.
			const t = e.target as HTMLElement;
			if (!t.closest('.page') && !t.closest('.pdfc-margin') && this.activeId) this.setActive(null);
		});
	}

	destroy(): void {
		this.host.pagesEl.win.removeEventListener('mousemove', this.onAreaMove);
		this.host.pagesEl.win.removeEventListener('mouseup', this.onAreaUp);
		this.detach();
		this.margin.destroy();
	}

	// ---- Area comments ----------------------------------------------------------------

	setAreaMode(on: boolean): void {
		this.areaMode = on;
		this.host.pagesEl.toggleClass('pdfc-area-mode', on);
		this.host.changed();
	}

	private onAreaDown(e: MouseEvent): void {
		if (e.button !== 0 || !(this.areaMode || e.altKey) || !this.texts) return;
		const page = (e.target as HTMLElement).closest<HTMLElement>('.page[data-page-number]');
		if (!page) return;
		e.preventDefault();
		e.stopPropagation();
		this.host.pagesEl.win.getSelection()?.removeAllRanges();
		const box = page.createDiv({ cls: 'pdfc-area-drag' });
		this.drag = { page, x0: e.clientX, y0: e.clientY, box };
		this.onAreaMove(e);
	}

	private onAreaMove = (e: MouseEvent): void => {
		const d = this.drag;
		if (!d) return;
		const r = d.page.getBoundingClientRect();
		const ox = r.left + d.page.clientLeft;
		const oy = r.top + d.page.clientTop;
		const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
		const x1 = clamp(Math.min(d.x0, e.clientX) - ox, d.page.clientWidth);
		const y1 = clamp(Math.min(d.y0, e.clientY) - oy, d.page.clientHeight);
		const x2 = clamp(Math.max(d.x0, e.clientX) - ox, d.page.clientWidth);
		const y2 = clamp(Math.max(d.y0, e.clientY) - oy, d.page.clientHeight);
		d.box.setCssProps({ left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
	};

	private onAreaUp = (e: MouseEvent): void => {
		const d = this.drag;
		if (!d) return;
		this.drag = null;
		const left = parseFloat(d.box.style.left);
		const top = parseFloat(d.box.style.top);
		const w = parseFloat(d.box.style.width);
		const h = parseFloat(d.box.style.height);
		d.box.remove();
		void e;
		if (!(w >= 8 && h >= 8)) return; // a click, not a drag
		const page = Number(d.page.dataset.pageNumber);
		const pv = this.host.pageView(page);
		if (!pv) return;
		const rect = roundRect(cssRectToPdf(left, top, left + w, top + h, pv.viewport.transform as Transform));
		this.setAreaMode(false);
		this.startDraft({ anchor: { segments: [{ page, rects: [rect] }], area: true }, quote: '' });
	};

	// ---- Document --------------------------------------------------------------------

	/** A PDF was loaded in the view. */
	attach(pdfPath: string, pdf: PDFDocumentProxy, fingerprint: string): void {
		this.detach();
		this.pdfPath = pdfPath;
		this.texts = new PageTexts(pdf);
		const doc = this.host.commentDoc(pdfPath);
		this.doc = doc;
		doc.currentFingerprint = fingerprint;
		this.unsubscribe = doc.subscribe(() => this.render());
		void doc.load().then(() => {
			this.render();
			const texts = this.texts;
			if (texts) void doc.checkAnchors(fingerprint, () => texts.all());
		});
	}

	detach(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.doc = null;
		this.pdfPath = null;
		this.texts = null;
		this.draft = null;
		this.activeId = null;
		this.hoverId = null;
		this.highlights.setItems([]);
		this.margin.sync({ threads: {}, anchored: [], detached: [], activeId: null, draft: null });
	}

	get threads(): PdfThreads {
		return this.doc?.threads ?? {};
	}

	private visible(t: PdfThread): boolean {
		return !t.resolved || this.showResolved;
	}

	/** Visible threads: anchored in reading order, then detached (oldest first). */
	order(): { anchored: string[]; detached: string[] } {
		const anchored: [string, Anchor][] = [];
		const detached: string[] = [];
		for (const [id, t] of Object.entries(this.threads)) {
			if (!this.visible(t)) continue;
			const a = threadAnchor(t);
			if (a && !t.detached) anchored.push([id, a]);
			else detached.push(id);
		}
		anchored.sort((x, y) => compareAnchors(x[1], y[1]));
		detached.sort((x, y) => this.threads[x]!.created.localeCompare(this.threads[y]!.created));
		return { anchored: anchored.map((x) => x[0]), detached };
	}

	// ---- Rendering --------------------------------------------------------------------

	render(): void {
		const threads = this.threads;
		if (this.activeId && !threads[this.activeId]) this.activeId = null;
		const { anchored, detached } = this.order();
		const items: HighlightItem[] = [];
		for (const id of anchored) {
			const t = threads[id]!;
			const a = threadAnchor(t)!;
			for (const s of a.segments) items.push({ id, page: s.page, rects: s.rects, area: a.area === true, resolved: t.resolved });
		}
		if (this.draft) for (const s of this.draft.anchor.segments) items.push({ id: DRAFT_ID, page: s.page, rects: s.rects, area: this.draft.anchor.area === true, resolved: false });
		const before = new Set(this.highlights.pagesWithItems());
		this.highlights.setItems(items);
		this.highlights.setState({ activeId: this.activeId, hoverId: this.hoverId, draftId: this.draft ? DRAFT_ID : null });
		for (const p of new Set([...before, ...this.highlights.pagesWithItems()])) this.highlights.renderPage(p);
		this.margin.sync({ threads, anchored, detached, activeId: this.activeId, draft: this.margin.isWide ? (this.draft?.anchor ?? null) : null });
		this.host.changed();
	}

	/** PDF.js (re)rendered a page: its highlight layer was removed with the old content. */
	pageRendered(page: number): void {
		this.highlights.renderPage(page);
	}

	/** Zoom or page sizes changed: the cards move. */
	layoutChanged(): void {
		this.margin.schedule();
	}

	private setHover(id: string | null): void {
		if (this.hoverId === id) return;
		this.hoverId = id;
		this.highlights.setState({ activeId: this.activeId, hoverId: id, draftId: this.draft ? DRAFT_ID : null });
		this.highlights.restyle(this.host.pagesEl);
	}

	setActive(id: string | null): void {
		if (this.activeId === id) return;
		this.activeId = id;
		this.render();
	}

	// ---- Navigation -------------------------------------------------------------------

	/** Scrolls so the thread's passage is a third from the top of the view. */
	scrollTo(id: string): void {
		const t = this.threads[id];
		const a = t ? threadAnchor(t) : null;
		if (!a) return;
		const s = anchorStart(a);
		const pv = this.host.pageView(s.page);
		if (!pv) return;
		const r = a.segments[0]!.rects[0];
		const inPage = r ? pdfRectToCss(r, pv.viewport.transform as Transform).top : 0;
		const sc = this.host.scrollEl;
		const box = pv.div.getBoundingClientRect();
		const top = sc.scrollTop + box.top - sc.getBoundingClientRect().top + pv.div.clientTop + inPage - sc.clientHeight / 3;
		sc.scrollTo({ top: Math.max(0, top) });
	}

	activate(id: string, scroll = false): void {
		if (scroll) this.scrollTo(id);
		this.setActive(id);
		if (scroll) window.setTimeout(() => this.margin.schedule(), 50);
	}

	step(dir: 1 | -1): void {
		const { anchored } = this.order();
		if (!anchored.length) {
			new Notice('This PDF has no comments.');
			return;
		}
		const i = this.activeId ? anchored.indexOf(this.activeId) : -1;
		let next: number;
		if (i === -1) {
			// From the current page: the first comment on or after it (or before, going back).
			const page = this.host.currentPage();
			const pages = anchored.map((id) => anchorStart(threadAnchor(this.threads[id]!)!).page);
			next = dir > 0 ? pages.findIndex((p) => p >= page) : pages.length - 1 - [...pages].reverse().findIndex((p) => p <= page);
			if (next < 0 || next >= anchored.length) next = dir > 0 ? 0 : anchored.length - 1;
		} else next = (i + dir + anchored.length) % anchored.length;
		this.activate(anchored[next]!, true);
	}

	toggleResolved(): void {
		this.showResolved = !this.showResolved;
		this.render();
	}

	// ---- Creating ---------------------------------------------------------------------

	hasSelection(): boolean {
		return !!this.texts && pdfSelectionRange(this.selHost) !== null;
	}

	async addComment(): Promise<void> {
		if (!this.doc || !this.texts) return;
		if (this.doc.error) {
			new Notice(`The comments of this PDF can't be changed: ${this.doc.error}`);
			return;
		}
		const sel = await anchorFromSelection(this.selHost);
		if (!sel) {
			new Notice('Select some text in the PDF first.');
			return;
		}
		this.host.pagesEl.win.getSelection()?.removeAllRanges();
		this.startDraft(sel);
	}

	private startDraft(draft: Draft): void {
		if (this.doc?.error) {
			new Notice(`The comments of this PDF can't be changed: ${this.doc.error}`);
			return;
		}
		this.draft = draft;
		this.activeId = null;
		this.render();
		if (this.margin.isWide) {
			this.margin.focusDraft();
			return;
		}
		const quote = draft.anchor.area ? `[Area on page ${draft.anchor.segments[0]!.page}]` : draft.quote;
		new ComposerModal(this.host.app, 'New comment', quote, {
			submitLabel: 'Comment',
			priority: 'normal',
			onSubmit: (text, { priority }) => void this.createFromDraft(text, priority),
			onCancel: () => this.cancelDraft(),
		}).open();
	}

	private async createFromDraft(text: string, priority: Priority): Promise<void> {
		const draft = this.draft;
		const doc = this.doc;
		if (!draft || !doc || !text.trim()) return;
		let id = '';
		const ok = await doc.update((threads) => {
			id = generateId(Object.keys(threads));
			let t: PdfThread = { anchor: draft.anchor, ...createThread(draft.quote, text) };
			if (priority !== 'normal') t = setPriority(t, priority);
			return { ...threads, [id]: t };
		});
		if (!ok) return;
		this.draft = null;
		this.activeId = id;
		this.render();
	}

	cancelDraft(): void {
		if (!this.draft) return;
		this.draft = null;
		this.render();
	}

	async copyLinkToSelection(): Promise<void> {
		const file = this.pdfPath ? this.host.app.vault.getFileByPath(this.pdfPath) : null;
		const r = await selectionRef(this.selHost);
		if (!file || !r) {
			new Notice('Select some text in the PDF first.');
			return;
		}
		const link = this.host.app.fileManager.generateMarkdownLink(file, '', formatPdfSubpath({ page: r.page, selection: r.ref }), `${file.basename}, p.${r.page}`);
		await navigator.clipboard.writeText(link);
		new Notice('Link to the selection copied');
	}

	// ---- Copy for LLM (SPEC §6) -------------------------------------------------------

	openCopyForLlm(): void {
		if (!this.texts || !this.pdfPath) return;
		const total = this.texts.numPages;
		new CopyForLlmModal(this.host.app, total, this.host.llmChoice(), (choice) => {
			this.host.setLlmChoice(choice);
			void this.copyForLlm(choice);
		}).open();
	}

	async copyForLlm(choice: LlmChoice): Promise<void> {
		const texts = this.texts;
		const path = this.pdfPath;
		if (!texts || !path) return;
		const threads = this.threads;
		const options: PdfExportOptions = {
			title: path.split('/').pop()!.replace(/\.pdf$/i, ''),
			source: path,
			totalPages: texts.numPages,
			scope: choice.scope,
			range: choice.range,
			mode: choice.mode,
			includeResolved: choice.includeResolved,
		};
		const notice = new Notice('Collecting the text…', 0);
		try {
			const pages = new Map<number, string>();
			for (const p of pagesNeeded(threads, options)) pages.set(p, (await texts.get(p)).text.text);
			// Area comments: their marker goes before the first line below the area's top.
			const areaOffsets: Record<string, number> = {};
			for (const [id, t] of Object.entries(threads)) {
				const a = threadAnchor(t);
				const s = a?.area ? a.segments[0] : null;
				if (!s || !pages.has(s.page)) continue;
				const data = await texts.get(s.page);
				areaOffsets[id] = areaTextOffset(data.items, data.text.starts, Math.max(...s.rects.map((r) => r[3])));
			}
			const r = exportPdfForLLM(threads, (p) => pages.get(p), { ...options, areaOffsets });
			await navigator.clipboard.writeText(r.text);
			notice.hide();
			new Notice(exportSummary(r.stats, options.mode ?? 'full'));
		} catch (e) {
			notice.hide();
			console.error('[pdf-comments]', e);
			new Notice(`Could not copy: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/**
	 * A link to a thread (SPEC §4, DECISIONS D0.5): `#page=N&selection=…&comment=ID`, so it opens
	 * the thread here and still selects the passage in Obsidian's own viewer.
	 */
	async copyLinkToComment(id: string): Promise<void> {
		const t = this.threads[id];
		const a = t ? threadAnchor(t) : null;
		const file = this.pdfPath ? this.host.app.vault.getFileByPath(this.pdfPath) : null;
		if (!t || !file) return;
		const seg = a?.segments[0];
		let selection;
		if (seg && !a?.area && seg.start !== undefined && seg.end !== undefined && this.texts && !t.detached) {
			const pt = (await this.texts.get(seg.page)).text;
			const b = offsetToItem(pt, seg.start, 'start');
			const e = offsetToItem(pt, seg.end, 'end');
			if (b && e) selection = { beginIndex: b.index, beginOffset: b.offset, endIndex: e.index, endOffset: e.offset };
		}
		const page = seg?.page;
		const subpath = formatPdfSubpath({ page, selection, comment: id });
		const link = this.host.app.fileManager.generateMarkdownLink(file, '', subpath, page ? `${file.basename}, p.${page}` : file.basename);
		await navigator.clipboard.writeText(link);
		new Notice('Link to the comment copied');
	}

	// ---- Pointer ----------------------------------------------------------------------

	private onPagesClick(e: MouseEvent): void {
		if (e.button !== 0) return;
		const t = e.target as HTMLElement;
		if (t.closest('a, .annotationLayer section, input, textarea, button')) return;
		const sel = this.host.pagesEl.win.getSelection();
		if (sel && !sel.isCollapsed && sel.toString().trim()) return;
		const pageEl = t.closest<HTMLElement>('.page[data-page-number]');
		const hits = pageEl ? this.highlights.hitTest(pageEl, e.clientX, e.clientY) : [];
		if (!hits.length) {
			if (this.activeId) this.setActive(null);
			return;
		}
		// Clicking again where comments overlap goes to the next one.
		const i = this.activeId ? hits.indexOf(this.activeId) : -1;
		this.setActive(hits[(i + 1) % hits.length]!);
	}

	private onPagesMove(e: MouseEvent): void {
		window.cancelAnimationFrame(this.hoverFrame);
		this.hoverFrame = window.requestAnimationFrame(() => {
			const pageEl = (e.target as HTMLElement).closest<HTMLElement>('.page[data-page-number]');
			const hits = pageEl ? this.highlights.hitTest(pageEl, e.clientX, e.clientY) : [];
			this.setHover(hits[0] ?? null);
			this.host.pagesEl.toggleClass('pdfc-over-comment', hits.length > 0);
		});
	}

	private onContextMenu(e: MouseEvent): void {
		if (!this.texts || !pdfSelectionRange(this.selHost)) return;
		e.preventDefault();
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle('Add comment')
				.setIcon('message-square-plus')
				.onClick(() => void this.addComment()),
		);
		menu.addItem((i) =>
			i
				.setTitle('Copy link to selection')
				.setIcon('link')
				.onClick(() => void this.copyLinkToSelection()),
		);
		menu.addItem((i) =>
			i
				.setTitle('Copy')
				.setIcon('copy')
				.onClick(() => {
					const text = this.host.pagesEl.win.getSelection()?.toString() ?? '';
					void navigator.clipboard.writeText(text);
				}),
		);
		showMenu(menu, e);
	}

	// ---- Card actions -----------------------------------------------------------------

	private change(id: string, fn: (t: PdfThread) => PdfThread | null): boolean {
		const doc = this.doc;
		if (!doc || !doc.threads[id]) return false;
		void doc.update((threads) => {
			const t = threads[id];
			if (!t) return threads;
			const next = fn(t);
			const out = { ...threads };
			if (next) out[id] = next;
			else delete out[id];
			return out;
		});
		return true;
	}

	private makeCardHost(): CardHost {
		return {
			app: this.host.app,
			sourcePath: () => this.pdfPath ?? '',
			reply: (id, parent, body) => this.change(id, (t) => addReply(t, parent, body)),
			edit: (id, cid, body) => this.change(id, (t) => editComment(t, cid, body)),
			deleteComment: (id, cid) => this.change(id, (t) => deleteComment(t, cid)),
			deleteThread: (id) => this.change(id, () => null),
			resolve: (id, r) => {
				const ok = this.change(id, (t) => setResolved(t, r));
				if (r && this.activeId === id && !this.showResolved) this.activeId = null;
				return ok;
			},
			setPriority: (id, p) => this.change(id, (t) => setPriority(t, p)),
			activate: (id) => this.setActive(id),
			goTo: (id) => this.activate(id, true),
			copyLink: (id) => void this.copyLinkToComment(id),
			hover: (id) => this.setHover(id),
			isTree: (id) => this.tree.has(id),
			setTree: (id, tree) => {
				if (tree) this.tree.add(id);
				else this.tree.delete(id);
				this.render();
			},
			changed: () => this.margin.schedule(),
		};
	}
}
