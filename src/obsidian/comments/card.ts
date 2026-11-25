// Adapted from the Docs plugin (obsidian/margin/card.ts, commit 13957fe): CSS prefix folio- → pdfc-, imports.
// "SPEC §" and "DECISIONS" references below are to the Docs plugin's documents.

// A comment thread card (SPEC §5.1, §5.5), used in the margin and the sidebar.
// Plain DOM via Obsidian's createEl helpers. Comment bodies are Markdown.

import { App, Component, MarkdownRenderer, Menu, Modal, Notice, setIcon, Setting } from 'obsidian';
import { excerpt, flatView, prepareCommentMarkdown, PRIORITIES, PRIORITY_LABELS, rootComment, threadPriority, treeRows, type Comment, type ParentChip, type Priority, type Thread } from '../../core/shared/model';
import { createComposer, type Composer } from './composer';
import { showMenu } from './menus';

export interface CardHost {
	app: App;
	sourcePath(): string;
	/** Perform an operation; return false if it couldn't be applied. */
	reply(id: string, parentId: string | null, body: string): boolean;
	edit(id: string, commentId: string, body: string): boolean;
	deleteComment(id: string, commentId: string): boolean;
	deleteThread(id: string): boolean;
	resolve(id: string, resolved: boolean): boolean;
	setPriority(id: string, priority: Priority): boolean;
	/** Select/scroll to the thread's text and make it active. */
	activate(id: string): void;
	/** Scroll the editor so the thread's text is in the middle of the view, and select it. */
	goTo(id: string): void;
	/** Copy a link to the thread (PDF Comments). */
	copyLink?: (id: string) => void;
	hover(id: string | null): void;
	/** Tree view on/off for a thread (session state). */
	isTree(id: string): boolean;
	setTree(id: string, tree: boolean): void;
	/** Card size may have changed (re-layout). */
	changed(): void;
}

export interface CardState {
	active: boolean;
	detached: boolean;
	/** Show the anchored quote above the comments (sidebar, detached). */
	showQuote: boolean;
	quote: string;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function shortDate(iso: string): string {
	const d = new Date(iso);
	if (isNaN(d.getTime())) return '';
	const now = new Date();
	if (d.toDateString() === now.toDateString()) return timeFmt.format(d);
	if (d.getFullYear() === now.getFullYear()) return `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
	return d.toISOString().slice(0, 10);
}

function fullDate(iso: string): string {
	const d = new Date(iso);
	return isNaN(d.getTime()) ? iso : fullFmt.format(d);
}

/** setDestructive() exists from Obsidian 1.13; older versions only have setWarning(). */
function destructive<T extends { setWarning(): T }>(b: T): T {
	const d = (b as unknown as { setDestructive?: () => T }).setDestructive;
	return d ? d.call(b) : b.setWarning();
}

export class ConfirmModal extends Modal {
	constructor(app: App, private message: string, private cta: string, private onYes: () => void) {
		super(app);
	}
	onOpen(): void {
		this.setTitle(this.message);
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) =>
				destructive(b)
					.setButtonText(this.cta)
					.onClick(() => {
						this.close();
						this.onYes();
					}),
			);
	}
	onClose(): void {
		this.contentEl.empty();
	}
}

function iconButton(parent: HTMLElement, icon: string, label: string, cls = ''): HTMLElement {
	const b = parent.createEl('button', { cls: `pdfc-icon-btn clickable-icon ${cls}`.trim(), attr: { 'aria-label': label, type: 'button' } });
	setIcon(b, icon);
	return b;
}

export class ThreadCard {
	readonly el: HTMLElement;
	private component = new Component();
	private headerEl: HTMLElement;
	private quoteEl: HTMLElement;
	private listEl: HTMLElement;
	private footerEl: HTMLElement;
	private thread: Thread | null = null;
	private state: CardState | null = null;
	private tree = false;
	private collapsed = new Set<string>();
	private editing: string | null = null;
	private replyTarget: string | null = null;
	private replyComposer: Composer | null = null;
	private replyTargetEl: HTMLElement | null = null;
	/** Rendered bodies, reused while the body text is unchanged. */
	private bodies = new Map<string, { body: string; el: HTMLElement }>();
	private renderKey = '';

	constructor(private host: CardHost, readonly id: string, private mode: 'margin' | 'sidebar') {
		this.component.load();
		this.el = createDiv({ cls: `pdfc-card pdfc-card-${mode}`, attr: { 'data-pdfc-id': id, tabindex: '-1' } });
		this.headerEl = this.el.createDiv({ cls: 'pdfc-card-header' });
		this.quoteEl = this.el.createDiv({ cls: 'pdfc-card-quote' });
		this.listEl = this.el.createDiv({ cls: 'pdfc-card-comments' });
		this.footerEl = this.el.createDiv({ cls: 'pdfc-card-footer' });
		this.el.addEventListener('mouseenter', () => host.hover(id));
		this.el.addEventListener('mouseleave', () => host.hover(null));
		this.el.addEventListener('click', (e) => {
			const t = e.target as HTMLElement;
			if (t.closest('button, textarea, input, a, .pdfc-chip, .pdfc-tree-toggle, .pdfc-more')) return;
			if (window.getSelection()?.toString()) return; // selecting text inside the card
			host.activate(id);
		});
		this.el.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
				this.el.blur();
			}
		});
	}

	destroy(): void {
		this.component.unload();
		this.el.remove();
	}

	/** Re-render if the thread or state changed. */
	render(thread: Thread, state: CardState): void {
		const tree = this.host.isTree(this.id);
		const key = `${state.active}|${state.detached}|${state.showQuote}|${state.quote}|${tree}|${this.editing}|${[...this.collapsed].join(',')}`;
		if (thread === this.thread && key === this.renderKey) return;
		const threadChanged = thread !== this.thread;
		this.thread = thread;
		this.state = state;
		this.tree = tree;
		this.renderKey = key;
		this.el.toggleClass('is-active', state.active);
		this.el.toggleClass('is-resolved', thread.resolved);
		this.el.toggleClass('is-detached', state.detached);
		const priority = threadPriority(thread);
		for (const p of PRIORITIES) this.el.toggleClass(`pdfc-priority-${p}`, p === priority);
		this.el.toggleClass('is-tree', tree);
		if (threadChanged && this.replyTarget && !thread.comments.some((c) => c.id === this.replyTarget)) this.replyTarget = null;
		this.renderHeader(thread);
		this.renderQuote(state);
		this.renderComments(thread, state);
		this.renderFooter(thread, state);
		this.host.changed();
	}

	focusReply(): void {
		this.replyComposer?.focus();
	}

	// --- parts ----------------------------------------------------------------

	private renderHeader(thread: Thread): void {
		const h = this.headerEl;
		h.empty();
		const root = rootComment(thread);
		const meta = h.createDiv({ cls: 'pdfc-card-meta' });
		const priority = threadPriority(thread);
		if (priority !== 'normal') meta.createSpan({ cls: `pdfc-badge pdfc-priority-badge is-${priority}`, text: PRIORITY_LABELS[priority], attr: { 'aria-label': `${PRIORITY_LABELS[priority]} priority` } });
		if (thread.resolved) meta.createSpan({ cls: 'pdfc-badge', text: 'Resolved' });
		if (this.state?.detached) meta.createSpan({ cls: 'pdfc-badge pdfc-badge-detached', text: 'Detached', attr: { 'aria-label': 'The passage was not found in the current version of the PDF' } });
		if (root) meta.createSpan({ cls: 'pdfc-date', text: shortDate(root.created), attr: { 'aria-label': fullDate(root.created) } });
		const actions = h.createDiv({ cls: 'pdfc-card-actions' });
		if (thread.comments.length > 1) {
			const t = iconButton(actions, this.tree ? 'list' : 'git-branch', this.tree ? 'Show replies in time order' : 'Show replies as a tree', 'pdfc-tree-btn');
			t.addEventListener('click', (e) => {
				e.stopPropagation();
				this.host.setTree(this.id, !this.tree);
			});
		}
		if (thread.resolved) {
			const b = iconButton(actions, 'rotate-ccw', 'Re-open');
			b.addEventListener('click', (e) => {
				e.stopPropagation();
				this.host.resolve(this.id, false);
			});
		} else {
			const b = iconButton(actions, 'check', 'Resolve', 'pdfc-resolve-btn');
			b.addEventListener('click', (e) => {
				e.stopPropagation();
				this.host.resolve(this.id, true);
			});
		}
		const more = iconButton(actions, 'more-vertical', 'More');
		more.addEventListener('click', (e) => {
			e.stopPropagation();
			const menu = new Menu();
			if (root) menu.addItem((i) => i.setTitle('Edit comment').setIcon('pencil').onClick(() => this.startEdit(root.id)));
			if (root && !thread.resolved && thread.comments.length > 1) menu.addItem((i) => i.setTitle('Reply to the first comment').setIcon('reply').onClick(() => this.setReplyTarget(root.id)));
			menu.addItem((i) => i.setTitle(this.tree ? 'Show in time order' : 'Show as tree').setIcon('git-branch').onClick(() => this.host.setTree(this.id, !this.tree)));
			const copyLink = this.host.copyLink;
			if (copyLink) menu.addItem((i) => i.setTitle('Copy link to this comment').setIcon('link').onClick(() => copyLink(this.id)));
			this.priorityItems(menu, thread);
			menu.addSeparator();
			menu.addItem((i) =>
				i
					.setTitle('Delete thread')
					.setIcon('trash')
					.setWarning(true)
					.onClick(() => this.confirmDeleteThread()),
			);
			showMenu(menu, e);
		});
	}

	private renderQuote(state: CardState): void {
		this.quoteEl.empty();
		const show = state.showQuote || state.detached;
		this.quoteEl.toggle(show && !!state.quote);
		if (show && state.quote) this.quoteEl.setText(excerpt(state.quote, this.mode === 'sidebar' ? 140 : 90));
	}

	private renderComments(thread: Thread, state: CardState): void {
		const list = this.listEl;
		list.empty();
		const used = new Set<string>();
		const compact = this.mode === 'margin' && !state.active;
		if (this.tree) {
			const rows = treeRows(thread, this.collapsed);
			const visible = compact ? rows.slice(0, 1) : rows;
			for (const r of visible) {
				const row = this.commentRow(list, r.comment, r.chip, compact);
				row.style.setProperty('--pdfc-indent', String(r.indent));
				row.addClass('pdfc-tree-row');
				row.toggleClass('is-indented', r.indent > 0);
				// no toggle on the first comment: collapsing it would hide the whole thread
				if (r.childCount > 0 && !compact && r.depth > 0) {
					const meta = row.querySelector<HTMLElement>(':scope > .pdfc-comment-meta')!;
					const tog = createSpan({ cls: 'pdfc-tree-toggle', text: r.collapsed ? `▸ ${r.hiddenCount} repl${r.hiddenCount === 1 ? 'y' : 'ies'}` : '▾', attr: { 'aria-label': r.collapsed ? 'Show replies' : 'Hide replies' } });
					const acts = meta.querySelector(':scope > .pdfc-comment-actions');
					meta.insertBefore(tog, acts);
					tog.addEventListener('click', (e) => {
						e.stopPropagation();
						if (this.collapsed.has(r.comment.id)) this.collapsed.delete(r.comment.id);
						else this.collapsed.add(r.comment.id);
						this.rerender();
					});
				}
				used.add(r.comment.id);
			}
			if (compact && rows.length > 1) this.moreLine(list, rows.length - 1);
		} else {
			const items = flatView(thread);
			let visible = items;
			let hidden = 0;
			if (compact && items.length > 2) {
				visible = [items[0]!, items[items.length - 1]!];
				hidden = items.length - 2;
			}
			visible.forEach((it, i) => {
				if (i === 1 && hidden) this.moreLine(list, hidden);
				this.commentRow(list, it.comment, it.chip, compact);
				used.add(it.comment.id);
			});
		}
		for (const id of [...this.bodies.keys()]) if (!thread.comments.some((c) => c.id === id)) this.bodies.delete(id);
	}

	private moreLine(list: HTMLElement, n: number): void {
		const m = list.createDiv({ cls: 'pdfc-more', text: `${n} more repl${n === 1 ? 'y' : 'ies'}` });
		m.addEventListener('click', (e) => {
			e.stopPropagation();
			this.host.activate(this.id);
		});
	}

	private commentRow(list: HTMLElement, c: Comment, chip: ParentChip | null, compact: boolean): HTMLElement {
		const row = list.createDiv({ cls: 'pdfc-comment', attr: { 'data-cid': c.id } });
		if (compact) row.addClass('is-compact');
		const isRoot = c.parent === null;
		// Double-click or right-click: a small menu for this comment.
		const openMenu = (e: MouseEvent) => {
			if ((e.target as HTMLElement).closest('textarea, button, a')) return;
			e.preventDefault();
			e.stopPropagation();
			window.getSelection()?.removeAllRanges();
			showMenu(this.commentMenu(c, isRoot), e);
		};
		row.addEventListener('dblclick', openMenu);
		row.addEventListener('contextmenu', openMenu);
		const meta = row.createDiv({ cls: 'pdfc-comment-meta' });
		if (!isRoot) meta.createSpan({ cls: 'pdfc-date', text: shortDate(c.created), attr: { 'aria-label': fullDate(c.created) } });
		if (c.edited) meta.createSpan({ cls: 'pdfc-edited', text: '(edited)', attr: { 'aria-label': `Edited ${fullDate(c.edited)}` } });
		// The root comment's actions live in the header (⋯ menu); replies get their own.
		if (!compact && !this.thread?.resolved && !isRoot) {
			const acts = meta.createDiv({ cls: 'pdfc-comment-actions' });
			const reply = iconButton(acts, 'reply', 'Reply to this comment');
			reply.addEventListener('click', (e) => {
				e.stopPropagation();
				this.setReplyTarget(c.id);
			});
			const edit = iconButton(acts, 'pencil', 'Edit');
			edit.addEventListener('click', (e) => {
				e.stopPropagation();
				this.startEdit(c.id);
			});
			const del = iconButton(acts, 'trash', isRoot ? 'Delete thread' : 'Delete');
			del.addEventListener('click', (e) => {
				e.stopPropagation();
				if (isRoot) this.confirmDeleteThread();
				else this.host.deleteComment(this.id, c.id);
			});
		}
		if (chip) {
			const ch = row.createDiv({ cls: 'pdfc-chip', text: `↳ re: “${chip.excerpt}”`, attr: { 'aria-label': 'Show the comment this replies to' } });
			ch.addEventListener('click', (e) => {
				e.stopPropagation();
				this.flashComment(chip.parentId);
			});
		}
		if (this.editing === c.id) {
			const comp = createComposer(row, {
				initial: c.body,
				submitLabel: 'Save',
				autofocus: true,
				app: this.host.app,
				onSubmit: (text) => {
					this.editing = null;
					if (text.trim() !== c.body.trim()) this.host.edit(this.id, c.id, text);
					else this.rerender();
				},
				onCancel: () => {
					this.editing = null;
					this.rerender();
				},
			});
			comp.el.addClass('pdfc-edit-composer');
		} else {
			row.appendChild(this.body(c));
		}
		return row;
	}

	private body(c: Comment): HTMLElement {
		const cached = this.bodies.get(c.id);
		if (cached && cached.body === c.body) return cached.el;
		const el = createDiv({ cls: 'pdfc-comment-body markdown-rendered' });
		void MarkdownRenderer.render(this.host.app, prepareCommentMarkdown(c.body), el, this.host.sourcePath(), this.component).then(() => this.host.changed());
		el.addEventListener('click', (e) => {
			const a = (e.target as HTMLElement).closest('a');
			if (!a) return;
			e.preventDefault();
			e.stopPropagation();
			const href = a.getAttribute('data-href') ?? a.getAttribute('href') ?? '';
			if (a.hasClass('internal-link')) void this.host.app.workspace.openLinkText(href, this.host.sourcePath(), e.ctrlKey || e.metaKey);
			else if (href) window.open(href, '_blank');
		});
		this.bodies.set(c.id, { body: c.body, el });
		return el;
	}

	private commentMenu(c: Comment, isRoot: boolean): Menu {
		const t = this.thread;
		const menu = new Menu();
		if (t && !t.resolved) {
			menu.addItem((i) => i.setTitle('Reply to this comment').setIcon('reply').onClick(() => this.setReplyTarget(c.id)));
			menu.addItem((i) => i.setTitle('Edit').setIcon('pencil').onClick(() => this.startEdit(c.id)));
		}
		menu.addItem((i) =>
			i
				.setTitle('Copy text')
				.setIcon('copy')
				.onClick(() => void navigator.clipboard.writeText(c.body).then(() => new Notice('Comment copied'))),
		);
		menu.addItem((i) => i.setTitle('Go to the commented text').setIcon('locate').onClick(() => this.host.goTo(this.id)));
		const copyLink = this.host.copyLink;
		if (copyLink) menu.addItem((i) => i.setTitle('Copy link to this comment').setIcon('link').onClick(() => copyLink(this.id)));
		if (t) this.priorityItems(menu, t);
		menu.addSeparator();
		if (t) menu.addItem((i) => i.setTitle(t.resolved ? 'Re-open thread' : 'Resolve thread').setIcon(t.resolved ? 'rotate-ccw' : 'check').onClick(() => this.host.resolve(this.id, !t.resolved)));
		menu.addItem((i) =>
			i
				.setTitle(isRoot ? 'Delete thread' : 'Delete comment')
				.setIcon('trash')
				.setWarning(true)
				.onClick(() => (isRoot ? this.confirmDeleteThread() : this.host.deleteComment(this.id, c.id))),
		);
		return menu;
	}

	/** "Priority" choices for the thread, as a checked group. */
	private priorityItems(menu: Menu, thread: Thread): void {
		const current = threadPriority(thread);
		menu.addSeparator();
		for (const p of PRIORITIES) {
			menu.addItem((i) =>
				i
					.setTitle(`${PRIORITY_LABELS[p]} priority`)
					.setChecked(p === current)
					.onClick(() => {
						if (p !== current) this.host.setPriority(this.id, p);
					}),
			);
		}
	}

	private renderFooter(thread: Thread, state: CardState): void {
		const showReply = (state.active || this.mode === 'sidebar') && !thread.resolved;
		this.footerEl.toggle(showReply);
		if (!showReply) return;
		if (!this.replyComposer) {
			this.replyTargetEl = this.footerEl.createDiv({ cls: 'pdfc-reply-target' });
			this.replyComposer = createComposer(this.footerEl, {
				placeholder: 'Reply…',
				submitLabel: 'Reply',
				app: this.host.app,
				rows: 1,
				onSubmit: (text) => {
					if (this.host.reply(this.id, this.replyTarget, text)) {
						this.replyComposer!.reset();
						this.replyTarget = null;
						this.updateReplyTarget();
					}
				},
				onCancel: () => {
					this.replyComposer!.reset();
					this.replyTarget = null;
					this.updateReplyTarget();
				},
			});
			this.replyComposer.el.addClass('pdfc-reply-composer');
		}
		this.updateReplyTarget();
	}

	private setReplyTarget(commentId: string): void {
		this.replyTarget = commentId;
		if (!this.state?.active && this.mode === 'margin') this.host.activate(this.id);
		window.setTimeout(() => {
			this.updateReplyTarget();
			this.replyComposer?.focus();
		}, 0);
	}

	private updateReplyTarget(): void {
		const el = this.replyTargetEl;
		if (!el || !this.thread) return;
		el.empty();
		const target = this.replyTarget ? this.thread.comments.find((c) => c.id === this.replyTarget) : null;
		el.toggle(!!target);
		if (!target) return;
		el.createSpan({ text: `Replying to “${excerpt(target.body, 36)}”` });
		const x = iconButton(el, 'x', 'Reply to the whole thread instead');
		x.addEventListener('click', (e) => {
			e.stopPropagation();
			this.replyTarget = null;
			this.updateReplyTarget();
		});
		this.host.changed();
	}

	private startEdit(commentId: string): void {
		this.editing = commentId;
		if (!this.state?.active && this.mode === 'margin') this.host.activate(this.id);
		this.rerender();
	}

	private confirmDeleteThread(): void {
		new ConfirmModal(this.host.app, 'Delete this comment thread?', 'Delete', () => this.host.deleteThread(this.id)).open();
	}

	private flashComment(commentId: string, retry = true): void {
		const row = this.listEl.querySelector<HTMLElement>(`.pdfc-comment[data-cid="${commentId}"]`);
		if (!row) {
			if (!retry) return;
			// hidden (compact card or collapsed branch): expand first
			this.collapsed.clear();
			this.host.activate(this.id);
			window.setTimeout(() => this.flashComment(commentId, false), 50);
			return;
		}
		// Own class name: Obsidian's .is-flashing uses mix-blend-mode, which hid the text in dark themes.
		row.removeClass('pdfc-flash');
		void row.offsetWidth; // restart the animation
		row.addClass('pdfc-flash');
		const done = () => row.removeClass('pdfc-flash');
		row.addEventListener('animationend', done, { once: true });
		window.setTimeout(done, 2000);
	}

	private rerender(): void {
		if (!this.thread || !this.state) return;
		this.renderKey = '';
		const t = this.thread;
		this.thread = null;
		this.render(t, this.state);
	}
}
