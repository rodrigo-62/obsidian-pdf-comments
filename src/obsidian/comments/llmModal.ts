// The "Copy for LLM" dialog (SPEC §6): how much of the PDF to include, then copy.

import { App, Modal, Setting } from 'obsidian';
import type { ExportMode, ExportScope } from '../../core/llmExport';

export interface LlmChoice {
	scope: ExportScope;
	range: [number, number];
	mode: ExportMode;
	includeResolved: boolean;
}

const SCOPES: Record<ExportScope, string> = {
	context: 'Commented passages with context',
	'commented-pages': 'Pages with comments',
	range: 'Page range',
	all: 'Whole document',
};
const MODES: Record<ExportMode, string> = { full: 'Text and comments', comments: 'Comments only', text: 'Text only' };

export class CopyForLlmModal extends Modal {
	constructor(
		app: App,
		private totalPages: number,
		private choice: LlmChoice,
		private onCopy: (choice: LlmChoice) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Copy for LLM');
		const c = { ...this.choice, range: [...this.choice.range] as [number, number] };
		let rangeSetting: Setting | null = null;
		const showRange = () => rangeSetting?.settingEl.toggle(c.scope === 'range' && c.mode !== 'comments');
		new Setting(this.contentEl).setName('Include').addDropdown((d) => {
			for (const [k, v] of Object.entries(MODES)) d.addOption(k, v);
			d.setValue(c.mode).onChange((v) => {
				c.mode = v as ExportMode;
				scopeSetting.settingEl.toggle(c.mode !== 'comments');
				showRange();
			});
		});
		const scopeSetting = new Setting(this.contentEl)
			.setName('Text')
			.setDesc('A long PDF can be more text than an AI chat takes: the commented passages are usually enough.')
			.addDropdown((d) => {
				for (const [k, v] of Object.entries(SCOPES)) d.addOption(k, v);
				d.setValue(c.scope).onChange((v) => {
					c.scope = v as ExportScope;
					showRange();
				});
			});
		rangeSetting = new Setting(this.contentEl).setName('Pages').setDesc(`1 to ${this.totalPages}`);
		const num = (i: 0 | 1) =>
			rangeSetting.addText((t) => {
				t.inputEl.type = 'number';
				t.inputEl.min = '1';
				t.inputEl.max = String(this.totalPages);
				t.inputEl.addClass('pdfc-range-input');
				t.setValue(String(Math.min(c.range[i], this.totalPages))).onChange((v) => (c.range[i] = Number(v) || 1));
			});
		num(0);
		num(1);
		scopeSetting.settingEl.toggle(c.mode !== 'comments');
		showRange();
		new Setting(this.contentEl).setName('Include resolved comments').addToggle((t) => t.setValue(c.includeResolved).onChange((v) => (c.includeResolved = v)));
		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText('Copy')
				.setCta()
				.onClick(() => {
					this.close();
					this.onCopy(c);
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
