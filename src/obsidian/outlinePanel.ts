// The PDF's outline (table of contents) in a panel left of the pages (SPEC §3.3).

import { setIcon } from 'obsidian';
import type { PDFDocumentProxy } from './pdfjs';

export interface OutlineItem {
	title: string;
	dest: string | unknown[] | null;
	url: string | null;
	items: OutlineItem[];
}

export class OutlinePanel {
	readonly el: HTMLElement;
	private listEl: HTMLElement;
	private token = 0;

	constructor(
		parent: HTMLElement,
		private onNavigate: (item: OutlineItem) => void,
	) {
		this.el = parent.createDiv({ cls: 'pdfc-outline' });
		this.el.createDiv({ cls: 'pdfc-outline-title', text: 'Outline' });
		this.listEl = this.el.createDiv({ cls: 'pdfc-outline-list' });
		this.el.hide();
	}

	get isOpen(): boolean {
		return this.el.isShown();
	}

	toggle(open = !this.isOpen): void {
		this.el.toggle(open);
	}

	clear(): void {
		this.token++;
		this.listEl.empty();
	}

	async load(doc: PDFDocumentProxy): Promise<void> {
		const token = ++this.token;
		this.listEl.empty();
		let items: OutlineItem[];
		try {
			items = (await doc.getOutline()) ?? [];
		} catch {
			items = [];
		}
		if (token !== this.token) return;
		if (!items.length) {
			this.listEl.createDiv({ cls: 'pdfc-outline-empty', text: 'This PDF has no outline.' });
			return;
		}
		this.render(this.listEl, items, 0);
	}

	private render(parent: HTMLElement, items: OutlineItem[], depth: number): void {
		for (const item of items) {
			const node = parent.createDiv({ cls: 'pdfc-outline-node' });
			const row = node.createDiv({ cls: 'pdfc-outline-row' });
			row.style.setProperty('--pdfc-depth', String(depth));
			const twisty = row.createDiv({ cls: 'pdfc-outline-twisty' });
			const label = row.createDiv({ cls: 'pdfc-outline-label', text: item.title || '(untitled)' });
			label.setAttr('title', item.title);
			label.addEventListener('click', () => this.onNavigate(item));
			if (item.items?.length) {
				const children = node.createDiv({ cls: 'pdfc-outline-children' });
				let open = depth === 0 && items.length < 12;
				const setOpen = (o: boolean) => {
					open = o;
					children.toggle(open);
					setIcon(twisty, open ? 'chevron-down' : 'chevron-right');
				};
				this.render(children, item.items, depth + 1);
				setOpen(open);
				twisty.addClass('is-clickable');
				twisty.addEventListener('click', () => setOpen(!open));
			}
		}
	}
}
