// The PDF view (SPEC §3): our own FileView built from Obsidian's PDF.js viewer
// components. PDFs are loaded from their bytes (vault.readBinary), never from an
// app:// URL (SPEC §2.1).
//
// Layout (Obsidian's PDF classes are reused so pages look the same):
//   .pdfc-view
//     .pdfc-toolbar
//     .pdfc-body
//       .pdfc-outline                  (optional panel)
//       .pdfc-main.pdf-container       (position: relative)
//         .pdfc-scroll.pdf-viewer-container  (PDFViewer's container, absolute, scrolls)
//           .pdfViewer                 (pages)
//           .pdfc-margin               (comment cards, comments/margin.ts)
//         .pdfc-findbar, .pdfc-message, .pdfc-narrow-btn (overlays)

import { debounce, DropdownComponent, FileView, Menu, Scope, setIcon, setTooltip, TFile, WorkspaceLeaf } from 'obsidian';
import { PAGE_THEME_ICONS, PAGE_THEME_LABELS, PAGE_THEMES } from './settings';
import { parsePdfSubpath, type PdfSubpath, type TextSelectionRef } from '../core/subpath';
import { percentLabel, scaleFor, stepScale, wheelScale, ZOOM_PRESETS, type ZoomMode } from '../core/zoom';
import type { FileViewState } from '../core/viewStates';
import { FindBar } from './findBar';
import { OutlinePanel, type OutlineItem } from './outlinePanel';
import { PasswordModal } from './passwordModal';
import { loadPdfJsWithViewer, type EventBus, type PdfJs, type PDFDocumentProxy, type PDFFindController, type PDFLinkService, type PDFPageView, type PDFViewer } from './pdfjs';
import type PdfCommentsPlugin from './main';
import { CommentsController } from './comments/controller';

export const VIEW_TYPE = 'pdf-comments';

/** Options Obsidian's own PDF view passes to PDF.js (read from its AppOptions in 1.15.1). */
const LIB = '/lib/pdfjs/';
const DOCUMENT_OPTIONS = {
	cMapUrl: LIB + 'cmaps/',
	cMapPacked: true,
	standardFontDataUrl: LIB + 'standard_fonts/',
	wasmUrl: LIB + 'wasm/',
	iccUrl: LIB + 'iccs/',
	isEvalSupported: false,
	enableXfa: true,
};

interface ViewLocation {
	pageNumber: number;
	top: number;
	left: number;
}

export class PdfCommentsView extends FileView {
	private pdfjs: PdfJs | null = null;
	private eventBus: EventBus | null = null;
	private linkService: PDFLinkService | null = null;
	private findController: PDFFindController | null = null;
	private viewer: PDFViewer | null = null;
	private doc: PDFDocumentProxy | null = null;
	private loadToken = 0;
	private ready = false;
	private zoom: ZoomMode;
	private pendingSubpath: PdfSubpath | null = null;
	private lastLocation: ViewLocation | null = null;
	private marginVisible = false;

	private toolbarEl!: HTMLElement;
	private mainEl!: HTMLElement;
	private scrollEl!: HTMLElement;
	private pagesEl!: HTMLElement;
	private messageEl!: HTMLElement;
	private pageInput!: HTMLInputElement;
	private pageCountEl!: HTMLElement;
	private zoomDropdown!: DropdownComponent;
	private themeBtn!: HTMLElement;
	private outlineBtn!: HTMLElement;
	private findBar: FindBar | null = null;
	private outline!: OutlinePanel;
	private built = false;
	/** Comments of the PDF shown (created with the viewer). */
	comments: CommentsController | null = null;
	/** SHA-256 of the loaded file (DECISIONS D3.3). */
	private fingerprint: string | null = null;
	private resolvedBtn!: HTMLElement;
	private areaBtn!: HTMLElement;
	private lastScale = 0;

	private saveLocation = debounce(() => this.persistLocation(), 400, true);

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: PdfCommentsPlugin,
	) {
		super(leaf);
		this.zoom = plugin.settings.defaultZoom;
		this.scope = new Scope(this.app.scope);
		this.scope.register(['Mod'], 'f', () => {
			this.openFind();
			return false;
		});
		// Inside the PDF view only (DECISIONS F1.3); the commands can get other hotkeys.
		this.scope.register(['Mod', 'Alt'], 'm', () => {
			void this.comments?.addComment();
			return false;
		});
		this.scope.register(['Mod', 'Alt'], 'h', () => {
			void this.comments?.highlightSelection();
			return false;
		});
		this.scope.register(['Mod', 'Alt'], 'c', () => {
			this.comments?.openCopyForLlm();
			return false;
		});
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getIcon(): string {
		return 'file-text';
	}

	getDisplayText(): string {
		return this.file?.basename ?? 'PDF';
	}

	canAcceptExtension(extension: string): boolean {
		return extension === 'pdf';
	}

	async onOpen(): Promise<void> {
		this.build();
		this.addAction('book-open', "Open in Obsidian's PDF viewer", () => void this.plugin.openInBuiltinViewer(this.leaf));
	}

	// ---- DOM ---------------------------------------------------------------

	private build(): void {
		if (this.built) return;
		this.built = true;
		const root = this.contentEl;
		root.empty();
		root.addClass('pdfc-view');
		root.style.setProperty('--pdfc-margin-width', `${this.plugin.settings.marginWidth}px`);
		this.applyPageTheme();

		this.toolbarEl = root.createDiv({ cls: 'pdfc-toolbar' });
		const body = root.createDiv({ cls: 'pdfc-body' });
		this.outline = new OutlinePanel(body, (item) => this.goToOutlineItem(item));
		this.mainEl = body.createDiv({ cls: 'pdfc-main pdf-container' });
		this.scrollEl = this.mainEl.createDiv({ cls: 'pdfc-scroll pdf-viewer-container', attr: { tabindex: '0' } });
		this.pagesEl = this.scrollEl.createDiv({ cls: 'pdfViewer' });
		this.messageEl = this.mainEl.createDiv({ cls: 'pdfc-message' });
		this.messageEl.hide();

		const tb = this.toolbarEl;
		this.outlineBtn = this.toolButton(tb, 'list', 'Outline', () => this.toggleOutline());
		tb.createDiv({ cls: 'pdfc-toolbar-sep' });
		const pageBox = tb.createDiv({ cls: 'pdfc-page-box' });
		this.pageInput = pageBox.createEl('input', { type: 'text', cls: 'pdfc-page-input', attr: { 'aria-label': 'Page number', inputmode: 'numeric' } });
		this.pageCountEl = pageBox.createSpan({ cls: 'pdfc-page-count' });
		this.pageInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.goToPage(parseInt(this.pageInput.value, 10));
				this.scrollEl.focus();
			} else if (e.key === 'Escape') {
				this.updatePageControls();
				this.scrollEl.focus();
			}
		});
		this.pageInput.addEventListener('focus', () => this.pageInput.select());
		this.pageInput.addEventListener('blur', () => this.updatePageControls());
		tb.createDiv({ cls: 'pdfc-toolbar-sep' });
		this.toolButton(tb, 'zoom-out', 'Zoom out', () => this.zoomStep(-1));
		this.zoomDropdown = new DropdownComponent(tb.createDiv({ cls: 'pdfc-zoom' }));
		this.zoomDropdown.onChange((v) => {
			if (v === 'page-width' || v === 'page-fit') this.setZoom(v);
			else if (v !== 'custom') this.setZoom(Number(v));
		});
		this.toolButton(tb, 'zoom-in', 'Zoom in', () => this.zoomStep(1));
		tb.createDiv({ cls: 'pdfc-toolbar-spacer' });
		this.toolButton(tb, 'message-square-plus', 'Add comment to the selected text (Ctrl+Alt+M)', () => void this.comments?.addComment());
		this.toolButton(tb, 'highlighter', 'Highlight the selected text (Ctrl+Alt+H)', () => void this.comments?.highlightSelection());
		this.areaBtn = this.toolButton(tb, 'square-dashed-mouse-pointer', 'Comment on an area (or Alt+drag)', () => this.comments?.setAreaMode(!this.comments.areaMode));
		this.resolvedBtn = this.toolButton(tb, 'check-check', 'Show resolved comments', () => this.toggleResolved());
		this.toolButton(tb, 'panel-right', 'Comments sidebar', () => void this.plugin.openSidebar());
		this.toolButton(tb, 'bot', 'Copy for LLM (Ctrl+Alt+C)', () => this.comments?.openCopyForLlm());
		tb.createDiv({ cls: 'pdfc-toolbar-sep' });
		this.toolButton(tb, 'search', 'Find', () => this.openFind());
		this.themeBtn = this.toolButton(tb, PAGE_THEME_ICONS[this.plugin.settings.pageTheme], 'Page colours', () => undefined);
		this.themeBtn.addEventListener('click', (e) => this.pageThemeMenu(e));
		this.updateZoomControl();
		this.updatePageControls();

		this.registerDomEvent(this.scrollEl, 'wheel', (e) => this.onWheel(e), { passive: false });
		this.registerDomEvent(this.scrollEl, 'mousedown', () => {
			if (this.containerEl.doc.activeElement !== this.scrollEl) this.scrollEl.focus({ preventScroll: true });
		});
	}

	private toolButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
		const b = parent.createDiv({ cls: 'clickable-icon pdfc-tool', attr: { 'aria-label': label } });
		setIcon(b, icon);
		setTooltip(b, label);
		b.addEventListener('click', onClick);
		return b;
	}

	private showMessage(text: string | null, actions: { label: string; run: () => void }[] = []): void {
		this.messageEl.empty();
		if (text === null) {
			this.messageEl.hide();
			return;
		}
		this.messageEl.createDiv({ cls: 'pdfc-message-text', text });
		if (actions.length) {
			const row = this.messageEl.createDiv({ cls: 'pdfc-message-actions' });
			for (const a of actions) row.createEl('button', { text: a.label }).addEventListener('click', a.run);
		}
		this.messageEl.show();
	}

	// ---- PDF.js setup ------------------------------------------------------

	private ensureViewer(pdfjs: PdfJs): PDFViewer {
		if (this.viewer) return this.viewer;
		this.pdfjs = pdfjs;
		const { EventBus, PDFLinkService, PDFFindController, PDFViewer, LinkTarget } = pdfjs.viewer;
		const eventBus = new EventBus();
		const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
		const findController = new PDFFindController({ eventBus, linkService });
		const viewer = new PDFViewer({
			container: this.scrollEl as HTMLDivElement,
			viewer: this.pagesEl as HTMLDivElement,
			eventBus,
			linkService,
			findController,
			textLayerMode: 1,
			annotationMode: 2,
			imageResourcesPath: LIB + 'images/',
			enableHWA: true,
			maxCanvasPixels: 16777216,
		});
		linkService.setViewer(viewer);
		this.eventBus = eventBus;
		this.linkService = linkService;
		this.findController = findController;
		this.viewer = viewer;

		const comments = new CommentsController({
			app: this.app,
			scrollEl: this.scrollEl,
			pagesEl: this.pagesEl,
			mainEl: this.mainEl,
			marginWidth: () => this.plugin.settings.marginWidth,
			pageView: (p) => this.pageView(p - 1),
			pagesCount: () => (this.doc ? viewer.pagesCount : 0),
			currentPage: () => viewer.currentPageNumber,
			setMarginVisible: (v) => this.setMarginVisible(v),
			commentDoc: (path) => this.plugin.commentDoc(path),
			highlightColor: () => this.plugin.settings.highlightColor,
			setHighlightColor: (c) => {
				this.plugin.settings.highlightColor = c;
				void this.plugin.saveSettings();
			},
			llmChoice: () => this.plugin.settings.llm,
			setLlmChoice: (c) => {
				this.plugin.settings.llm = c;
				void this.plugin.saveSettings();
			},
			openSidebar: () => void this.plugin.openSidebar(),
			changed: () => {
				this.resolvedBtn?.toggleClass('is-active', comments.showResolved);
				this.areaBtn?.toggleClass('is-active', comments.areaMode);
				this.plugin.commentsChanged(this);
			},
		});
		this.comments = comments;

		eventBus.on('pagesinit', () => this.onPagesInit());
		eventBus.on('pagechanging', () => this.updatePageControls());
		eventBus.on('scalechanging', () => {
			this.updateZoomControl();
			comments.layoutChanged();
		});
		eventBus.on('pagesloaded', () => comments.layoutChanged());
		eventBus.on('pagerendered', (e: { pageNumber: number }) => comments.pageRendered(e.pageNumber));
		// PDF.js labels each page "Page N" for screen readers (also later, when its translations
		// arrive); Obsidian shows every aria-label as a tooltip on hover (DECISIONS F1.4).
		const unlabel = (el: Element) => {
			if (el.hasClass('page') && el.hasAttribute('aria-label')) el.removeAttribute('aria-label');
		};
		const labels = new MutationObserver((records) => {
			for (const r of records) {
				if (r.type === 'attributes') unlabel(r.target as Element);
				else r.addedNodes.forEach((n) => n.instanceOf(Element) && unlabel(n));
			}
		});
		labels.observe(this.pagesEl, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
		this.register(() => labels.disconnect());
		eventBus.on('textlayerrendered', (e: { pageNumber: number }) => comments.pageRendered(e.pageNumber));
		eventBus.on('updateviewarea', (e: { location?: ViewLocation }) => {
			if (viewer.currentScale !== this.lastScale) {
				this.lastScale = viewer.currentScale;
				comments.layoutChanged();
			}
			if (!this.ready || !e.location) return;
			this.lastLocation = { pageNumber: e.location.pageNumber, top: e.location.top, left: e.location.left };
			this.saveLocation();
		});
		this.findBar = new FindBar(this.mainEl, eventBus, () => this.scrollEl.focus({ preventScroll: true }));
		return viewer;
	}

	// ---- Loading -----------------------------------------------------------

	onLoadFile(file: TFile): Promise<void> {
		this.build();
		const token = ++this.loadToken;
		this.ready = false;
		this.showMessage('Loading…');
		// Not awaited: a password prompt must not hold up Obsidian's openFile().
		// Links that arrive meanwhile wait in pendingSubpath.
		void this.loadDocument(file, token);
		return Promise.resolve();
	}

	private async loadDocument(file: TFile, token: number): Promise<void> {
		let pdfjs: PdfJs;
		try {
			pdfjs = await loadPdfJsWithViewer();
		} catch (e) {
			if (token === this.loadToken) this.showLoadError(e);
			return;
		}
		if (token !== this.loadToken) return;
		const viewer = this.ensureViewer(pdfjs);
		try {
			const data = new Uint8Array(await this.app.vault.readBinary(file));
			// Before getDocument, which may hand the buffer over to the worker.
			const fingerprint = await fingerprintOf(data);
			if (token !== this.loadToken) return;
			this.fingerprint = fingerprint;
			const task = pdfjs.lib.getDocument({ data, ...DOCUMENT_OPTIONS });
			task.onPassword = (update: (pw: string) => void, reason: number) => {
				if (token !== this.loadToken) return;
				const wrong = reason === pdfjs.lib.PasswordResponses.INCORRECT_PASSWORD;
				new PasswordModal(this.app, file.name, wrong, (pw) => {
					// Cancelled: destroying the task rejects it with a PasswordException (handled below).
					if (pw === null) void task.destroy();
					else update(pw);
				}).open();
			};
			const doc = await task.promise;
			if (token !== this.loadToken) {
				void doc.destroy();
				return;
			}
			this.doc = doc;
			viewer.setDocument(doc);
			this.linkService!.setDocument(doc, null);
			this.showMessage(null);
			void this.outline.load(doc);
		} catch (e) {
			if (token !== this.loadToken) return;
			if ((e as { name?: unknown } | null)?.name === 'PasswordException') {
				this.showMessage('This PDF is protected by a password.', [{ label: 'Enter password', run: () => void this.reload() }]);
				return;
			}
			if (e instanceof Error && /destroy|Worker was terminated/i.test(e.message)) return;
			this.showLoadError(e);
		}
	}

	private showLoadError(e: unknown): void {
		console.error('[pdf-comments]', e);
		const msg = e instanceof Error ? e.message : String(e);
		this.showMessage(`This PDF could not be opened: ${msg}`, [
			{ label: 'Try again', run: () => void this.reload() },
			{ label: "Open in Obsidian's PDF viewer", run: () => void this.plugin.openInBuiltinViewer(this.leaf) },
		]);
	}

	async onUnloadFile(file: TFile): Promise<void> {
		this.persistLocation(file.path);
		this.comments?.detach();
		this.fingerprint = null;
		this.loadToken++;
		this.ready = false;
		this.lastLocation = null;
		this.findBar?.close();
		this.outline?.clear();
		if (this.viewer && this.doc) {
			this.viewer.setDocument(null as unknown as PDFDocumentProxy);
			this.linkService?.setDocument(null, null);
		}
		const doc = this.doc;
		this.doc = null;
		if (doc) await doc.destroy();
	}

	/** Reloads the current file, keeping the position (e.g. after the PDF changed on disk). */
	async reload(): Promise<void> {
		const file = this.file;
		if (!file) return;
		await this.onUnloadFile(file);
		await this.onLoadFile(file);
	}

	private onPagesInit(): void {
		if (!this.viewer || !this.doc || !this.file) return;
		const saved = this.plugin.getFileViewState(this.file.path);
		if (saved) this.zoom = saved.zoom;
		this.applyZoom();
		const sub = this.pendingSubpath;
		this.pendingSubpath = null;
		if (sub && (sub.page || sub.selection)) this.goToSubpath(sub);
		else if (saved) {
			this.viewer.scrollPageIntoView({
				pageNumber: Math.min(saved.page, this.viewer.pagesCount),
				destArray: saved.top !== undefined ? [null, { name: 'XYZ' }, saved.left ?? 0, saved.top, null] : undefined,
				allowNegativeOffset: true,
			});
		}
		this.ready = true;
		this.updatePageControls();
		this.findBar?.refresh();
		if (this.fingerprint) this.comments?.attach(this.file.path, this.doc, this.fingerprint);
		if (sub?.comment) this.pendingComment = sub.comment;
		this.revealPendingComment();
	}

	private pendingComment: string | null = null;

	/** `#…&comment=ID`: activate the thread once comments are loaded. */
	private revealPendingComment(): void {
		const id = this.pendingComment;
		const c = this.comments;
		if (!id || !c?.doc) return;
		void c.doc.load().then(() => {
			if (this.pendingComment !== id || !c.threads[id]) return;
			this.pendingComment = null;
			c.activate(id, true);
		});
	}

	private persistLocation(path = this.file?.path): void {
		if (!path || !this.viewer || !this.ready) return;
		const loc = this.lastLocation;
		const state: FileViewState = {
			page: loc?.pageNumber ?? this.viewer.currentPageNumber,
			zoom: this.zoom,
			used: Date.now(),
		};
		if (loc) {
			state.top = Math.round(loc.top);
			state.left = Math.round(loc.left);
		}
		this.plugin.setFileViewState(path, state);
	}

	// ---- Navigation --------------------------------------------------------

	setEphemeralState(state: unknown): void {
		super.setEphemeralState(state);
		const subpath = (state as { subpath?: unknown } | null)?.subpath;
		if (typeof subpath !== 'string') return;
		const sub = parsePdfSubpath(subpath);
		if (!sub.page && !sub.comment) return;
		if (this.ready) {
			if (sub.page) this.goToSubpath(sub);
			if (sub.comment) {
				this.pendingComment = sub.comment;
				this.revealPendingComment();
			}
		} else this.pendingSubpath = sub;
	}

	goToSubpath(sub: PdfSubpath): void {
		if (!sub.page || !this.viewer) return;
		if (sub.selection) void this.selectText(sub.page, sub.selection);
		else this.goToPage(sub.page);
	}

	goToPage(page: number): void {
		const v = this.viewer;
		if (!v || !Number.isFinite(page)) return;
		v.currentPageNumber = Math.min(Math.max(1, Math.round(page)), v.pagesCount);
		this.updatePageControls();
	}

	nextPage(): void {
		this.viewer?.nextPage();
	}

	previousPage(): void {
		this.viewer?.previousPage();
	}

	focusPageInput(): void {
		this.pageInput.focus();
	}

	private goToOutlineItem(item: OutlineItem): void {
		if (item.dest) void this.linkService?.goToDestination(item.dest as string);
		else if (item.url) window.open(item.url, '_blank', 'noopener');
	}

	/** Scrolls to and selects the text of an Obsidian `selection=` reference (SPEC §3.2). */
	private async selectText(page: number, sel: TextSelectionRef): Promise<void> {
		const v = this.viewer;
		if (!v || page > v.pagesCount) return;
		v.scrollPageIntoView({ pageNumber: page });
		const textLayer = await this.waitForTextLayer(page);
		if (!textLayer) return;
		const nodeAt = (idx: number, offset: number): [Node, number] | null => {
			const span = textLayer.querySelector(`[data-idx="${idx}"]`);
			const text = span?.firstChild;
			if (!span || !text) return null;
			return [text, Math.min(offset, text.textContent?.length ?? 0)];
		};
		const start = nodeAt(sel.beginIndex, sel.beginOffset);
		const end = nodeAt(sel.endIndex, sel.endOffset);
		if (!start || !end) return;
		const range = this.containerEl.doc.createRange();
		range.setStart(start[0], start[1]);
		range.setEnd(end[0], end[1]);
		const s = this.containerEl.win.getSelection();
		s?.removeAllRanges();
		s?.addRange(range);
		(start[0].parentElement as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' });
	}

	private pageView(index: number): PDFPageView | undefined {
		return this.viewer?.getPageView(index) as PDFPageView | undefined;
	}

	private waitForTextLayer(page: number, timeoutMs = 5000): Promise<HTMLElement | null> {
		const find = () => {
			const div = this.pageView(page - 1)?.div?.querySelector<HTMLElement>('.textLayer');
			return div && div.querySelector('[data-idx]') ? div : null;
		};
		const now = find();
		if (now) return Promise.resolve(now);
		return new Promise((resolve) => {
			const bus = this.eventBus;
			if (!bus) return resolve(null);
			const done = (r: HTMLElement | null) => {
				bus.off('textlayerrendered', onRendered);
				window.clearTimeout(timer);
				resolve(r);
			};
			const onRendered = (e: { pageNumber: number }) => {
				if (e.pageNumber === page) done(find());
			};
			const timer = window.setTimeout(() => done(find()), timeoutMs);
			bus.on('textlayerrendered', onRendered);
		});
	}

	private updatePageControls(): void {
		if (!this.pageInput) return;
		const v = this.viewer;
		const n = this.doc ? (v?.pagesCount ?? 0) : 0;
		if (this.containerEl.doc.activeElement !== this.pageInput) this.pageInput.value = n ? String(v!.currentPageNumber) : '';
		this.pageCountEl.setText(n ? `/ ${n}` : '');
	}

	// ---- Zoom --------------------------------------------------------------

	getZoom(): ZoomMode {
		return this.zoom;
	}

	setZoom(mode: ZoomMode): void {
		this.zoom = mode;
		this.applyZoom();
		this.saveLocation();
	}

	zoomStep(dir: 1 | -1): void {
		if (!this.viewer) return;
		this.setZoom(stepScale(this.viewer.currentScale, dir));
	}

	resetZoom(): void {
		this.setZoom(this.plugin.settings.defaultZoom);
	}

	/** Shows or hides the comment margin (used from Phase 3); fit modes leave room for it. */
	setMarginVisible(visible: boolean): void {
		if (this.marginVisible === visible) return;
		this.marginVisible = visible;
		this.contentEl.toggleClass('pdfc-has-margin', visible);
		this.applyZoom();
	}

	marginWidthChanged(): void {
		this.contentEl.style.setProperty('--pdfc-margin-width', `${this.plugin.settings.marginWidth}px`);
		this.applyZoom();
		this.comments?.render();
	}

	private marginWidth(): number {
		return this.marginVisible ? this.plugin.settings.marginWidth : 0;
	}

	private applyZoom(): void {
		const v = this.viewer;
		if (v && this.doc && v.pagesCount) {
			const pv = this.pageView(Math.max(0, v.currentPageNumber - 1));
			const fit =
				pv && pv.scale > 0
					? {
							availWidth: this.scrollEl.clientWidth - this.marginWidth(),
							availHeight: this.scrollEl.clientHeight,
							pageWidth: pv.width / pv.scale,
							pageHeight: pv.height / pv.scale,
						}
					: null;
			const scale = scaleFor(this.zoom, fit);
			if (Math.abs(v.currentScale - scale) > 1e-3) v.currentScale = scale;
		}
		this.updateZoomControl();
	}

	private updateZoomControl(): void {
		if (!this.zoomDropdown) return;
		const select = this.zoomDropdown.selectEl;
		select.empty();
		this.zoomDropdown.addOption('page-width', 'Fit width');
		this.zoomDropdown.addOption('page-fit', 'Fit page');
		for (const p of ZOOM_PRESETS) this.zoomDropdown.addOption(String(p), percentLabel(p));
		const scale = this.viewer && this.doc ? this.viewer.currentScale : null;
		const zoom = this.zoom;
		let value: string;
		if (typeof zoom === 'string') value = zoom;
		else {
			const preset = ZOOM_PRESETS.find((p) => Math.abs(p - zoom) < 1e-3);
			if (preset !== undefined) value = String(preset);
			else {
				value = 'custom';
				this.zoomDropdown.addOption('custom', percentLabel(zoom));
			}
		}
		this.zoomDropdown.setValue(value);
		const fitOption = select.querySelector<HTMLOptionElement>(`option[value="${this.zoom}"]`);
		if (typeof this.zoom === 'string' && fitOption && scale) fitOption.text = `${this.zoom === 'page-width' ? 'Fit width' : 'Fit page'} (${percentLabel(scale)})`;
	}

	private onWheel(e: WheelEvent): void {
		if (!(e.ctrlKey || e.metaKey) || !this.viewer || !this.doc) return;
		e.preventDefault();
		const v = this.viewer;
		const target = wheelScale(v.currentScale, e.deltaY);
		if (Math.abs(target - v.currentScale) < 1e-4) return;
		v.updateScale({ scaleFactor: target / v.currentScale, origin: [e.clientX, e.clientY], drawingDelay: 250 });
		this.zoom = v.currentScale;
		this.updateZoomControl();
		this.saveLocation();
	}

	onResize(): void {
		super.onResize();
		if (this.ready && typeof this.zoom === 'string') this.applyZoom();
	}

	// ---- Toggles -----------------------------------------------------------

	openFind(): void {
		if (!this.findBar) return;
		const sel = this.containerEl.win.getSelection();
		const text = sel && !sel.isCollapsed && this.scrollEl.contains(sel.anchorNode) ? sel.toString() : undefined;
		this.findBar.open(text);
	}

	/** Applies the plugin's page colours (called for every view when they change). */
	applyPageTheme(): void {
		const { pageTheme: theme, sepiaColor, darkInvert } = this.plugin.settings;
		for (const t of PAGE_THEMES) this.contentEl.toggleClass(`pdfc-theme-${t}`, t === theme);
		this.contentEl.style.setProperty('--pdfc-sepia-paper', sepiaColor);
		this.contentEl.style.setProperty('--pdfc-dark-invert', String(darkInvert));
		if (this.themeBtn) setIcon(this.themeBtn, PAGE_THEME_ICONS[theme]);
	}

	private pageThemeMenu(e: MouseEvent): void {
		const menu = new Menu();
		for (const t of PAGE_THEMES) {
			menu.addItem((i) =>
				i
					.setTitle(PAGE_THEME_LABELS[t])
					.setIcon(PAGE_THEME_ICONS[t])
					.setChecked(t === this.plugin.settings.pageTheme)
					.onClick(() => this.plugin.setPageTheme(t)),
			);
		}
		menu.showAtMouseEvent(e);
	}

	toggleOutline(): void {
		this.outline.toggle();
		this.outlineBtn.toggleClass('is-active', this.outline.isOpen);
		if (this.ready && typeof this.zoom === 'string') this.applyZoom();
	}

	/** Current page, for switching to Obsidian's viewer at the same place. */
	currentPage(): number | null {
		return this.viewer && this.doc ? this.viewer.currentPageNumber : null;
	}

	/** For tests in the harness. */
	debugInfo(): Record<string, unknown> {
		return {
			ready: this.ready,
			zoom: this.zoom,
			scale: this.viewer?.currentScale,
			page: this.viewer?.currentPageNumber,
			pages: this.viewer?.pagesCount,
			marginVisible: this.marginVisible,
		};
	}

	toggleResolved(): void {
		this.comments?.toggleResolved();
	}

	onunload(): void {
		this.comments?.destroy();
		this.comments = null;
		this.saveLocation.run();
		super.onunload();
	}
}

/** Short SHA-256 of the file's bytes (DECISIONS D3.3). */
async function fingerprintOf(data: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
