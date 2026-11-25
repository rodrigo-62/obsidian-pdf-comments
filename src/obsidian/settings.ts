// Plugin settings (SPEC §3).

import { App, PluginSettingTab, Setting } from 'obsidian';
import { isZoomMode, percentLabel, ZOOM_PRESETS, type ZoomMode } from '../core/zoom';
import type PdfCommentsPlugin from './main';

export type PageTheme = 'normal' | 'sepia' | 'dark';
export const PAGE_THEMES: PageTheme[] = ['normal', 'sepia', 'dark'];
export const PAGE_THEME_LABELS: Record<PageTheme, string> = { normal: 'Normal', sepia: 'Sepia', dark: 'Dark' };
export const PAGE_THEME_ICONS: Record<PageTheme, string> = { normal: 'sun', sepia: 'coffee', dark: 'moon' };

export interface PdfCommentsSettings {
	/** Open PDFs in our view instead of Obsidian's (SPEC §3.2). */
	openByDefault: boolean;
	/** Page colours of every PDF view (SPEC §3.3, DECISIONS D3.1). */
	pageTheme: PageTheme;
	/** Zoom for PDFs opened for the first time. */
	defaultZoom: ZoomMode;
	/** Width of the comment margin, in px. */
	marginWidth: number;
	/** Folder of the comment notes (SPEC §5.1). */
	commentsFolder: string;
	/** Rename a PDF's comment note when the PDF is renamed. */
	renameNotesWithPdfs: boolean;
	/** Paper colour of the sepia page colours. */
	sepiaColor: string;
	/** Strength of the dark page colours' inversion (0.7–1). */
	darkInvert: number;
}

export const DEFAULT_SETTINGS: PdfCommentsSettings = {
	openByDefault: true,
	pageTheme: 'normal',
	defaultZoom: 'page-width',
	marginWidth: 320,
	commentsFolder: 'PDF comments',
	renameNotesWithPdfs: true,
	sepiaColor: '#f3e7cf',
	darkInvert: 0.88,
};

export function sanitizeSettings(raw: unknown): PdfCommentsSettings {
	const s = { ...DEFAULT_SETTINGS };
	if (!raw || typeof raw !== 'object') return s;
	const o = raw as Record<string, unknown>;
	if (typeof o.openByDefault === 'boolean') s.openByDefault = o.openByDefault;
	if (PAGE_THEMES.includes(o.pageTheme as PageTheme)) s.pageTheme = o.pageTheme as PageTheme;
	else if (o.darkPages === true) s.pageTheme = 'dark'; // setting of 0.1 builds
	if (isZoomMode(o.defaultZoom)) s.defaultZoom = o.defaultZoom;
	if (typeof o.marginWidth === 'number' && o.marginWidth >= 200 && o.marginWidth <= 600) s.marginWidth = o.marginWidth;
	if (typeof o.commentsFolder === 'string') s.commentsFolder = o.commentsFolder;
	if (typeof o.renameNotesWithPdfs === 'boolean') s.renameNotesWithPdfs = o.renameNotesWithPdfs;
	if (typeof o.sepiaColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.sepiaColor)) s.sepiaColor = o.sepiaColor;
	if (typeof o.darkInvert === 'number' && o.darkInvert >= 0.7 && o.darkInvert <= 1) s.darkInvert = o.darkInvert;
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

		new Setting(containerEl).setName('Comments').setHeading();

		new Setting(containerEl)
			.setName('Folder for comment notes')
			.setDesc('Each commented PDF gets one note here, linked to the PDF by its "commented-pdf" property. Existing notes are not moved when you change this.')
			.addText((t) =>
				t
					.setPlaceholder('PDF comments')
					.setValue(s.commentsFolder)
					.onChange(async (v) => {
						s.commentsFolder = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Rename comment notes with their PDFs')
			.setDesc('When a PDF is renamed, its comment note in the folder above gets the new name too.')
			.addToggle((t) =>
				t.setValue(s.renameNotesWithPdfs).onChange(async (v) => {
					s.renameNotesWithPdfs = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Width of the comment margin')
			.setDesc('In pixels (200–600).')
			.addSlider((sl) =>
				sl
					.setLimits(200, 600, 10)
					.setValue(s.marginWidth)
					.onChange(async (v) => {
						s.marginWidth = v;
						await this.plugin.saveSettings();
						this.plugin.marginWidthChanged();
					}),
			);

		new Setting(containerEl).setName('Viewer').setHeading();

		new Setting(containerEl)
			.setName('Page colours')
			.setDesc('Normal, sepia (warm paper) or dark (inverted, pictures keep their hues). Also in the toolbar of every PDF.')
			.addDropdown((d) => {
				for (const t of PAGE_THEMES) d.addOption(t, PAGE_THEME_LABELS[t]);
				d.setValue(s.pageTheme);
				d.onChange((v) => this.plugin.setPageTheme(v as PageTheme));
			});

		new Setting(containerEl)
			.setName('Sepia paper colour')
			.setDesc('The colour white turns into with the sepia page colours. Text stays dark.')
			.addColorPicker((c) =>
				c.setValue(s.sepiaColor).onChange(async (v) => {
					s.sepiaColor = v;
					await this.plugin.saveSettings();
					this.plugin.pageColoursChanged();
				}),
			)
			.addExtraButton((b) =>
				b
					.setIcon('rotate-ccw')
					.setTooltip('Reset')
					.onClick(async () => {
						s.sepiaColor = DEFAULT_SETTINGS.sepiaColor;
						await this.plugin.saveSettings();
						this.plugin.pageColoursChanged();
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName('Dark page strength')
			.setDesc('How far the dark page colours go: lower gives grey pages with softer text, 100 % gives black pages with white text.')
			.addSlider((sl) =>
				sl
					.setLimits(70, 100, 1)
					.setValue(Math.round(s.darkInvert * 100))
					.onChange(async (v) => {
						s.darkInvert = v / 100;
						await this.plugin.saveSettings();
						this.plugin.pageColoursChanged();
					}),
			)
			.addExtraButton((b) =>
				b
					.setIcon('rotate-ccw')
					.setTooltip('Reset')
					.onClick(async () => {
						s.darkInvert = DEFAULT_SETTINGS.darkInvert;
						await this.plugin.saveSettings();
						this.plugin.pageColoursChanged();
						this.display();
					}),
			);
	}
}
