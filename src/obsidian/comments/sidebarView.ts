// The comments sidebar (SPEC §4): the threads of the active PDF in reading order, as cards,
// with a search over quotes and comments. Used when the pane is too narrow for the margin, or
// to see all comments at once. Adapted from the Docs plugin's sidebar.

import { ItemView, SearchComponent, setIcon, type WorkspaceLeaf } from 'obsidian';
import { matchingComments } from '../../core/shared/search';
import { ThreadCard, type CardHost } from './card';
import type { CommentsController } from './controller';

export const SIDEBAR_VIEW = 'pdf-comments-sidebar';

export interface SidebarSource {
	title: string;
	controller: CommentsController;
}

export class CommentsSidebarView extends ItemView {
	private source: SidebarSource | null = null;
	private titleEl!: HTMLElement;
	private resolvedBtn!: HTMLElement;
	private statusEl!: HTMLElement;
	private listEl!: HTMLElement;
	private search!: SearchComponent;
	private query = '';
	private cards = new Map<string, ThreadCard>();
	private host: CardHost | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return SIDEBAR_VIEW;
	}

	getDisplayText(): string {
		return 'PDF comments';
	}

	getIcon(): string {
		return 'message-square-text';
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('pdfc-sidebar');
		const top = root.createDiv({ cls: 'pdfc-sidebar-top' });
		const header = top.createDiv({ cls: 'pdfc-sidebar-header' });
		this.titleEl = header.createDiv({ cls: 'pdfc-sidebar-title' });
		const actions = header.createDiv({ cls: 'pdfc-sidebar-actions' });
		this.resolvedBtn = actions.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': 'Show resolved comments' } });
		setIcon(this.resolvedBtn, 'check-check');
		this.resolvedBtn.addEventListener('click', () => this.source?.controller.toggleResolved());
		const searchEl = top.createDiv({ cls: 'pdfc-sidebar-search' });
		this.search = new SearchComponent(searchEl).setPlaceholder('Search comments').onChange((q) => {
			this.query = q.trim();
			this.render();
		});
		this.statusEl = searchEl.createDiv({ cls: 'pdfc-sidebar-search-status' });
		this.listEl = root.createDiv({ cls: 'pdfc-sidebar-list' });
		this.render();
	}

	async onClose(): Promise<void> {
		for (const c of this.cards.values()) c.destroy();
		this.cards.clear();
	}

	focusSearch(): void {
		this.search?.inputEl.focus();
	}

	setSource(source: SidebarSource | null): void {
		if (source?.controller !== this.source?.controller) {
			for (const c of this.cards.values()) c.destroy();
			this.cards.clear();
			const ctl = source?.controller;
			// In the sidebar, "activate" also scrolls the PDF to the passage.
			this.host = ctl ? { ...ctl.cardHost, activate: (id) => ctl.activate(id, true) } : null;
		}
		this.source = source;
		this.render();
	}

	render(): void {
		if (!this.listEl) return;
		const src = this.source;
		const ctl = src?.controller;
		this.titleEl.setText(src?.title ?? 'No PDF');
		this.resolvedBtn.toggleClass('is-active', !!ctl?.showResolved);
		this.contentEl.toggleClass('is-searching', this.query !== '');
		if (!ctl || !ctl.doc || !this.host) {
			this.clear('Open a PDF to see its comments.');
			return;
		}
		const threads = ctl.threads;
		const { anchored, detached } = ctl.order();
		const q = this.query.toLowerCase();
		const match = (id: string) => {
			if (!q) return true;
			const t = threads[id]!;
			return t.quote.toLowerCase().includes(q) || matchingComments(t, this.query).length > 0;
		};
		const shownAnchored = anchored.filter(match);
		const shownDetached = detached.filter(match);
		const total = anchored.length + detached.length;
		this.statusEl.setText(q ? `${shownAnchored.length + shownDetached.length} of ${total} threads match` : '');
		if (!total) {
			this.clear(ctl.showResolved ? 'This PDF has no comments yet. Select text and use "Add comment".' : 'No open comments. Select text and use "Add comment".');
			return;
		}
		this.listEl.querySelector('.pdfc-sidebar-empty')?.remove();
		const wanted = new Set([...shownAnchored, ...shownDetached]);
		for (const [id, card] of this.cards) {
			if (!wanted.has(id)) {
				card.destroy();
				this.cards.delete(id);
			}
		}
		let header = this.listEl.querySelector<HTMLElement>(':scope > .pdfc-detached-header');
		const order = [...shownAnchored, ...(shownDetached.length ? ['__header__'] : []), ...shownDetached];
		let prev: Element | null = null;
		for (const id of order) {
			let el: HTMLElement;
			if (id === '__header__') {
				header ??= createDiv({ cls: 'pdfc-detached-header' });
				header.setText(`Detached comments (${shownDetached.length})`);
				el = header;
			} else {
				let card = this.cards.get(id);
				if (!card) {
					card = new ThreadCard(this.host, id, 'sidebar');
					this.cards.set(id, card);
				}
				const t = threads[id]!;
				card.render(t, { active: ctl.activeId === id, detached: shownDetached.includes(id), showQuote: true, quote: t.quote });
				el = card.el;
			}
			// Keep DOM order without re-inserting unchanged nodes (that would lose focus).
			const expected: Element | null = prev ? prev.nextElementSibling : this.listEl.firstElementChild;
			if (expected !== el) this.listEl.insertBefore(el, expected);
			prev = el;
		}
		if (header && !shownDetached.length) header.remove();
		if (ctl.activeId) this.cards.get(ctl.activeId)?.el.scrollIntoView({ block: 'nearest' });
	}

	private clear(message: string): void {
		for (const c of this.cards.values()) c.destroy();
		this.cards.clear();
		this.listEl.empty();
		this.listEl.createDiv({ cls: 'pdfc-sidebar-empty', text: message });
		this.statusEl.setText('');
	}
}
