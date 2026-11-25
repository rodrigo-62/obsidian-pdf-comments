// PDF Comments: plugin entry (SPEC §3, §7).

import { FileView, Notice, Plugin, TFile, WorkspaceLeaf, debounce, type ViewState } from 'obsidian';
import { around } from 'monkey-around';
import { deleteViewState, putViewState, renameViewState, sanitizeViewStates, type FileViewState, type ViewStateMap } from '../core/viewStates';
import { PdfCommentsView, VIEW_TYPE } from './pdfView';
import { CommentDoc } from './comments/commentDoc';
import { NoteStore } from './comments/noteStore';
import { CommentsSidebarView, SIDEBAR_VIEW } from './comments/sidebarView';
import { DEFAULT_SETTINGS, PAGE_THEME_LABELS, PAGE_THEMES, PdfCommentsSettingTab, sanitizeSettings, type PageTheme, type PdfCommentsSettings } from './settings';

/** Obsidian's own PDF view type. */
const BUILTIN_PDF = 'pdf';

interface PluginData {
	settings: PdfCommentsSettings;
	viewStates: ViewStateMap;
}

export default class PdfCommentsPlugin extends Plugin {
	settings: PdfCommentsSettings = { ...DEFAULT_SETTINGS };
	private viewStates: ViewStateMap = {};
	/** Leaves the user switched to Obsidian's viewer: not redirected while they stay so. */
	private builtinLeaves = new WeakSet<WorkspaceLeaf>();
	/** Header buttons added to Obsidian's PDF views, removed on unload. */
	private builtinActions = new Map<FileView, HTMLElement>();
	/** Set while unloading, so handing tabs back to Obsidian's viewer is not redirected. */
	private unloading = false;
	private requestSave = debounce(() => void this.persist(), 1000, true);
	notes!: NoteStore;
	/** Comments per PDF path, shared by the views of that PDF. */
	private docs = new Map<string, CommentDoc>();
	/** The PDF view the comments sidebar follows. */
	private sidebarSource: PdfCommentsView | null = null;

	async onload(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Partial<PluginData>;
		this.settings = sanitizeSettings(raw.settings);
		this.viewStates = sanitizeViewStates(raw.viewStates);

		// Registered before the view: Obsidian runs cleanups in order, before onunload(), and
		// unregistering the view empties its tabs. Hand them to Obsidian's viewer first.
		this.register(() => this.handBackTabs());
		this.registerView(VIEW_TYPE, (leaf) => new PdfCommentsView(leaf, this));
		this.registerView(SIDEBAR_VIEW, (leaf) => new CommentsSidebarView(leaf));
		this.notes = new NoteStore({
			app: this.app,
			folder: () => this.settings.commentsFolder,
			renameNotesWithPdfs: () => this.settings.renameNotesWithPdfs,
			noteChanged: (pdf) => void this.docs.get(pdf)?.load(true),
			digestOverwritten: (note) => new Notice(`"${note.basename}" is generated from the comments: your edits to its text were replaced. Comment in the PDF view instead.`, 8000),
		});
		this.registerCommentEvents();
		this.addSettingTab(new PdfCommentsSettingTab(this.app, this));
		this.patchOpening();
		this.registerCommands();

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== 'pdf') return;
				menu.addItem((item) =>
					item
						.setTitle('Open with comments')
						.setIcon('message-square-text')
						.setSection('open')
						.onClick(() => void this.openFileWithComments(file)),
				);
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && file.extension === 'pdf') {
					this.viewStates = renameViewState(this.viewStates, oldPath, file.path);
					this.requestSave();
					const doc = this.docs.get(oldPath);
					if (doc) {
						this.docs.delete(oldPath);
						doc.pdfPath = file.path;
						this.docs.set(file.path, doc);
					}
					for (const v of this.ourViews()) if (v.file === file && v.comments) v.comments.pdfPath = file.path;
					void this.notes.pdfRenamed(file, oldPath).catch((e) => console.error('[pdf-comments]', e));
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && file.extension === 'pdf') {
					this.viewStates = deleteViewState(this.viewStates, file.path);
					this.requestSave();
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (!(file instanceof TFile) || file.extension !== 'pdf') return;
				for (const view of this.ourViews()) if (view.file === file) void view.reload();
			}),
		);
		this.registerEvent(this.app.workspace.on('layout-change', () => this.decorateBuiltinViews()));
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof PdfCommentsView && leaf.view !== this.sidebarSource) {
					this.sidebarSource = leaf.view;
					this.refreshSidebars();
				}
			}),
		);
		this.app.workspace.onLayoutReady(() => {
			this.notes.rebuild();
			for (const doc of this.docs.values()) void doc.load(true);
			this.decorateBuiltinViews();
			// PDFs restored in Obsidian's viewer before the plugin loaded.
			if (this.settings.openByDefault) for (const leaf of this.app.workspace.getLeavesOfType(BUILTIN_PDF)) void this.openWithComments(leaf, false);
		});
	}

	onunload(): void {
		this.requestSave.run();
		for (const el of this.builtinActions.values()) el.remove();
		this.builtinActions.clear();
	}

	/**
	 * Gives our tabs back to Obsidian's viewer rather than leaving empty tabs (plugin disabled).
	 * Obsidian empties the tabs of an unregistered view type some time after this cleanup runs,
	 * so the files and pages are noted now and each tab is reopened once it has been emptied
	 * (deferred background tabs at once; at most 1 s later in any case).
	 */
	private handBackTabs(): void {
		this.unloading = true;
		const tabs = this.app.workspace.getLeavesOfType(VIEW_TYPE).flatMap((leaf) => {
			const path = leafFilePath(leaf);
			const page = leaf.view instanceof PdfCommentsView ? leaf.view.currentPage() : null;
			return path ? [{ leaf, path, page, done: false }] : [];
		});
		if (!tabs.length) return;
		const deadline = Date.now() + 1000;
		const tick = () => {
			let waiting = false;
			for (const t of tabs) {
				if (t.done) continue;
				const type = t.leaf.view?.getViewType();
				const deferred = (t.leaf as unknown as { isDeferred?: boolean }).isDeferred === true;
				if (type === VIEW_TYPE && !deferred && Date.now() < deadline) {
					waiting = true;
					continue;
				}
				t.done = true;
				if (type !== 'empty' && type !== VIEW_TYPE) continue; // the user already put something else there
				void t.leaf.setViewState({ type: BUILTIN_PDF, state: { file: t.path } }, t.page ? { subpath: `#page=${t.page}` } : undefined);
			}
			if (waiting) window.setTimeout(tick, 50);
		};
		window.setTimeout(tick, 0);
	}

	// ---- Comments ---------------------------------------------------------------

	commentDoc(pdfPath: string): CommentDoc {
		let doc = this.docs.get(pdfPath);
		if (!doc) {
			doc = new CommentDoc(this.app, this.notes, pdfPath);
			this.docs.set(pdfPath, doc);
		}
		return doc;
	}

	/** Keeps the note index and the open PDFs' comments in step with the vault (DECISIONS D3.2). */
	private registerCommentEvents(): void {
		this.registerEvent(
			this.app.metadataCache.on('changed', (file, data) => {
				if (file.extension !== 'md') return;
				const before = this.notes.pdfForNote(file.path);
				const after = this.notes.index(file);
				if (this.notes.isOwnWrite(file, data)) return;
				for (const pdf of new Set([before, after])) if (pdf) void this.docs.get(pdf)?.load(true);
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				const pdf = this.notes.forget(file.path);
				if (pdf) void this.docs.get(pdf)?.load(true);
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				const pdf = this.notes.forget(oldPath);
				this.notes.index(file);
				if (pdf) void this.docs.get(pdf)?.load(true);
			}),
		);
	}

	/** A view's comments or comment UI changed. */
	commentsChanged(view: PdfCommentsView): void {
		if (!this.sidebarSource || this.sidebarSource === view || !this.sidebarSource.leaf.parent) {
			this.sidebarSource = view;
			this.refreshSidebars();
		}
	}

	private refreshSidebars(): void {
		const v = this.sidebarSource;
		const src = v?.comments && v.file ? { title: v.file.basename, controller: v.comments } : null;
		for (const leaf of this.app.workspace.getLeavesOfType(SIDEBAR_VIEW)) {
			if (leaf.view instanceof CommentsSidebarView) leaf.view.setSource(src);
		}
	}

	async openSidebar(focusSearch = false): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW)[0];
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false) ?? undefined;
			if (!leaf) return;
			await leaf.setViewState({ type: SIDEBAR_VIEW, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
		this.refreshSidebars();
		if (focusSearch && leaf.view instanceof CommentsSidebarView) leaf.view.focusSearch();
	}

	marginWidthChanged(): void {
		for (const v of this.ourViews()) v.marginWidthChanged();
	}

	// ---- Data ----------------------------------------------------------------

	async saveSettings(): Promise<void> {
		await this.persist();
	}

	/** Page colours for every PDF view (DECISIONS D3.1). */
	setPageTheme(theme: PageTheme): void {
		this.settings.pageTheme = theme;
		for (const v of this.ourViews()) v.applyPageTheme();
		void this.saveSettings();
	}

	cyclePageTheme(): void {
		const i = PAGE_THEMES.indexOf(this.settings.pageTheme);
		this.setPageTheme(PAGE_THEMES[(i + 1) % PAGE_THEMES.length]!);
	}

	private async persist(): Promise<void> {
		const data: PluginData = { settings: this.settings, viewStates: this.viewStates };
		await this.saveData(data);
	}

	getFileViewState(path: string): FileViewState | undefined {
		return this.viewStates[path];
	}

	setFileViewState(path: string, state: FileViewState): void {
		this.viewStates = putViewState(this.viewStates, path, state);
		this.requestSave();
	}

	// ---- Opening ---------------------------------------------------------------

	/** Sends PDFs to our view whenever Obsidian would open them in its own (SPEC §3.2). */
	private patchOpening(): void {
		// eslint-disable-next-line @typescript-eslint/no-this-alias -- the patched function needs both the leaf (its `this`) and the plugin
		const plugin = this;
		this.register(
			around(WorkspaceLeaf.prototype, {
				setViewState(next) {
					return function (this: WorkspaceLeaf, viewState: ViewState, eState?: unknown) {
						if (viewState?.type === BUILTIN_PDF && plugin.settings.openByDefault && !plugin.unloading && !plugin.builtinLeaves.has(this)) {
							viewState = { ...viewState, type: VIEW_TYPE };
						}
						return next.call(this, viewState, eState);
					};
				},
			}),
		);
	}

	/** Our loaded views (deferred background tabs have no view yet). */
	private ourViews(): PdfCommentsView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE)
			.map((l) => l.view)
			.filter((v): v is PdfCommentsView => v instanceof PdfCommentsView);
	}

	async openFileWithComments(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		this.builtinLeaves.delete(leaf);
		await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
	}

	/** Switches a leaf showing Obsidian's PDF view to ours, at the same page. */
	async openWithComments(leaf: WorkspaceLeaf, activate = true): Promise<void> {
		const path = leafFilePath(leaf);
		if (!path) return;
		const page = builtinCurrentPage(leaf);
		this.builtinLeaves.delete(leaf);
		await leaf.setViewState({ type: VIEW_TYPE, state: { file: path }, active: activate }, page ? { subpath: `#page=${page}` } : undefined);
	}

	/** Switches a leaf showing our view to Obsidian's, at the same page. */
	async openInBuiltinViewer(leaf: WorkspaceLeaf): Promise<void> {
		const view = leaf.view;
		if (!(view instanceof PdfCommentsView) || !view.file) return;
		const page = view.currentPage();
		this.builtinLeaves.add(leaf);
		await leaf.setViewState({ type: BUILTIN_PDF, state: { file: view.file.path }, active: true }, page ? { subpath: `#page=${page}` } : undefined);
	}

	private decorateBuiltinViews(): void {
		for (const [view, el] of this.builtinActions) {
			if (view.leaf.view !== view) {
				el.remove();
				this.builtinActions.delete(view);
			}
		}
		for (const leaf of this.app.workspace.getLeavesOfType(BUILTIN_PDF)) {
			const view = leaf.view;
			if (!(view instanceof FileView) || this.builtinActions.has(view)) continue; // deferred tabs: decorated once loaded
			const el = view.addAction('message-square-text', 'Open with comments', () => void this.openWithComments(leaf));
			this.builtinActions.set(view, el);
		}
	}

	// ---- Commands --------------------------------------------------------------

	private registerCommands(): void {
		const withView = (id: string, name: string, run: (v: PdfCommentsView) => void) =>
			this.addCommand({
				id,
				name,
				checkCallback: (checking) => {
					const view = this.app.workspace.getActiveViewOfType(PdfCommentsView);
					if (!view) return false;
					if (!checking) run(view);
					return true;
				},
			});

		this.addCommand({
			id: 'open-with-comments',
			name: 'Open PDF with comments',
			checkCallback: (checking) => {
				const leaf = this.app.workspace.getMostRecentLeaf();
				if (leaf?.view.getViewType() === BUILTIN_PDF) {
					if (!checking) void this.openWithComments(leaf);
					return true;
				}
				const file = this.app.workspace.getActiveFile();
				if (file?.extension === 'pdf' && leaf?.view.getViewType() !== VIEW_TYPE) {
					if (!checking) void this.openFileWithComments(file);
					return true;
				}
				return false;
			},
		});
		withView('open-in-builtin-viewer', "Open in Obsidian's PDF viewer", (v) => void this.openInBuiltinViewer(v.leaf));
		withView('find', 'Find in PDF', (v) => v.openFind());
		withView('go-to-page', 'Go to page', (v) => v.focusPageInput());
		withView('next-page', 'Next page', (v) => v.nextPage());
		withView('previous-page', 'Previous page', (v) => v.previousPage());
		withView('zoom-in', 'Zoom in', (v) => v.zoomStep(1));
		withView('zoom-out', 'Zoom out', (v) => v.zoomStep(-1));
		withView('zoom-reset', 'Reset zoom', (v) => v.resetZoom());
		withView('zoom-fit-width', 'Zoom: fit width', (v) => v.setZoom('page-width'));
		withView('zoom-fit-page', 'Zoom: fit page', (v) => v.setZoom('page-fit'));
		this.addCommand({ id: 'cycle-page-colours', name: 'Page colours: next (normal, sepia, dark)', callback: () => this.cyclePageTheme() });
		for (const t of PAGE_THEMES) this.addCommand({ id: `page-colours-${t}`, name: `Page colours: ${PAGE_THEME_LABELS[t].toLowerCase()}`, callback: () => this.setPageTheme(t) });
		withView('toggle-outline', 'Toggle outline', (v) => v.toggleOutline());

		const withSelection = (id: string, name: string, run: (v: PdfCommentsView) => void) =>
			this.addCommand({
				id,
				name,
				checkCallback: (checking) => {
					const view = this.app.workspace.getActiveViewOfType(PdfCommentsView);
					if (!view?.comments?.hasSelection()) return false;
					if (!checking) run(view);
					return true;
				},
			});
		withSelection('add-comment', 'Add comment to the selected text', (v) => void v.comments?.addComment());
		withSelection('copy-link-to-selection', 'Copy link to selection', (v) => void v.comments?.copyLinkToSelection());
		withView('next-comment', 'Go to next comment', (v) => v.comments?.step(1));
		withView('previous-comment', 'Go to previous comment', (v) => v.comments?.step(-1));
		withView('toggle-resolved', 'Show or hide resolved comments', (v) => v.toggleResolved());
		this.addCommand({ id: 'open-comments-sidebar', name: 'Open comments sidebar', callback: () => void this.openSidebar() });
		this.addCommand({ id: 'search-comments', name: 'Search comments', callback: () => void this.openSidebar(true) });
		withView('open-comment-note', 'Open the comment note of this PDF', (v) => {
			const note = v.file ? this.notes.noteFileFor(v.file.path) : null;
			if (note) void this.app.workspace.getLeaf('split').openFile(note);
			else new Notice('This PDF has no comments yet.');
		});
	}
}

/** The file a leaf shows, also for a deferred (not yet loaded) background tab. */
function leafFilePath(leaf: WorkspaceLeaf): string | null {
	if (leaf.view instanceof FileView && leaf.view.file) return leaf.view.file.path;
	const file = (leaf.getViewState().state as { file?: unknown } | undefined)?.file;
	return typeof file === 'string' ? file : null;
}

/** Page shown by Obsidian's own PDF view (internal API, guarded). */
function builtinCurrentPage(leaf: WorkspaceLeaf): number | null {
	const v = leaf.view as unknown as { viewer?: { child?: { pdfViewer?: { pdfViewer?: { currentPageNumber?: unknown } } } } };
	const n = v.viewer?.child?.pdfViewer?.pdfViewer?.currentPageNumber;
	return typeof n === 'number' && n >= 1 ? n : null;
}
