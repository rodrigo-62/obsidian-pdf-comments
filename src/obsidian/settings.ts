// Plugin settings (SPEC §3).

import { App, PluginSettingTab, Setting } from 'obsidian';
import { isZoomMode, percentLabel, ZOOM_PRESETS, type ZoomMode } from '../core/zoom';
import type PdfCommentsPlugin from './main';

export interface PdfCommentsSettings {
	/** Open PDFs in our view instead of Obsidian's (SPEC §3.2). */
	openByDefault: boolean;
	/** Invert page colours in new views (SPEC §3.3). */
	darkPages: boolean;
	/** Zoom for PDFs opened for the first time. */
	defaultZoom: ZoomMode;
	/** Width of the comment margin, in px (used from Phase 3). */
	marginWidth: number;
}

export const DEFAULT_SETTINGS: PdfCommentsSettings = {
	openByDefault: true,
	darkPages: false,
	defaultZoom: 'page-width',
	marginWidth: 320,
};

export function sanitizeSettings(raw: unknown): PdfCommentsSettings {
	const s = { ...DEFAULT_SETTINGS };
	if (!raw || typeof raw !== 'object') return s;
	const o = raw as Record<string, unknown>;
	if (typeof o.openByDefault === 'boolean') s.openByDefault = o.openByDefault;
	if (typeof o.darkPages === 'boolean') s.darkPages = o.darkPages;
	if (isZoomMode(o.defaultZoom)) s.defaultZoom = o.defaultZoom;
	if (typeof o.marginWidth === 'number' && o.marginWidth >= 200 && o.marginWidth <= 600) s.marginWidth = o.marginWidth;
	return s;
}

export class PdfCommentsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: PdfCommentsPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		new Setting(containerEl)
			.setName('Open PDFs with comments')
			.setDesc("Open every PDF in this plugin's view. A button in the view's header switches to Obsidian's PDF viewer and back.")
			.addToggle((t) =>
				t.setValue(s.openByDefault).onChange(async (v) => {
					s.openByDefault = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Default zoom')
			.setDesc('For PDFs opened for the first time. Afterwards each PDF keeps its own zoom and position.')
			.addDropdown((d) => {
				d.addOption('page-width', 'Fit width');
				d.addOption('page-fit', 'Fit page');
				for (const p of ZOOM_PRESETS) d.addOption(String(p), percentLabel(p));
				d.setValue(String(s.defaultZoom));
				d.onChange(async (v) => {
					s.defaultZoom = v === 'page-width' || v === 'page-fit' ? v : Number(v);
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Dark pages')
			.setDesc('Invert the colours of the pages in new views (pictures keep their hues). Each view also has a toggle.')
			.addToggle((t) =>
				t.setValue(s.darkPages).onChange(async (v) => {
					s.darkPages = v;
					await this.plugin.saveSettings();
				}),
			);
	}
}
