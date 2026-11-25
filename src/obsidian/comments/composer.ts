// Adapted from the Docs plugin (obsidian/composer.ts, commit 13957fe): CSS prefix folio- → pdfc-, imports.
// "SPEC §" and "DECISIONS" references below are to the Docs plugin's documents.

// A small text box for writing a comment: Ctrl/Cmd+Enter saves, Esc cancels.
// Used inside margin cards and in a modal (narrow panes / sidebar mode).
// While it has focus, Obsidian's hotkeys don't reach the note: formatting keys
// (Ctrl+B, Ctrl+I, Ctrl+K, …) format the comment instead (DECISIONS F9.1).

import { App, Menu, Modal, Scope, setIcon } from 'obsidian';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '../../core/shared/model';
import { insertLink, toggleWrap, type TextEdit } from '../../core/shared/textFormat';
import { showMenu } from './menus';

export interface ComposerOptions {
	placeholder?: string;
	initial?: string;
	submitLabel?: string;
	autofocus?: boolean;
	/** Needed so Ctrl/Cmd+Enter and Esc win over Obsidian's own hotkeys (Mod+Enter = toggle checkbox). */
	app?: App;
	/** Number of text rows when idle (1 for the compact reply box). */
	rows?: number;
	/** Show a priority picker starting at this value (new threads only). */
	priority?: Priority;
	onSubmit: (text: string, extra: { priority: Priority }) => void;
	onCancel: () => void;
}

export interface Composer {
	el: HTMLElement;
	textarea: HTMLTextAreaElement;
	focus(): void;
	/** Empty the box and shrink it back to its idle size. */
	reset(): void;
}

export function createComposer(parent: HTMLElement, opts: ComposerOptions): Composer {
	const el = parent.createDiv({ cls: 'pdfc-composer' });
	const textarea = el.createEl('textarea', { cls: 'pdfc-composer-input', attr: { rows: String(opts.rows ?? 2), placeholder: opts.placeholder ?? 'Comment…' } });
	textarea.value = opts.initial ?? '';
	const actions = el.createDiv({ cls: 'pdfc-composer-actions' });
	let priority: Priority = opts.priority ?? 'normal';
	if (opts.priority !== undefined) {
		const chip = actions.createEl('button', { cls: 'pdfc-btn pdfc-priority-chip', attr: { 'aria-label': 'Priority of this comment' } });
		const paint = () => {
			chip.empty();
			setIcon(chip.createSpan({ cls: 'pdfc-priority-icon' }), 'flag');
			chip.createSpan({ text: PRIORITY_LABELS[priority] });
			chip.dataset.priority = priority;
		};
		paint();
		chip.addEventListener('mousedown', (e) => e.preventDefault()); // keep the text box focused
		chip.addEventListener('click', (e) => {
			e.preventDefault();
			const menu = new Menu();
			for (const p of PRIORITIES) {
				menu.addItem((i) =>
					i
						.setTitle(PRIORITY_LABELS[p])
						.setChecked(p === priority)
						.onClick(() => {
							priority = p;
							paint();
							textarea.focus({ preventScroll: true });
						}),
				);
			}
			showMenu(menu, e);
		});
	}
	const hint = actions.createSpan({ cls: 'pdfc-composer-hint', text: 'Ctrl+Enter to save · Esc to cancel' });
	hint.setAttr('aria-hidden', 'true');
	const cancel = actions.createEl('button', { cls: 'pdfc-btn', text: 'Cancel' });
	const submit = actions.createEl('button', { cls: 'pdfc-btn mod-cta', text: opts.submitLabel ?? 'Comment' });
	const grow = () => {
		textarea.style.removeProperty('height'); // natural height, to measure scrollHeight
		textarea.setCssProps({ height: `${Math.min(textarea.scrollHeight, 400)}px` });
	};
	const updateState = () => submit.toggleClass('is-disabled', textarea.value.trim() === '');
	textarea.addEventListener('input', () => {
		grow();
		updateState();
		el.toggleClass('has-text', textarea.value.trim() !== '');
	});
	const submitNow = () => {
		if (textarea.value.trim()) opts.onSubmit(textarea.value, { priority });
	};
	const cancelNow = () => {
		opts.onCancel();
		el.removeClass('has-text');
		// leave the box (Cancel button or Esc): nothing in it keeps focus
		const active = activeDocument.activeElement;
		if (active?.instanceOf(HTMLElement) && el.contains(active)) active.blur();
	};
	textarea.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			e.stopPropagation();
			submitNow();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			cancelNow();
		}
	});
	// Obsidian handles hotkeys before the textarea sees them. A scope pushed while
	// the box has focus takes precedence. It has no parent: with the app scope as
	// parent, every hotkey it doesn't handle (Ctrl+B = bold, …) ran on the note.
	// Keys it doesn't handle reach the text box as usual (typing, Ctrl+Z, Ctrl+A).
	if (opts.app) {
		const app = opts.app;
		const scope = new Scope();
		for (const f of FORMATS) {
			for (const hk of hotkeysFor(app, f.command, f.fallback)) {
				scope.register(hk.modifiers, hk.key, () => {
					applyEdit(textarea, f.edit(textarea.value, textarea.selectionStart, textarea.selectionEnd));
					return false;
				});
			}
		}
		scope.register(['Mod'], 'Enter', () => {
			submitNow();
			return false;
		});
		scope.register([], 'Escape', () => {
			cancelNow();
			return false;
		});
		let pushed = false;
		textarea.addEventListener('focus', () => {
			if (!pushed) app.keymap?.pushScope(scope);
			pushed = true;
		});
		textarea.addEventListener('blur', () => {
			if (pushed) app.keymap?.popScope(scope);
			pushed = false;
		});
	}
	submit.addEventListener('click', (e) => {
		e.preventDefault();
		submitNow();
	});
	cancel.addEventListener('click', (e) => {
		e.preventDefault();
		cancelNow();
	});
	updateState();
	const focus = () => {
		// preventScroll: the card may not be positioned yet; scrolling to it would jump the page
		textarea.focus({ preventScroll: true });
		const n = textarea.value.length;
		textarea.setSelectionRange(n, n);
		grow();
	};
	const reset = () => {
		textarea.value = '';
		textarea.style.removeProperty('height');
		el.removeClass('has-text');
		updateState();
	};
	if (opts.autofocus) window.setTimeout(focus, 0);
	return { el, textarea, focus, reset };
}

interface Hotkey {
	modifiers: Modifier[];
	key: string;
}
type Modifier = 'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt';

/** Formatting in the comment box, keyed by the editor command whose hotkey it takes over. */
const FORMATS: { command: string; fallback: Hotkey[]; edit: (text: string, s: number, e: number) => TextEdit }[] = [
	{ command: 'editor:toggle-bold', fallback: [{ modifiers: ['Mod'], key: 'B' }], edit: (t, s, e) => toggleWrap(t, s, e, '**') },
	{ command: 'editor:toggle-italics', fallback: [{ modifiers: ['Mod'], key: 'I' }], edit: (t, s, e) => toggleWrap(t, s, e, '*') },
	{ command: 'editor:toggle-strikethrough', fallback: [], edit: (t, s, e) => toggleWrap(t, s, e, '~~') },
	{ command: 'editor:toggle-highlight', fallback: [], edit: (t, s, e) => toggleWrap(t, s, e, '==') },
	{ command: 'editor:toggle-code', fallback: [], edit: (t, s, e) => toggleWrap(t, s, e, '`') },
	{ command: 'editor:insert-link', fallback: [{ modifiers: ['Mod'], key: 'K' }], edit: insertLink },
];

/**
 * The user's hotkeys for an Obsidian command (their own, else Obsidian's defaults), so
 * formatting in the comment box follows the same keys as in the note. The hotkey
 * manager is internal; if it isn't there, the usual defaults are used.
 */
function hotkeysFor(app: App, command: string, fallback: Hotkey[]): Hotkey[] {
	const hm = (app as unknown as { hotkeyManager?: { getHotkeys?: (id: string) => Hotkey[] | undefined; getDefaultHotkeys?: (id: string) => Hotkey[] | undefined } }).hotkeyManager;
	try {
		const keys = hm?.getHotkeys?.(command) ?? hm?.getDefaultHotkeys?.(command);
		if (Array.isArray(keys)) return keys.filter((k) => k && typeof k.key === 'string' && Array.isArray(k.modifiers));
	} catch {
		// fall back to the defaults
	}
	return fallback;
}

/** Apply an edit to the text box, keeping it undoable (Ctrl+Z) where the browser allows. */
function applyEdit(textarea: HTMLTextAreaElement, edit: TextEdit): void {
	textarea.setSelectionRange(edit.from, edit.to);
	const doc = textarea.ownerDocument;
	// execCommand is the only way to change a text box's value that its undo history records.
	const exec = typeof doc.execCommand === 'function' ? (cmd: string, arg?: string) => doc.execCommand(cmd, false, arg) : () => false;
	const done = edit.insert ? exec('insertText', edit.insert) : exec('delete');
	if (!done || textarea.value.slice(edit.from, edit.from + edit.insert.length) !== edit.insert) {
		textarea.setRangeText(edit.insert, edit.from, edit.to, 'end');
		textarea.dispatchEvent(new Event('input'));
	}
	textarea.setSelectionRange(edit.selStart, edit.selEnd);
}

/** Modal version of the composer. */
export class ComposerModal extends Modal {
	private submitted = false;

	constructor(
		app: App,
		private titleText: string,
		private quote: string,
		private opts: Omit<ComposerOptions, 'autofocus'>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.titleText);
		this.modalEl.addClass('pdfc-composer-modal');
		if (this.quote) this.contentEl.createDiv({ cls: 'pdfc-quote', text: this.quote });
		createComposer(this.contentEl, {
			...this.opts,
			app: this.app,
			autofocus: true,
			onSubmit: (t, extra) => {
				this.submitted = true;
				this.close();
				this.opts.onSubmit(t, extra);
			},
			onCancel: () => this.close(),
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.submitted) this.opts.onCancel();
	}
}
