// The comments of one PDF, shared by every view that shows it (SPEC §4, §5).
// Views subscribe; every change goes through `update()`, which writes the note.

import { Notice, TFile, type App } from 'obsidian';
import type { PdfThreads } from '../../core/sidecar';
import { reanchorThreads, type PageData } from '../../core/reanchor';
import type { NoteStore } from './noteStore';

export class CommentDoc {
	threads: PdfThreads = {};
	fingerprint: string | null = null;
	/** Fingerprint of the PDF as currently open (set by the view); stored in a new note. */
	currentFingerprint: string | null = null;
	/** Malformed note: comments are shown read-only and nothing is written. */
	error: string | null = null;
	loaded = false;
	private listeners = new Set<() => void>();
	private loading: Promise<void> | null = null;
	private checking: Promise<void> | null = null;
	/** Writes are chained so they reach the note in order. */
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		private app: App,
		private store: NoteStore,
		public pdfPath: string,
	) {}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	get viewers(): number {
		return this.listeners.size;
	}

	private emit(): void {
		for (const fn of [...this.listeners]) fn();
	}

	load(force = false): Promise<void> {
		if (this.loading && !force) return this.loading;
		this.loading = (async () => {
			const s = await this.store.read(this.pdfPath);
			this.threads = s.threads;
			this.fingerprint = s.fingerprint;
			this.error = s.error;
			this.loaded = true;
			this.emit();
		})();
		return this.loading;
	}

	private pdfFile(): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(this.pdfPath);
		return f instanceof TFile ? f : null;
	}

	/** Applies `fn` to the threads and saves. Returns false (with a notice) if it could not be saved. */
	update(fn: (threads: PdfThreads) => PdfThreads, fingerprint?: string): Promise<boolean> {
		const run = async (): Promise<boolean> => {
			if (this.error) {
				new Notice(`The comments of this PDF can't be changed: ${this.error}`);
				return false;
			}
			const pdf = this.pdfFile();
			if (!pdf) return false;
			try {
				this.threads = await this.store.update(pdf, fn, fingerprint ?? this.fingerprint ?? this.currentFingerprint ?? undefined);
				if (fingerprint) this.fingerprint = fingerprint;
				else if (!this.fingerprint && this.currentFingerprint) this.fingerprint = this.currentFingerprint; // a new note stores it
				this.emit();
				return true;
			} catch (e) {
				console.error('[pdf-comments]', e);
				new Notice(`Could not save the comment: ${e instanceof Error ? e.message : String(e)}`);
				await this.load(true);
				return false;
			}
		};
		const p = this.queue.then(run, run);
		this.queue = p;
		return p;
	}

	/**
	 * If the PDF changed since the comments were made (fingerprint differs), finds every thread
	 * again in the new text (core/reanchor.ts) and saves. `pages` loads the text of all pages.
	 */
	checkAnchors(fingerprint: string, pages: () => Promise<PageData[]>): Promise<void> {
		if (this.checking) return this.checking;
		this.checking = (async () => {
			await this.load();
			if (this.error || !Object.keys(this.threads).length) return;
			if (this.fingerprint === fingerprint) return;
			if (this.fingerprint === null) {
				await this.update((t) => t, fingerprint); // notes made before fingerprints existed
				return;
			}
			const notice = new Notice('The PDF changed since it was commented on: finding the comments again…', 0);
			try {
				const data = await pages();
				let summary = { moved: 0, detached: 0 };
				await this.update((t) => {
					const r = reanchorThreads(t, data);
					summary = { moved: r.moved.length, detached: r.detached.length };
					return r.threads;
				}, fingerprint);
				notice.hide();
				const parts = [];
				if (summary.moved) parts.push(`${summary.moved} moved with their text`);
				if (summary.detached) parts.push(`${summary.detached} not found (see "Detached comments")`);
				new Notice(`The PDF changed. Comments: ${parts.length ? parts.join(', ') : 'all still in place'}.`);
			} catch (e) {
				notice.hide();
				console.error('[pdf-comments]', e);
			}
		})().finally(() => (this.checking = null));
		return this.checking;
	}
}
