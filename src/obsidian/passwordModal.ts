// Password prompt for protected PDFs (SPEC §3.3).

import { App, Modal, Setting } from 'obsidian';

export class PasswordModal extends Modal {
	private done = false;

	constructor(
		app: App,
		private fileName: string,
		private wrong: boolean,
		private onResult: (password: string | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.wrong ? 'Wrong password' : 'Password required');
		this.contentEl.createEl('p', { text: `“${this.fileName}” is protected. Enter its password to open it.` });
		let value = '';
		const submit = () => {
			this.done = true;
			this.close();
			this.onResult(value);
		};
		new Setting(this.contentEl).setName('Password').addText((t) => {
			t.inputEl.type = 'password';
			t.onChange((v) => (value = v));
			t.inputEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					submit();
				}
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Open').setCta().onClick(submit));
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.done) this.onResult(null);
	}
}
