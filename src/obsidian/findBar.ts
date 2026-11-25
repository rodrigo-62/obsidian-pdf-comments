// Find bar over the pages, backed by PDF.js's PDFFindController (SPEC §3.3).

import { setIcon, setTooltip } from 'obsidian';
import type { EventBus } from './pdfjs';

/** PDF.js FindState values. */
const NOT_FOUND = 1;

interface MatchesCount {
	current: number;
	total: number;
}

export class FindBar {
	readonly el: HTMLElement;
	private input: HTMLInputElement;
	private countEl: HTMLElement;
	private caseBtn: HTMLElement;
	private wordBtn: HTMLElement;
	private caseSensitive = false;
	private entireWord = false;
	private shown = false;

	constructor(
		parent: HTMLElement,
		private eventBus: EventBus,
		private onClosed: () => void,
	) {
		this.el = parent.createDiv({ cls: 'pdfc-findbar' });
		this.el.hide();
		this.input = this.el.createEl('input', { type: 'text', cls: 'pdfc-find-input', attr: { placeholder: 'Find in PDF', spellcheck: 'false' } });
		this.countEl = this.el.createSpan({ cls: 'pdfc-find-count' });
		this.caseBtn = this.iconButton('case-sensitive', 'Match case', () => {
			this.caseSensitive = !this.caseSensitive;
			this.caseBtn.toggleClass('is-active', this.caseSensitive);
			this.dispatch('casesensitivitychange');
		});
		this.wordBtn = this.iconButton('whole-word', 'Whole words', () => {
			this.entireWord = !this.entireWord;
			this.wordBtn.toggleClass('is-active', this.entireWord);
			this.dispatch('entirewordchange');
		});
		this.iconButton('arrow-up', 'Previous match (Shift+Enter)', () => this.dispatch('again', true));
		this.iconButton('arrow-down', 'Next match (Enter)', () => this.dispatch('again'));
		this.iconButton('x', 'Close (Esc)', () => this.close());

		this.input.addEventListener('input', () => this.dispatch(''));
		this.input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.dispatch('again', e.shiftKey);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this.close();
			}
		});

		this.eventBus.on('updatefindmatchescount', (e: { matchesCount: MatchesCount }) => this.showCount(e.matchesCount));
		this.eventBus.on('updatefindcontrolstate', (e: { state: number; matchesCount?: MatchesCount }) => {
			this.el.toggleClass('is-not-found', e.state === NOT_FOUND && this.input.value !== '');
			if (e.matchesCount) this.showCount(e.matchesCount);
		});
	}

	get isOpen(): boolean {
		return this.shown;
	}

	open(query?: string): void {
		this.shown = true;
		this.el.show();
		if (query && query.trim() && !query.includes('\n')) {
			this.input.value = query.trim();
			this.dispatch('');
		} else if (this.input.value) {
			this.dispatch('');
		}
		this.input.focus();
		this.input.select();
	}

	close(): void {
		if (!this.shown) return;
		this.shown = false;
		this.el.hide();
		this.eventBus.dispatch('findbarclose', { source: this });
		this.onClosed();
	}

	/** Searches again (e.g. after the document changed). */
	refresh(): void {
		if (this.shown && this.input.value) this.dispatch('');
	}

	private dispatch(type: '' | 'again' | 'casesensitivitychange' | 'entirewordchange', findPrevious = false): void {
		if (!this.input.value) {
			this.countEl.setText('');
			this.el.removeClass('is-not-found');
			this.eventBus.dispatch('findbarclose', { source: this });
			return;
		}
		this.eventBus.dispatch('find', {
			source: this,
			type,
			query: this.input.value,
			caseSensitive: this.caseSensitive,
			entireWord: this.entireWord,
			highlightAll: true,
			findPrevious,
			matchDiacritics: false,
		});
	}

	private showCount(m: MatchesCount): void {
		if (!this.input.value) this.countEl.setText('');
		else if (m.total === 0) this.countEl.setText('No results');
		else this.countEl.setText(`${m.current} of ${m.total}`);
	}

	private iconButton(icon: string, label: string, onClick: () => void): HTMLElement {
		const b = this.el.createDiv({ cls: 'clickable-icon pdfc-find-btn', attr: { 'aria-label': label } });
		setIcon(b, icon);
		setTooltip(b, label);
		b.addEventListener('click', onClick);
		return b;
	}
}
